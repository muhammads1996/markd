import type { ProposedActionDraft } from "@markd/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppInboundMessage {
  providerEventId: string;
  providerMessageId: string;
  senderPhoneNumber: string;
  occurredAt: string;
  text?: string;
  media: Array<{
    providerMediaId: string;
    mediaType: string;
    mimeType?: string;
  }>;
  rawPayload: Record<string, unknown>;
}

export interface ChannelEventRecord {
  channel: "whatsapp";
  eventType: "message" | "status" | "unsupported";
  providerEventId: string;
  providerMessageId: string;
  senderPhoneNumber: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  media: WhatsAppInboundMessage["media"];
}

export interface WhatsAppProvider {
  sendText(input: { recipientPhoneNumber: string; body: string }): Promise<{
    providerMessageId: string;
  }>;
  getMedia(input: {
    providerMediaId: string;
  }): Promise<{ url: string; mimeType: string }>;
}

export interface OutboundDeliveryInput {
  recipientPhoneNumber: string;
  body: string;
  messageKind: string;
  idempotencyKey: string;
  sourceChannelEventId?: string;
  sourceProposedActionId?: string;
}

// A plain `!==` on shared-secret tokens leaks timing information proportional
// to the matching prefix length; every secret comparison in this module goes
// through this constant-time helper instead.
export function constantTimeEquals(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function verifyWebhookToken(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string | undefined,
): string | null {
  if (mode !== "subscribe" || !constantTimeEquals(token, expectedToken))
    return null;
  return challenge;
}

export function verifyWebhookSignature(
  body: string,
  signature: string | null,
  appSecret: string | undefined,
): boolean {
  if (!signature || !appSecret || !signature.startsWith("sha256="))
    return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
  return constantTimeEquals(signature, expected);
}

export function normalizeInboundMessage(
  payload: Record<string, unknown>,
): WhatsAppInboundMessage | null {
  const entry = firstRecord(payload.entry);
  const change = firstRecord(entry?.changes);
  const value = asRecord(change?.value);
  const message = firstRecord(value?.messages);
  if (!message) return null;
  const sender = typeof message?.from === "string" ? message.from : null;
  const providerMessageId = typeof message?.id === "string" ? message.id : null;
  if (!sender || !providerMessageId) return null;
  const text = asRecord(message.text)?.body;
  const result: WhatsAppInboundMessage = {
    providerEventId:
      typeof payload.id === "string" ? payload.id : providerMessageId,
    providerMessageId,
    senderPhoneNumber: sender.startsWith("+") ? sender : `+${sender}`,
    occurredAt: new Date(
      Number(message.timestamp ?? 0) * 1000 || Date.now(),
    ).toISOString(),
    media: normalizeMedia(message),
    rawPayload: payload,
  };
  if (typeof text === "string") result.text = text;
  return result;
}

export function buildOutboundDeliveryRow(input: OutboundDeliveryInput) {
  return {
    channel: "whatsapp" as const,
    recipient_phone_number: input.recipientPhoneNumber,
    body: input.body,
    message_payload: { type: "session_text" as const, body: input.body },
    message_kind: input.messageKind,
    idempotency_key: input.idempotencyKey,
    source_channel_event_id: input.sourceChannelEventId ?? null,
    source_proposed_action_id: input.sourceProposedActionId ?? null,
    state: "queued" as const,
  };
}

function normalizeMedia(
  message: Record<string, unknown>,
): WhatsAppInboundMessage["media"] {
  const mediaTypes = [
    "image",
    "audio",
    "video",
    "document",
    "sticker",
  ] as const;
  for (const mediaType of mediaTypes) {
    const media = asRecord(message[mediaType]);
    if (media && typeof media.id === "string") {
      return [
        {
          providerMediaId: media.id,
          mediaType,
          ...(typeof media.mime_type === "string"
            ? { mimeType: media.mime_type }
            : {}),
        },
      ];
    }
  }
  return [];
}

export function actionDraftToRow(draft: ProposedActionDraft) {
  return {
    action_type: draft.payload.actionType,
    ambiguity: draft.ambiguity,
    confidence: draft.confidence,
    entity_resolution: draft.entityResolution,
    interpretation: draft.interpretation,
    model_name: draft.modelName ?? null,
    model_provider: draft.modelProvider ?? null,
    payload: draft.payload,
    risk_tier: draft.riskTier,
  };
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    return value[0] as Record<string, unknown>;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export {};
