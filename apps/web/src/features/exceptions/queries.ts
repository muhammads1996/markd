import { assertQuerySuccess, getOperatorClient } from "../work-graph/queries";

export type ExceptionState = "open" | "under_review" | "resolved";
export type ExceptionType =
  | "payment_dispute"
  | "attendance_dispute"
  | "completion_dispute"
  | "no_show_concern"
  | "cancelled_after_commitment"
  | "cancelled_after_travel_authorisation"
  | "ambiguous_completion"
  | "verification_trust_concern";

export type ExceptionClaim = {
  id: string;
  stance: string;
  summary: string;
  assertedBy: string | null;
  assertedByName: string | null;
  assertedRole: string | null;
  recordedBy: string | null;
  sourceChannel: string | null;
  sourceReference: string | null;
  evidenceRefs: string[];
  createdAt: string | null;
};

export type ExceptionEvidence = {
  id: string;
  kind: "workmark" | "stamp";
  label: string;
  detail: string | null;
};

export type ExceptionQueueItem = {
  id: string;
  assignmentId: string | null;
  workmarkId: string | null;
  state: ExceptionState;
  type: ExceptionType;
  summary: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  workerId: string | null;
  hirerId: string | null;
  workerName: string;
  hirerName: string;
  jobName: string;
  siteName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  travelAuthorisedAt: string | null;
  cancelledAfterTravelAuthorised: boolean;
  nextAction: string | null;
  resolvedOutcome: string | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  claims: ExceptionClaim[];
  evidence: ExceptionEvidence[];
};

export type AssignmentOption = {
  id: string;
  label: string;
  startsOn: string;
  lifecycle: string;
  workerId: string | null;
  hirerId: string | null;
};

type Row = Record<string, unknown>;
type QueryResult = { data: unknown[] | null; error: { message: string } | null };
type DynamicQuery = {
  select(columns: string): DynamicQuery;
  eq(column: string, value: string): DynamicQuery;
  in(column: string, values: string[]): DynamicQuery;
  order(column: string, options: { ascending: boolean }): DynamicQuery;
} & PromiseLike<QueryResult>;

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(row: Row, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(row[key]);
    if (value) return value;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function displayName(row: Row, ...keys: string[]): string {
  return firstString(row, ...keys) ?? "Unknown";
}

function parseState(value: unknown): ExceptionState {
  return value === "under_review" || value === "resolved"
    ? value
    : "open";
}

function claimSummary(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    return (
      firstString(value, "summary", "text", "note", "description") ??
      JSON.stringify(value)
    );
  }
  return "Claim recorded without a summary.";
}

function mapClaim(value: unknown, index: number): ExceptionClaim | null {
  if (!isRecord(value)) return null;
  const id = firstString(value, "id", "claim_id") ?? `claim-${index}`;
  const assertion = isRecord(value.assertion) ? value.assertion : {};
  return {
    id,
    stance: firstString(assertion, "stance", "state", "value") ?? firstString(value, "stance", "claim_stance") ?? "asserted",
    summary: claimSummary(value.statement ?? value.summary ?? value.value ?? value),
    assertedBy: firstString(value, "asserted_by", "claimant_person_id"),
    assertedByName: firstString(value, "asserted_by_name", "claimant_name"),
    assertedRole: firstString(value, "asserted_role", "role", "claimant_role"),
    recordedBy: firstString(value, "recorded_by"),
    sourceChannel: firstString(value, "source_channel", "source"),
    sourceReference: firstString(value, "source_reference"),
    evidenceRefs: Array.isArray(value.evidence_refs)
      ? value.evidence_refs.filter((ref): ref is string => typeof ref === "string")
      : [],
    createdAt: firstString(value, "created_at"),
  };
}

function latestClaimFromRow(row: Row): ExceptionClaim | null {
  const id = firstString(row, "latest_claim_id");
  const statement = firstString(row, "latest_claim_statement");
  if (!id && !statement) return null;
  return {
    id: id ?? "latest-claim",
    stance: firstString(row, "latest_claim_assertion") ?? "asserted",
    summary: statement ?? "Claim recorded without a summary.",
    assertedBy: firstString(row, "latest_claim_asserted_by"),
    assertedByName: firstString(row, "latest_claim_asserted_by_name"),
    assertedRole: firstString(row, "latest_claim_role"),
    recordedBy: null,
    sourceChannel: firstString(row, "latest_claim_source"),
    sourceReference: firstString(row, "latest_claim_source_reference"),
    evidenceRefs: Array.isArray(row.latest_claim_evidence_refs)
      ? row.latest_claim_evidence_refs.filter((ref): ref is string => typeof ref === "string")
      : [],
    createdAt: firstString(row, "latest_claim_occurred_at"),
  };
}

function mapEvidence(value: unknown, kind: ExceptionEvidence["kind"], index: number): ExceptionEvidence | null {
  if (!isRecord(value)) return null;
  const id = firstString(value, "id", `${kind}_id`) ?? `${kind}-${index}`;
  const detailKeys = kind === "stamp"
    ? ["attendance", "completion", "payment"]
    : ["evidence_state", "attendance", "completion", "payment"];
  const structuredDetail = detailKeys
    .flatMap((key) => {
      const detail = firstString(value, key);
      return detail ? [`${key}: ${detail}`] : [];
    })
    .join("; ");
  return {
    id,
    kind,
    label: firstString(value, "label", "type", "provenance") ?? (kind === "workmark" ? "Workmark" : "Stamp"),
    detail: firstString(value, "detail", "summary", "outcome") ?? (structuredDetail || firstString(value, "source")),
  };
}

function collectValues(row: Row, keys: string[]): unknown[] {
  return keys.flatMap((key) => {
    const value = row[key];
    if (Array.isArray(value)) return value;
    return value === undefined || value === null ? [] : [value];
  });
}

function mapQueueRow(row: Row): ExceptionQueueItem {
  const claims = collectValues(row, ["claims", "verification_claims", "claim"])
    .map(mapClaim)
    .filter((claim): claim is ExceptionClaim => claim !== null);
  const latestClaim = latestClaimFromRow(row);
  if (latestClaim && !claims.some((claim) => claim.id === latestClaim.id)) claims.push(latestClaim);
  const evidence = [
    ...collectValues(row, ["workmark_evidence", "workmark"])
      .map((value, index) => mapEvidence(value, "workmark", index))
      .filter((item): item is ExceptionEvidence => item !== null),
    ...collectValues(row, ["stamp_evidence", "stamps", "stamp"])
      .map((value, index) => mapEvidence(value, "stamp", index))
      .filter((item): item is ExceptionEvidence => item !== null),
    ...collectValues(row, ["assignment_workmark_evidence"])
      .map((value, index) => mapEvidence(value, "workmark", index))
      .filter((item): item is ExceptionEvidence => item !== null),
    ...collectValues(row, ["assignment_stamp_evidence", "assignment_stamps"])
      .map((value, index) => mapEvidence(value, "stamp", index))
      .filter((item): item is ExceptionEvidence => item !== null),
  ];
  const workmarkId = firstString(row, "workmark_id");
  const assignmentId = firstString(row, "assignment_id");
  if (workmarkId && !evidence.some((item) => item.kind === "workmark" && item.id === workmarkId)) {
    evidence.unshift({ id: workmarkId, kind: "workmark", label: "Workmark", detail: firstString(row, "workmark_summary", "workmark_source", "workmark_evidence_state") });
  }
  const stampId = firstString(row, "stamp_id", "assignment_stamp_id", "latest_stamp_id");
  if (stampId && !evidence.some((item) => item.kind === "stamp" && item.id === stampId)) {
    evidence.push({ id: stampId, kind: "stamp", label: "Stamp", detail: firstString(row, "stamp_summary", "stamp_source", "latest_stamp_attendance", "latest_stamp_completion", "latest_stamp_payment", "latest_stamp_note") });
  }
  if (!stampId && (firstString(row, "latest_stamp_attendance", "latest_stamp_completion", "latest_stamp_payment", "latest_stamp_note"))) {
    evidence.push({ id: "latest-stamp", kind: "stamp", label: "Stamp", detail: firstString(row, "latest_stamp_note", "latest_stamp_attendance", "latest_stamp_completion", "latest_stamp_payment") });
  }
  const assignmentWorkmarkState = firstString(row, "workmark_evidence_state", "assignment_workmark_evidence_state");
  if (assignmentId && !workmarkId && assignmentWorkmarkState) {
    evidence.push({ id: `${assignmentId}-workmark-evidence`, kind: "workmark", label: "Assignment Workmark evidence", detail: assignmentWorkmarkState });
  }
  const stampCountValue = row.stamp_count ?? row.assignment_stamp_count;
  const stampCount = typeof stampCountValue === "number" ? stampCountValue : Number(stampCountValue);
  if (assignmentId && !stampId && Number.isFinite(stampCount) && stampCount > 0 && !evidence.some((item) => item.kind === "stamp")) {
    evidence.push({ id: `${assignmentId}-stamp-evidence`, kind: "stamp", label: "Assignment Stamps", detail: `${stampCount} Stamp${stampCount === 1 ? "" : "s"} recorded` });
  }
  return {
    id: firstString(row, "id", "exception_id") ?? "",
    assignmentId,
    workmarkId,
    state: parseState(row.state ?? row.status),
    type: (firstString(row, "type", "category", "exception_type") ?? "verification_trust_concern") as ExceptionType,
    summary: firstString(row, "summary", "description", "reason") ?? "No summary recorded.",
    createdAt: firstString(row, "created_at", "opened_at") ?? "",
    updatedAt: firstString(row, "updated_at") ?? firstString(row, "created_at", "opened_at") ?? "",
    version: typeof row.version === "number" && Number.isInteger(row.version) && row.version > 0 ? row.version : 1,
    workerId: firstString(row, "worker_id"),
    hirerId: firstString(row, "hirer_claimant_id", "hirer_person_id", "hirer_id", "organisation_contact_id"),
    workerName: displayName(row, "worker_name", "worker_display_name"),
    hirerName: displayName(row, "organisation_name", "contractor_name", "hirer_name", "hirer_display_name"),
    jobName: displayName(row, "job_name", "work_type", "job_title", "labour_request_title", "job_terms"),
    siteName: firstString(row, "site_name", "site_display_name", "location_name"),
    startsOn: firstString(row, "starts_on", "work_started_on", "work_date", "job_needed_from", "job_needed_at"),
    endsOn: firstString(row, "ends_on", "work_ended_on", "work_date", "job_needed_to"),
    travelAuthorisedAt: firstString(row, "travel_authorised_at"),
    cancelledAfterTravelAuthorised: booleanValue(row.cancelled_after_travel_authorised),
    nextAction: firstString(row, "next_action", "recommended_next_action") ??
      (parseState(row.state ?? row.status) === "open"
        ? "Add a participant counterclaim or review note."
        : parseState(row.state ?? row.status) === "under_review"
          ? "Review the evidence and record a resolution."
          : null),
    resolvedOutcome: firstString(row, "resolution_outcome", "resolved_outcome", "outcome"),
    resolutionReason: firstString(row, "resolution_reason", "resolution", "reason"),
    resolvedAt: firstString(row, "resolved_at"),
    resolvedBy: firstString(row, "resolved_by_user_id"),
    claims,
    evidence,
  };
}

/** Maps the intentionally operator-only queue projection without exposing raw private tables. */
export function mapExceptionRows(rows: unknown): ExceptionQueueItem[] {
  if (!Array.isArray(rows)) throw new Error("Unable to load the Exceptions queue.");
  const mapped = new Map<string, ExceptionQueueItem>();
  for (const value of rows) {
    if (!isRecord(value)) throw new Error("Unable to load the Exceptions queue.");
    const item = mapQueueRow(value);
    if (!item.id) throw new Error("Unable to load the Exceptions queue.");
    const existing = mapped.get(item.id);
    if (!existing) {
      mapped.set(item.id, item);
      continue;
    }
    existing.claims = [...existing.claims, ...item.claims.filter((claim) => !existing.claims.some((current) => current.id === claim.id))];
    existing.evidence = [...existing.evidence, ...item.evidence.filter((entry) => !existing.evidence.some((current) => current.id === entry.id))];
  }
  return [...mapped.values()];
}

export async function listExceptions(state: "active" | "resolved" | "all" = "active") {
  const supabase = await getOperatorClient();
  if (!supabase) return [];
  const client = supabase as unknown as { from(table: string): DynamicQuery };
  let query = client.from("operator_exception_queue").select("*").order("opened_at", { ascending: false });
  if (state === "active") query = query.in("state", ["open", "under_review"]);
  if (state === "resolved") query = query.eq("state", "resolved");
  const result = await query;
  assertQuerySuccess(result.error, "loading the Exceptions queue");
  const items = mapExceptionRows(result.data ?? []);
  const assignmentIds = items.flatMap((item) => item.assignmentId ? [item.assignmentId] : []);
  if (assignmentIds.length === 0) return items;
  const [workmarks, stamps] = await Promise.all([
    supabase
      .from("workmarks")
      .select("id, assignment_id, evidence_state, attendance, completion, payment, source")
      .in("assignment_id", assignmentIds)
      .is("archived_at", null),
    supabase
      .from("assignment_stamps")
      .select("id, assignment_id, attendance, completion, payment, note, source")
      .in("assignment_id", assignmentIds),
  ]);
  assertQuerySuccess(workmarks.error, "loading assignment Workmark evidence");
  assertQuerySuccess(stamps.error, "loading assignment Stamp evidence");
  const byAssignment = new Map<string, ExceptionQueueItem>();
  for (const item of items) if (item.assignmentId) byAssignment.set(item.assignmentId, item);
  for (const row of workmarks.data ?? []) {
    const assignmentId = row.assignment_id;
    const item = byAssignment.get(assignmentId);
    const evidence = mapEvidence(row as unknown as Row, "workmark", 0);
    if (item && evidence && !item.evidence.some((entry) => entry.id === evidence.id)) item.evidence.push(evidence);
  }
  for (const row of stamps.data ?? []) {
    const assignmentId = row.assignment_id;
    const item = byAssignment.get(assignmentId);
    const evidence = mapEvidence(row as unknown as Row, "stamp", 0);
    if (item && evidence && !item.evidence.some((entry) => entry.id === evidence.id)) item.evidence.push(evidence);
  }
  return items;
}

export async function listAssignmentOptions(): Promise<AssignmentOption[]> {
  const supabase = await getOperatorClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("assignments")
    .select("id, starts_on, lifecycle, worker_id, organisation_id, site_id")
    .is("archived_at", null)
    .order("starts_on", { ascending: false })
    .limit(50);
  assertQuerySuccess(error, "loading assignment options");
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const workerIds = rows.flatMap((row) => typeof row.worker_id === "string" ? [row.worker_id] : []);
  const organisationIds = rows.flatMap((row) => typeof row.organisation_id === "string" ? [row.organisation_id] : []);
  const [workers, organisations, contacts] = await Promise.all([
    workerIds.length ? supabase.from("operator_work_cards").select("worker_id, display_name, preferred_name").in("worker_id", workerIds) : Promise.resolve({ data: [], error: null }),
    organisationIds.length ? supabase.from("organisations").select("id, display_name").in("id", organisationIds) : Promise.resolve({ data: [], error: null }),
    organisationIds.length ? supabase.from("organisation_contacts").select("organisation_id, person_id, archived_at").in("organisation_id", organisationIds).is("archived_at", null) : Promise.resolve({ data: [], error: null }),
  ]);
  assertQuerySuccess(workers.error, "loading assignment workers");
  assertQuerySuccess(organisations.error, "loading assignment hirers");
  assertQuerySuccess(contacts.error, "loading assignment hirer contacts");
  const workerNames = new Map((workers.data ?? []).map((row) => [String(row.worker_id), firstString(row, "preferred_name", "display_name") ?? "Unknown worker"]));
  const organisationNames = new Map((organisations.data ?? []).map((row) => [String(row.id), firstString(row, "display_name") ?? "Unknown hirer"]));
  const hirerIds = new Map((contacts.data ?? []).map((row) => [String(row.organisation_id), firstString(row, "person_id")]));
  return rows.map((row) => {
    const id = String(row.id);
    const worker = workerNames.get(String(row.worker_id)) ?? "Unknown worker";
    const hirer = organisationNames.get(String(row.organisation_id)) ?? "Unknown hirer";
    const startsOn = String(row.starts_on);
    return { id, startsOn, lifecycle: String(row.lifecycle ?? ""), workerId: typeof row.worker_id === "string" ? row.worker_id : null, hirerId: hirerIds.get(String(row.organisation_id)) ?? null, label: `${worker} · ${hirer} · ${startsOn} · ${id.slice(0, 8)}` };
  });
}
