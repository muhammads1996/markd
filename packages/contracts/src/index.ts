export const proposedActionTypes = [
  "worker_availability",
  "labour_request",
  "assignment_confirmation",
  "assignment_cancellation",
  "work_completion",
  "payment_issue",
  "historical_work_relationship_claim",
] as const;

export type ProposedActionType = (typeof proposedActionTypes)[number];
export type ProposedActionRiskTier =
  "informational" | "operational" | "trust" | "economic";
export type ProposedActionAmbiguity = "clear" | "ambiguous" | "unresolved";

export interface ProposedActionPayload {
  actionType: ProposedActionType;
  fields: Record<string, string | number | boolean | null>;
  entityIds: Record<string, string>;
}

export interface ProposedActionDraft {
  channelEventId: string;
  payload: ProposedActionPayload;
  confidence: number | null;
  ambiguity: ProposedActionAmbiguity;
  riskTier: ProposedActionRiskTier;
  entityResolution: Record<string, unknown>;
  interpretation: Record<string, unknown>;
  modelProvider?: string;
  modelName?: string;
}

export interface ProposedActionPayloadFieldMap {
  [key: string]: string | number | boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateProposedActionDraft(
  draft: ProposedActionDraft,
): string[] {
  const errors: string[] = [];
  if (!draft.channelEventId?.trim()) errors.push("channelEventId is required");
  if (!draft.payload || !proposedActionTypes.includes(draft.payload.actionType)) {
    errors.push("actionType is unsupported");
  }
  if (!isRecord(draft.payload?.fields)) errors.push("fields must be an object");
  if (!isRecord(draft.payload?.entityIds)) {
    errors.push("entityIds must be an object");
  } else if (
    Object.entries(draft.payload.entityIds).some(
      ([key, value]) => !key.trim() || !value.trim(),
    )
  ) {
    errors.push("entityIds must contain non-empty identifiers");
  }
  if (!isRecord(draft.entityResolution)) {
    errors.push("entityResolution must be an object");
  }
  if (
    draft.confidence !== null &&
    (typeof draft.confidence !== "number" ||
      draft.confidence < 0 ||
      draft.confidence > 1)
  ) {
    errors.push("confidence must be between 0 and 1");
  }
  if (draft.ambiguity !== "clear" && draft.riskTier !== "informational") {
    errors.push("ambiguous actions cannot be actionable");
  }
  if (draft.riskTier === "trust" || draft.riskTier === "economic") {
    if (draft.ambiguity !== "clear")
      errors.push("high-trust actions require clear resolution");
    if (draft.confidence === null || draft.confidence < 0.9)
      errors.push("high-trust actions require confidence >= 0.9");
  }
  return errors;
}

export function canApplyProposedAction(
  draft: ProposedActionDraft,
  operatorConfirmed: boolean,
): boolean {
  return validateProposedActionDraft(draft).length === 0 && operatorConfirmed;
}

export function requiresOperatorConfirmation(
  draft: ProposedActionDraft,
): boolean {
  return validateProposedActionDraft(draft).length > 0 || draft.ambiguity !== "clear" || draft.riskTier !== "informational";
}
export {};
