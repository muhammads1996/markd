import { describe, expect, it } from "vitest";
import {
  canApplyProposedAction,
  requiresOperatorConfirmation,
  validateProposedActionDraft,
  type ProposedActionDraft,
} from "@markd/contracts";

const draft = (overrides: Partial<ProposedActionDraft> = {}): ProposedActionDraft => ({
  channelEventId: "72000000-0000-4000-8000-000000000001",
  payload: {
    actionType: "work_completion",
    entityIds: { workerId: "worker-1" },
    fields: { completion: "completed" },
  },
  confidence: 0.96,
  ambiguity: "clear",
  riskTier: "trust",
  entityResolution: { workerId: { status: "unique" } },
  interpretation: { source: "test" },
  ...overrides,
});

describe("ProposedAction policy", () => {
  it("requires explicit operator confirmation before application", () => {
    expect(canApplyProposedAction(draft(), false)).toBe(false);
    expect(canApplyProposedAction(draft(), true)).toBe(true);
  });

  it("rejects ambiguous high-trust drafts", () => {
    const ambiguous = draft({ ambiguity: "ambiguous" });
    expect(validateProposedActionDraft(ambiguous)).toContain(
      "ambiguous actions cannot be actionable",
    );
    expect(canApplyProposedAction(ambiguous, true)).toBe(false);
  });

  it("rejects low-confidence economic drafts", () => {
    const uncertain = draft({ confidence: 0.89, riskTier: "economic" });
    expect(validateProposedActionDraft(uncertain)).toContain(
      "high-trust actions require confidence >= 0.9",
    );
  });

  it("rejects malformed entity and field maps before confirmation", () => {
    const malformed = draft({
      payload: { ...draft().payload, entityIds: { workerId: "" } },
    });
    expect(validateProposedActionDraft(malformed)).toEqual(expect.arrayContaining([
      "entityIds must contain non-empty identifiers",
    ]));
    expect(canApplyProposedAction(malformed, true)).toBe(false);
  });

  it("keeps even informational drafts behind the application policy boundary", () => {
    expect(requiresOperatorConfirmation(draft({ riskTier: "informational" }))).toBe(false);
    expect(requiresOperatorConfirmation(draft({ riskTier: "operational" }))).toBe(true);
  });
});