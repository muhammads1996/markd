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
  }): Promise<{ bytes: Uint8Array; mimeType: string; providerUrl: string }>;
}

export interface MetaWhatsAppCloudProviderConfiguration {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  maxMediaBytes?: number;
}

export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

const META_GRAPH_DEFAULT_BASE_URL = "https://graph.facebook.com";
const META_GRAPH_DEFAULT_API_VERSION = "v24.0";
const DEFAULT_MAX_MEDIA_BYTES = 12 * 1024 * 1024;

/**
 * Server-only Meta Cloud API adapter. It retrieves media with the access token
 * and returns bytes so callers can store them in MARKD's private bucket rather
 * than exposing provider URLs to the browser.
 */
export class MetaWhatsAppCloudProvider implements WhatsAppProvider {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxMediaBytes: number;
  private readonly apiVersion: string;

  constructor(
    private readonly configuration: MetaWhatsAppCloudProviderConfiguration,
  ) {
    if (
      !configuration.accessToken.trim() ||
      !configuration.phoneNumberId.trim()
    ) {
      throw new Error(
        "WhatsApp access token and phone number ID are required.",
      );
    }
    this.apiVersion =
      configuration.apiVersion ?? META_GRAPH_DEFAULT_API_VERSION;
    if (!/^v\d+\.\d+$/u.test(this.apiVersion)) {
      throw new Error("WhatsApp API version must use the vNN.N format.");
    }
    this.baseUrl = (
      configuration.baseUrl ?? META_GRAPH_DEFAULT_BASE_URL
    ).replace(/\/$/u, "");
    this.fetchImplementation = configuration.fetchImplementation ?? fetch;
    this.maxMediaBytes = configuration.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES;
    if (!Number.isSafeInteger(this.maxMediaBytes) || this.maxMediaBytes < 1) {
      throw new Error("WhatsApp maxMediaBytes must be a positive integer.");
    }
  }

  async sendText(input: {
    recipientPhoneNumber: string;
    body: string;
  }): Promise<{ providerMessageId: string }> {
    if (!/^\+[1-9][0-9]{1,14}$/u.test(input.recipientPhoneNumber)) {
      throw new WhatsAppProviderError(
        "WhatsApp recipient must be an E.164 phone number.",
        false,
      );
    }
    if (!input.body.trim() || input.body.length > 4_096) {
      throw new WhatsAppProviderError(
        "WhatsApp text must be between 1 and 4096 characters.",
        false,
      );
    }

    const response = await this.request(
      `/${this.configuration.phoneNumberId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.recipientPhoneNumber.slice(1),
          type: "text",
          text: { body: input.body, preview_url: false },
        }),
      },
    );
    const payload = await response.json();
    const messages =
      isRecord(payload) && Array.isArray(payload.messages)
        ? payload.messages
        : [];
    const message = isRecord(messages[0]) ? messages[0] : null;
    if (!message || typeof message.id !== "string" || !message.id.trim()) {
      throw new WhatsAppProviderError(
        "WhatsApp response did not include a provider message ID.",
        true,
      );
    }
    return { providerMessageId: message.id };
  }

  async getMedia(input: {
    providerMediaId: string;
  }): Promise<{ bytes: Uint8Array; mimeType: string; providerUrl: string }> {
    if (!input.providerMediaId.trim()) {
      throw new WhatsAppProviderError("WhatsApp media ID is required.", false);
    }
    const metadataResponse = await this.request(
      `/${encodeURIComponent(input.providerMediaId)}`,
      { method: "GET" },
    );
    const metadata = await metadataResponse.json();
    const mediaUrl =
      isRecord(metadata) && typeof metadata.url === "string"
        ? metadata.url
        : null;
    const mimeType =
      isRecord(metadata) && typeof metadata.mime_type === "string"
        ? metadata.mime_type
        : null;
    const fileSize =
      isRecord(metadata) && typeof metadata.file_size === "number"
        ? metadata.file_size
        : null;
    if (!mediaUrl || !mimeType) {
      throw new WhatsAppProviderError(
        "WhatsApp media metadata was incomplete.",
        true,
      );
    }
    try {
      if (new URL(mediaUrl).protocol !== "https:") {
        throw new Error("Media URL is not HTTPS.");
      }
    } catch {
      throw new WhatsAppProviderError("WhatsApp media URL was invalid.", true);
    }
    if (fileSize !== null && fileSize > this.maxMediaBytes) {
      throw new WhatsAppProviderError(
        "WhatsApp media exceeds the configured size limit.",
        false,
      );
    }

    const mediaResponse = await this.fetchImplementation(mediaUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.configuration.accessToken}` },
    });
    if (!mediaResponse.ok) {
      throw new WhatsAppProviderError(
        `WhatsApp media download failed with status ${mediaResponse.status}.`,
        isRetryableStatus(mediaResponse.status),
      );
    }
    const contentLength = Number(mediaResponse.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > this.maxMediaBytes) {
      throw new WhatsAppProviderError(
        "WhatsApp media exceeds the configured size limit.",
        false,
      );
    }
    const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
    if (bytes.byteLength > this.maxMediaBytes) {
      throw new WhatsAppProviderError(
        "WhatsApp media exceeds the configured size limit.",
        false,
      );
    }
    return { bytes, mimeType, providerUrl: mediaUrl };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.baseUrl}/${this.apiVersion}${path}`,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${this.configuration.accessToken}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
          },
        },
      );
    } catch {
      throw new WhatsAppProviderError(
        "WhatsApp provider request failed.",
        true,
      );
    }
    if (!response.ok) {
      throw new WhatsAppProviderError(
        `WhatsApp provider request failed with status ${response.status}.`,
        isRetryableStatus(response.status),
      );
    }
    return response;
  }
}

export interface OutboundDeliveryInput {
  recipientPhoneNumber: string;
  body: string;
  messageKind: string;
  idempotencyKey: string;
  sourceChannelEventId?: string;
  sourceProposedActionId?: string;
}

export interface WhatsAppDeliveryStatus {
  providerEventId: string;
  providerMessageId: string;
  occurredAt: string;
  state: "sent" | "delivered" | "failed";
  failureReason: string | null;
  rawPayload: Record<string, unknown>;
}

export function normalizeWhatsAppDeliveryStatuses(
  payload: Record<string, unknown>,
): WhatsAppDeliveryStatus[] {
  const results: WhatsAppDeliveryStatus[] = [];
  for (const value of webhookValues(payload)) {
    const statuses = value.statuses;
    if (!Array.isArray(statuses)) continue;
    for (const status of statuses) {
      if (!isRecord(status) || typeof status.id !== "string") continue;
      const state = normalizeDeliveryState(status.status);
      if (!state) continue;
      const occurredAt = toOccurredAt(status.timestamp);
      results.push({
        providerEventId: `${status.id}:${state}:${occurredAt}`,
        providerMessageId: status.id,
        occurredAt,
        state,
        failureReason: state === "failed" ? statusFailureReason(status) : null,
        rawPayload: payload,
      });
    }
  }
  return results;
}

export function verifyWebhookToken(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string | undefined,
): string | null {
  if (mode !== "subscribe" || !expectedToken || token !== expectedToken)
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
  const received = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  return (
    received.length === calculated.length &&
    timingSafeEqual(received, calculated)
  );
}

export function normalizeInboundMessage(
  payload: Record<string, unknown>,
): WhatsAppInboundMessage | null {
  return normalizeInboundMessages(payload)[0] ?? null;
}

export function normalizeInboundMessages(
  payload: Record<string, unknown>,
): WhatsAppInboundMessage[] {
  const results: WhatsAppInboundMessage[] = [];
  for (const value of webhookValues(payload)) {
    const messages = value.messages;
    if (!Array.isArray(messages)) continue;
    for (const messageValue of messages) {
      const message = asRecord(messageValue);
      if (!message) continue;
      const sender = typeof message?.from === "string" ? message.from : null;
      const providerMessageId =
        typeof message?.id === "string" ? message.id : null;
      if (!sender || !providerMessageId) continue;
      const text = asRecord(message.text)?.body;
      const result: WhatsAppInboundMessage = {
        providerEventId:
          typeof payload.id === "string" ? payload.id : providerMessageId,
        providerMessageId,
        senderPhoneNumber: sender.startsWith("+") ? sender : `+${sender}`,
        occurredAt: toOccurredAt(message.timestamp),
        media: normalizeMedia(message),
        rawPayload: payload,
      };
      if (typeof text === "string") result.text = text;
      results.push(result);
    }
  }
  return results;
}

export function buildOutboundDeliveryRow(input: OutboundDeliveryInput) {
  return {
    channel: "whatsapp" as const,
    recipient_phone_number: input.recipientPhoneNumber,
    body: input.body,
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

function webhookValues(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  if (!Array.isArray(payload.entry)) return values;
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = isRecord(change) ? asRecord(change.value) : null;
      if (value) values.push(value);
    }
  }
  return values;
}

function normalizeDeliveryState(
  value: unknown,
): WhatsAppDeliveryStatus["state"] | null {
  if (value === "sent") return "sent";
  if (value === "delivered" || value === "read") return "delivered";
  return value === "failed" ? "failed" : null;
}

function statusFailureReason(status: Record<string, unknown>): string | null {
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const error = asRecord(errors[0]);
  const reason = error && (error.title ?? error.message);
  return typeof reason === "string" ? reason.slice(0, 500) : null;
}

function toOccurredAt(timestamp: unknown): string {
  const seconds =
    typeof timestamp === "string" || typeof timestamp === "number"
      ? Number(timestamp)
      : Number.NaN;
  return new Date(
    Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now(),
  ).toISOString();
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export {};
