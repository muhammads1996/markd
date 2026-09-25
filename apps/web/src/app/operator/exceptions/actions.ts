"use server";

import { revalidatePath } from "next/cache";

import { getOperatorClient } from "../../../features/work-graph/queries";
import { createMarkdApiClient } from "../../../lib/markd-api";

export type ExceptionActionState = { error?: string; saved?: boolean };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXCEPTION_TYPES = new Set([
  "payment_dispute",
  "attendance_dispute",
  "completion_dispute",
  "no_show_concern",
  "cancelled_after_commitment",
  "cancelled_after_travel_authorisation",
  "ambiguous_completion",
  "verification_trust_concern",
]);
const CLAIM_ROLES = new Set(["worker", "hirer", "operator"]);
const SOURCES = new Set(["operator_ui", "call", "in_person"]);

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requiredUuid(
  formData: FormData,
  name: string,
  _label: string,
): string | null {
  const value = formValue(formData, name);
  return value && UUID.test(value) ? value : null;
}

function bounded(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max;
}

function commandKey(prefix: string, nonce: string): string {
  return `${prefix}-${nonce}`;
}

async function requireOperator(): Promise<void> {
  const supabase = await getOperatorClient();
  if (!supabase) throw new Error("An active operator session is required.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    throw new Error("An active operator session is required.");
}

export async function openException(
  _previousState: ExceptionActionState,
  formData: FormData,
): Promise<ExceptionActionState> {
  const assignmentId = requiredUuid(formData, "assignmentId", "assignment");
  const type = formValue(formData, "type");
  const summary = formValue(formData, "summary");
  const assertedRole = formValue(formData, "assertedRole");
  const assertedBy = formValue(formData, "assertedBy");
  const source = formValue(formData, "source");
  const submissionNonce = formValue(formData, "submissionNonce");
  if (!assignmentId) return { error: "Choose a valid assignment." };
  if (!EXCEPTION_TYPES.has(type)) return { error: "Choose an exception type." };
  if (!bounded(summary, 5, 1_000))
    return { error: "Add a summary between 5 and 1,000 characters." };
  if (!CLAIM_ROLES.has(assertedRole))
    return { error: "Choose who raised this concern." };
  if (assertedRole === "operator" && assertedBy)
    return { error: "Operator concerns cannot assert a participant." };
  if (assertedRole !== "operator" && !UUID.test(assertedBy))
    return { error: "Choose the participant who raised this concern." };
  if (!SOURCES.has(source))
    return { error: "Choose the source of this concern." };
  if (!UUID.test(submissionNonce))
    return { error: "This form has expired. Refresh and try again." };
  try {
    await requireOperator();
    const api = await createMarkdApiClient();
    const payload = {
      type,
      summary,
      statement: summary,
      ...(assertedBy ? { asserted_by: assertedBy } : {}),
      asserted_role: assertedRole,
      source,
    };
    await api.json(`/api/v1/assignments/${assignmentId}/exceptions`, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandKey("operator-exception", submissionNonce),
      },
      method: "POST",
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to open this exception.",
    };
  }
  revalidatePath("/operator/exceptions");
  revalidatePath("/operator");
  return { saved: true };
}

export async function addExceptionClaim(
  _previousState: ExceptionActionState,
  formData: FormData,
): Promise<ExceptionActionState> {
  const exceptionId = requiredUuid(formData, "exceptionId", "exception");
  const summary = formValue(formData, "summary");
  const assertedRole = formValue(formData, "assertedRole");
  const assertedBy = formValue(formData, "assertedBy");
  const source = formValue(formData, "source");
  const submissionNonce = formValue(formData, "submissionNonce");
  if (!exceptionId) return { error: "This exception is missing." };
  if (!bounded(summary, 3, 1_000))
    return { error: "Add a claim between 3 and 1,000 characters." };
  if (!CLAIM_ROLES.has(assertedRole))
    return { error: "Choose who made the claim." };
  if (assertedRole === "operator" && assertedBy)
    return { error: "Operator notes cannot assert a participant." };
  if (assertedRole !== "operator" && !UUID.test(assertedBy))
    return { error: "Choose the participant making the claim." };
  if (!SOURCES.has(source))
    return { error: "Choose the source of this claim." };
  if (!UUID.test(submissionNonce))
    return { error: "This form has expired. Refresh and try again." };
  try {
    await requireOperator();
    const api = await createMarkdApiClient();
    const payload = {
      statement: summary,
      assertion: { stance: "asserted" },
      ...(assertedBy ? { asserted_by: assertedBy } : {}),
      asserted_role: assertedRole,
      source,
    };
    await api.json(`/api/v1/exceptions/${exceptionId}/claims`, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandKey(
          "operator-exception-claim",
          submissionNonce,
        ),
      },
      method: "POST",
    });
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to add this claim.",
    };
  }
  revalidatePath("/operator/exceptions");
  return { saved: true };
}

export async function resolveException(
  _previousState: ExceptionActionState,
  formData: FormData,
): Promise<ExceptionActionState> {
  const exceptionId = requiredUuid(formData, "exceptionId", "exception");
  const resolution = formValue(formData, "resolution");
  const outcome = formValue(formData, "outcome");
  const expectedVersion = formValue(formData, "expectedVersion");
  const submissionNonce = formValue(formData, "submissionNonce");
  if (!exceptionId) return { error: "This exception is missing." };
  if (!bounded(resolution, 3, 1_000))
    return { error: "Add a resolution note between 3 and 1,000 characters." };
  if (outcome !== "resolved" && outcome !== "dismissed")
    return { error: "Choose a resolution outcome." };
  if (!/^\d+$/.test(expectedVersion) || Number(expectedVersion) < 1)
    return { error: "This exception is out of date. Refresh and try again." };
  if (!UUID.test(submissionNonce))
    return { error: "This form has expired. Refresh and try again." };
  try {
    await requireOperator();
    const api = await createMarkdApiClient();
    await api.json(`/api/v1/exceptions/${exceptionId}/resolve`, {
      body: JSON.stringify({
        outcome,
        reason: resolution,
        expected_version: Number(expectedVersion),
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandKey(
          "operator-exception-resolve",
          submissionNonce,
        ),
      },
      method: "POST",
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to resolve this exception.",
    };
  }
  revalidatePath("/operator/exceptions");
  revalidatePath("/operator");
  return { saved: true };
}
