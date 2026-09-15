import { assertQuerySuccess, getOperatorClient } from "../work-graph/queries";
import type {
  ProposedActionAmbiguity,
  ProposedActionRiskTier,
  ProposedActionType,
} from "@markd/contracts";

export type InboxFieldValue = string | number | boolean | null;

export type InboxItem = {
  id: string;
  channelEventId: string;
  actionType: ProposedActionType;
  fields: Record<string, InboxFieldValue>;
  entityIds: Record<string, string>;
  confidence: number | null;
  ambiguity: ProposedActionAmbiguity;
  riskTier: ProposedActionRiskTier;
  createdAt: string;
  senderPhoneNumber: string | null;
  occurredAt: string | null;
  originalText: string | null;
  transcript: string | null;
  transcriptConfidence: number | null;
  detectedLanguageCode: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Reads the same language-neutral interpretation FLO-110 attaches to a
 * ProposedAction draft, so the Ops Inbox always shows original text,
 * transcript and confidence together with the extracted fields. */
export async function listInboxItems(): Promise<InboxItem[]> {
  const supabase = await getOperatorClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("proposed_actions")
    .select(
      "id, channel_event_id, action_type, payload, confidence, ambiguity, risk_tier, interpretation, created_at, channel_events(sender_phone_number, occurred_at)",
    )
    .eq("state", "pending")
    .order("created_at", { ascending: true });
  assertQuerySuccess(error, "loading the Ops Inbox");
  return (data ?? []).map(mapInboxRow);
}

function mapInboxRow(row: Record<string, unknown>): InboxItem {
  const payload = isRecord(row.payload) ? row.payload : {};
  const interpretation = isRecord(row.interpretation) ? row.interpretation : {};
  const channelEventRaw = row.channel_events;
  const channelEvent = Array.isArray(channelEventRaw)
    ? channelEventRaw[0]
    : channelEventRaw;
  const fieldsSource = isRecord(payload.fields) ? payload.fields : {};
  const entityIdsSource = isRecord(payload.entityIds) ? payload.entityIds : {};
  const fields: Record<string, InboxFieldValue> = {};
  for (const [key, value] of Object.entries(fieldsSource)) {
    fields[key] =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? value
        : null;
  }
  const entityIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(entityIdsSource)) {
    if (typeof value === "string") entityIds[key] = value;
  }
  return {
    id: String(row.id),
    channelEventId: String(row.channel_event_id),
    actionType: row.action_type as ProposedActionType,
    fields,
    entityIds,
    confidence: numberField(row.confidence),
    ambiguity: row.ambiguity as ProposedActionAmbiguity,
    riskTier: row.risk_tier as ProposedActionRiskTier,
    createdAt: String(row.created_at),
    senderPhoneNumber: isRecord(channelEvent)
      ? stringField(channelEvent.sender_phone_number)
      : null,
    occurredAt: isRecord(channelEvent)
      ? stringField(channelEvent.occurred_at)
      : null,
    originalText: stringField(interpretation.originalText),
    transcript: stringField(interpretation.transcript),
    transcriptConfidence: numberField(interpretation.transcriptConfidence),
    detectedLanguageCode: stringField(interpretation.detectedLanguageCode),
  };
}
