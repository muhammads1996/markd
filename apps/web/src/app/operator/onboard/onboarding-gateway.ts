import type {
  OrganisationOnboardingInput,
  WorkerOnboardingDraft,
  WorkerOnboardingInput,
  WorkerRecordInput,
} from "./onboarding";
import type { MarkdApiClient } from "../../../lib/markd-api";

export interface OnboardingGateway {
  saveOrganisation(input: OrganisationOnboardingInput): Promise<{ id: string }>;
  saveWorker(
    input: WorkerOnboardingInput,
    requestedWorkerId: string,
  ): Promise<{ id: string }>;
  updateWorker(
    workerId: string,
    input: WorkerRecordInput,
  ): Promise<{ id: string }>;
  updateOrganisation(
    organisationId: string,
    input: OrganisationOnboardingInput,
  ): Promise<{ id: string }>;
  cancelWorker(workerId: string): Promise<void>;
}

type WorkerDraftResponse = {
  worker_id: string;
  portrait_asset_id: string;
  bucket_id: string;
  object_path: string;
  command_id: string;
};

export class WorkerOnboardingDraftError extends Error {
  constructor(
    message: string,
    readonly draft: WorkerOnboardingDraft,
  ) {
    super(message);
  }
}

export function createOnboardingGateway(
  client: MarkdApiClient,
): OnboardingGateway {
  return {
    async saveOrganisation(input) {
      const response = await client.json<{ organisation_id: string }>(
        "/api/v1/onboarding/organisations",
        jsonCommand(organisationPayload(input)),
      );
      return { id: response.organisation_id };
    },
    async saveWorker(input, requestedWorkerId) {
      const draftResponse = await client.json<WorkerDraftResponse>(
        `/api/v1/onboarding/workers/${requestedWorkerId}/begin`,
        jsonCommand(workerPayload(input), `worker-begin-${requestedWorkerId}`),
      );
      const draft = readWorkerDraft(draftResponse);
      const upload = new FormData();
      upload.set("asset_id", draft.portraitAssetId);
      upload.set("object_path", draft.objectPath);
      upload.set("portrait", input.portrait);
      try {
        await client.upload(
          `/api/v1/onboarding/workers/${draft.workerId}/portrait`,
          upload,
          `worker-portrait-${draft.workerId}`,
        );
        const completed = await client.json<{ worker_id: string }>(
          `/api/v1/onboarding/workers/${draft.workerId}/complete`,
          jsonCommand(
            {
              portrait_asset_id: draft.portraitAssetId,
              object_path: draft.objectPath,
              target_status: input.recordStatus,
            },
            `worker-complete-${draft.workerId}`,
          ),
        );
        return { id: completed.worker_id };
      } catch (error) {
        throw new WorkerOnboardingDraftError(
          error instanceof Error
            ? error.message
            : "Unable to complete worker onboarding.",
          draft,
        );
      }
    },
    async updateWorker(workerId, input) {
      const response = await client.json<{ worker_id: string }>(
        `/api/v1/workers/${workerId}`,
        jsonCommand(workerPayload(input), `worker-update-${workerId}`, "PATCH"),
      );
      return { id: response.worker_id };
    },
    async updateOrganisation(organisationId, input) {
      const response = await client.json<{ organisation_id: string }>(
        `/api/v1/organisations/${organisationId}`,
        jsonCommand(
          organisationPayload(input),
          `organisation-update-${organisationId}`,
          "PATCH",
        ),
      );
      return { id: response.organisation_id };
    },
    async cancelWorker(workerId) {
      await client.json(`/api/v1/onboarding/workers/${workerId}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": `worker-cancel-${workerId}` },
      });
    },
  };
}

function jsonCommand(
  payload: unknown,
  idempotencyKey = crypto.randomUUID(),
  method = "POST",
) {
  return {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    method,
  };
}

function workerPayload(input: WorkerRecordInput): Record<string, unknown> {
  return {
    app_participation: input.appParticipation,
    base_area_id: input.baseAreaId,
    display_name: input.displayName,
    familiar_area_ids: input.familiarAreaIds,
    language_ids: [input.preferredLanguageId],
    phone_number: input.whatsappPhone,
    preferred_communication_mode: input.preferredCommunicationMode,
    preferred_language_id: input.preferredLanguageId,
    read_aloud_enabled: input.readAloudEnabled,
    record_status: input.recordStatus,
    skill_ids: input.primarySkillIds,
    willing_to_travel_area_ids: input.willingToTravelAreaIds,
  };
}

function organisationPayload(input: OrganisationOnboardingInput) {
  const name = input.organisationName ?? input.contactName;
  return {
    organisation_name: input.organisationName,
    contact_name: input.contactName,
    whatsapp_phone: input.whatsappPhone,
    operating_area_ids: input.operatingAreaIds,
    typical_skill_ids: input.typicalSkillIds,
    record_status: input.recordStatus,
    legal_name: name,
    display_name: name,
  };
}

function readWorkerDraft(data: WorkerDraftResponse): WorkerOnboardingDraft {
  if (
    typeof data.worker_id !== "string" ||
    typeof data.portrait_asset_id !== "string" ||
    typeof data.bucket_id !== "string" ||
    typeof data.object_path !== "string"
  ) {
    throw new Error("Onboarding returned an invalid worker draft.");
  }
  return {
    bucketId: data.bucket_id,
    objectPath: data.object_path,
    portraitAssetId: data.portrait_asset_id,
    workerId: data.worker_id,
  };
}
