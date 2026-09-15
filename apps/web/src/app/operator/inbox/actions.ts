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
    await api.json(`/api/v1/proposed-actions/${id}/approve`, {
      body: JSON.stringify({
        action_type: actionType,
        fields,
        entity_ids: entityIds,
        resolve_ambiguity: ambiguity !== "clear",
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `proposed-action-approve-${id}`,
      },
      method: "POST",
    });
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
