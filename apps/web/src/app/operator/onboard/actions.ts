"use server";

import {
  createOnboardingGateway,
  WorkerOnboardingDraftError,
} from "./onboarding-gateway";
import {
  parseOrganisationOnboarding,
  parseWorkerOnboarding,
  parseWorkerUpdate,
  type OnboardingFormState,
} from "./onboarding";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function submitOnboarding(
  _previousState: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  try {
    const supabase = await createSupabaseServerClient();
    const gateway = createOnboardingGateway(supabase);
    const requestedWorkerId = formValue(formData, "requestedWorkerId");
    const workerId = formValue(formData, "workerId");
    const organisationId = formValue(formData, "organisationId");
    if (workerId && organisationId) {
      return { error: "Choose one record to edit." };
    }
    if (formData.get("intent") === "cancel-worker") {
      if (!requestedWorkerId)
        return { error: "There is no worker draft to cancel." };
      await gateway.cancelWorker(requestedWorkerId);
      return {};
    }
    if (formData.get("kind") === "organisation") {
      const input = parseOrganisationOnboarding(formData);
      const saved = organisationId
        ? await gateway.updateOrganisation(organisationId, input)
        : await gateway.saveOrganisation(input);
      return { saved: { kind: input.kind, id: saved.id } };
    }
    if (workerId) {
      const input = parseWorkerUpdate(formData);
      const saved = await gateway.updateWorker(workerId, input);
      return { saved: { kind: input.kind, id: saved.id } };
    }
    const input = parseWorkerOnboarding(formData);
    const saved = await gateway.saveWorker(
      input,
      requestedWorkerId || crypto.randomUUID(),
    );
    return { saved: { kind: input.kind, id: saved.id } };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to prepare this record.";
    return error instanceof WorkerOnboardingDraftError
      ? { draft: error.draft, error: message }
      : { error: message };
  }
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
