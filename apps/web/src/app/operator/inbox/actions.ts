"use server";

import { revalidatePath } from "next/cache";

import { createMarkdApiClient } from "../../../lib/markd-api";

export type InboxActionState = { error?: string };

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function coerceFieldValue(raw: string): string | number | boolean | null {
  if (raw === "") return null;
  if (raw === "true" || raw === "false") return raw === "true";
  if (raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function collectPrefixed(
  formData: FormData,
  prefix: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(prefix) && typeof value === "string") {
      result[key.slice(prefix.length)] = value;
    }
  }
  return result;
}

/** Confirms a proposed action, optionally applying operator edits. Editing
 * fields on an ambiguous draft resolves it to "clear" in the same atomic
 * approval, so a proposed action is never left half-edited. */
export async function confirmProposedAction(
  _previousState: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  const id = formValue(formData, "id");
  const actionType = formValue(formData, "actionType");
  const ambiguity = formValue(formData, "ambiguity");
  if (!id || !actionType) return { error: "This proposed action is missing." };

  const rawFields = collectPrefixed(formData, "field.");
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    fields[key] = coerceFieldValue(value);
  }
  const entityIds = collectPrefixed(formData, "entity.");

  try {
    const api = await createMarkdApiClient();
    const isWorkCompletion = actionType === "work_completion";
    const assignmentId = entityIds.assignmentId;
    const assertedById = entityIds.assertedById ?? entityIds.workerId;
    const assertedRole =
      entityIds.assertedRole ?? (entityIds.workerId ? "worker" : undefined);
    if (
      isWorkCompletion &&
      (!assignmentId ||
        !assertedById ||
        (assertedRole !== "worker" && assertedRole !== "hirer"))
    ) {
      return {
        error:
          "This WhatsApp closeout has unresolved source evidence. Capture it as a new Ops Stamp instead.",
      };
    }
    const paymentAmount = fields.amount_minor;
    const paymentCurrency = fields.currency;
    const requestBody = isWorkCompletion
      ? {
          work_completion: {
            assignment_id: assignmentId,
            stamp: {
              attendance: fields.attendance,
              completion: fields.completion,
              reuse_preference: fields.reuse_preference,
              payment: {
                state: fields.payment_state,
                ...(typeof paymentAmount === "number"
                  ? { amount_minor: paymentAmount }
                  : {}),
                ...(typeof paymentCurrency === "string" && paymentCurrency
                  ? { currency: paymentCurrency.toUpperCase() }
                  : {}),
                ...(typeof fields.payment_method === "string" &&
                fields.payment_method
                  ? { method: fields.payment_method }
                  : {}),
              },
              ...(typeof fields.note === "string" && fields.note
                ? { note: fields.note }
                : {}),
              asserted_by: assertedById,
              asserted_role: assertedRole,
            },
          },
        }
      : {
          action_type: actionType,
          fields,
          entity_ids: entityIds,
          resolve_ambiguity: ambiguity !== "clear",
        };
    await api.json(
      `/api/v1/proposed-actions/${id}/${isWorkCompletion ? "confirm" : "approve"}`,
      {
        body: JSON.stringify({
          ...requestBody,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `proposed-action-${isWorkCompletion ? "confirm" : "approve"}-${id}`,
        },
        method: "POST",
      },
    );
  } catch {
    return { error: "Unable to confirm this proposed action." };
  }
  revalidatePath("/operator/inbox");
  return {};
}

export async function rejectProposedAction(
  _previousState: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  const id = formValue(formData, "id");
  const reason = formValue(formData, "reason").trim();
  if (!id) return { error: "This proposed action is missing." };
  if (!reason) return { error: "A rejection reason is required." };

  try {
    const api = await createMarkdApiClient();
    await api.json(`/api/v1/proposed-actions/${id}/reject`, {
      body: JSON.stringify({ reason }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `proposed-action-reject-${id}`,
      },
      method: "POST",
    });
  } catch {
    return { error: "Unable to reject this proposed action." };
  }
  revalidatePath("/operator/inbox");
  return {};
}
