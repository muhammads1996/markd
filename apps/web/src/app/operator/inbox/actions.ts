"use server";

import { revalidatePath } from "next/cache";

import { getOperatorClient } from "../../../features/work-graph/queries";

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

  const supabase = await getOperatorClient();
  if (!supabase) return { error: "An active operator session is required." };
  const { error } = await supabase.rpc("approve_proposed_action", {
    action_id: id,
    edited_payload: { actionType, fields, entityIds },
    resolve_ambiguity: ambiguity !== "clear",
  });
  if (error) return { error: "Unable to confirm this proposed action." };
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

  const supabase = await getOperatorClient();
  if (!supabase) return { error: "An active operator session is required." };
  const { error } = await supabase.rpc("reject_proposed_action", {
    action_id: id,
    reason,
  });
  if (error) return { error: "Unable to reject this proposed action." };
  revalidatePath("/operator/inbox");
  return {};
}
