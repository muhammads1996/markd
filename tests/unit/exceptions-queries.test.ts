import { describe, expect, it } from "vitest";

import { mapExceptionRows } from "../../apps/web/src/features/exceptions/queries";

describe("Exceptions queue mapping", () => {
  it("keeps participant claims and Workmark/Stamp evidence distinct", () => {
    const item = mapExceptionRows([
      {
        exception_id: "e-1",
        assignment_id: "a-1",
        exception_type: "no_show_concern",
        state: "open",
        version: 3,
        statement: "Worker says the pickup never arrived.",
        worker_display_name: "Amina",
        hirer_display_name: "Build Co",
        work_type: "Bricklaying",
        work_started_on: "2026-09-20",
        travel_authorised_at: "2026-09-19T12:00:00Z",
        cancelled_after_travel_authorised: true,
        claims: [
          {
            id: "c-worker",
            assertion: "asserted",
            statement: "I waited at the pickup.",
            asserted_by: "10000000-0000-4000-8000-000000000001",
            asserted_by_name: "Amina",
            asserted_role: "worker",
            source: "whatsapp",
            source_reference: "wa-msg-1",
            evidence_refs: ["stamp:s-1"],
          },
          {
            id: "c-hirer",
            assertion: "disputed",
            statement: "The worker did not arrive.",
            asserted_by: "20000000-0000-4000-8000-000000000001",
            asserted_by_name: "Build Co",
            asserted_role: "hirer",
            source: "operator_ui",
          },
        ],
        workmark_evidence: [
          { id: "w-1", label: "Workmark", detail: "attendance: no_show" },
        ],
        stamp_evidence: [
          { id: "s-1", label: "Stamp", detail: "operator recorded" },
        ],
      },
    ])[0]!;
    expect(item).toMatchObject({
      id: "e-1",
      workerName: "Amina",
      cancelledAfterTravelAuthorised: true,
    });
    expect(item.claims.map(({ assertedRole }) => assertedRole)).toEqual([
      "worker",
      "hirer",
    ]);
    expect(item.claims[0]).toMatchObject({
      sourceReference: "wa-msg-1",
      evidenceRefs: ["stamp:s-1"],
    });
    expect(item.evidence.map(({ kind }) => kind)).toEqual([
      "workmark",
      "stamp",
    ]);
  });

  it("deduplicates flattened view rows while retaining claims", () => {
    const item = mapExceptionRows([
      {
        exception_id: "e-1",
        state: "open",
        exception_type: "payment_dispute",
        statement: "Payment pending",
        worker_display_name: "Amina",
        claims: [{ id: "c-1", statement: "Pending", asserted_role: "worker" }],
      },
      {
        exception_id: "e-1",
        state: "open",
        exception_type: "payment_dispute",
        statement: "Payment pending",
        worker_display_name: "Amina",
        claims: [{ id: "c-2", statement: "Paid", asserted_role: "hirer" }],
      },
    ])[0]!;
    expect(item.claims).toHaveLength(2);
  });

  it("maps the compact queue projection's latest claim and Stamp evidence", () => {
    const item = mapExceptionRows([
      {
        exception_id: "e-2",
        state: "under_review",
        version: 4,
        category: "completion_dispute",
        summary: "Completion needs checking",
        worker_name: "Amina",
        hirer_name: "Build Co",
        job_terms: "Bricklaying",
        job_needed_at: "2026-09-20",
        latest_claim_id: "c-3",
        latest_claim_role: "hirer",
        latest_claim_asserted_by: "20000000-0000-4000-8000-000000000001",
        latest_claim_statement: "Only half the wall was complete.",
        latest_claim_assertion: { stance: "asserted" },
        latest_claim_source: "call",
        latest_claim_source_reference: "call-42",
        latest_claim_evidence_refs: ["workmark:w-2"],
        latest_stamp_id: "s-2",
        latest_stamp_completion: "partial",
      },
    ])[0]!;
    expect(item.state).toBe("under_review");
    expect(item.claims[0]).toMatchObject({
      assertedRole: "hirer",
      summary: "Only half the wall was complete.",
    });
    expect(item.claims[0]).toMatchObject({
      sourceReference: "call-42",
      evidenceRefs: ["workmark:w-2"],
    });
    expect(item.evidence).toContainEqual({
      id: "s-2",
      kind: "stamp",
      label: "Stamp",
      detail: "partial",
    });
  });

  it("keeps the hirer claimant fallback and resolution outcome from the queue", () => {
    const [item] = mapExceptionRows([
      {
        exception_id: "e-3",
        state: "resolved",
        version: 7,
        category: "attendance_dispute",
        summary: "Attendance was disputed",
        worker_name: "Amina",
        hirer_name: "Build Co",
        hirer_claimant_id: "20000000-0000-4000-8000-000000000002",
        resolution_outcome: "worker_confirmed",
        resolution_reason: "The hirer confirmed the worker attended.",
        resolved_at: "2026-09-21T09:00:00Z",
      },
    ]);
    expect(item).toBeDefined();
    if (!item) throw new Error("Expected a mapped exception queue item.");
    expect(item.hirerId).toBe("20000000-0000-4000-8000-000000000002");
    expect(item).toMatchObject({
      version: 7,
      resolvedOutcome: "worker_confirmed",
      resolutionReason: "The hirer confirmed the worker attended.",
    });
  });

  it("retains assignment-level evidence when the exception has no direct Workmark", () => {
    const [item] = mapExceptionRows([
      {
        exception_id: "e-4",
        assignment_id: "a-4",
        state: "open",
        category: "attendance_dispute",
        summary: "Assignment evidence needs review",
        worker_name: "Amina",
        hirer_name: "Build Co",
        workmark_evidence_state: "pending",
        stamp_count: 2,
      },
    ]);
    expect(item).toBeDefined();
    if (!item) throw new Error("Expected a mapped exception queue item.");
    expect(item.evidence).toEqual([
      {
        id: "a-4-workmark-evidence",
        kind: "workmark",
        label: "Assignment Workmark evidence",
        detail: "pending",
      },
      {
        id: "a-4-stamp-evidence",
        kind: "stamp",
        label: "Assignment Stamps",
        detail: "2 Stamps recorded",
      },
    ]);
  });

  it("rejects malformed projections instead of rendering unsafe fallback rows", () => {
    expect(() => mapExceptionRows([{ state: "open" }])).toThrow();
  });
});
