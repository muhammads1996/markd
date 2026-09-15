import type {
  OrganisationOnboardingInput,
  WorkerOnboardingDraft,
  WorkerOnboardingInput,
  WorkerRecordInput,
} from "./onboarding";

/**
 * Application boundary for FLO-106. Each mutation goes through an
 * authenticated active-operator command/RPC rather than client table writes.
 *
 * The worker flow is draft-first: an atomic RPC creates/resumes a draft and
 * reserves its private asset path, then completion verifies the uploaded
 * storage object before allowing an active/inactive record.
 */
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

type RpcResult = { data: unknown; error: { message: string } | null };

export interface OnboardingRpcClient {
  rpc(
    functionName: string,
    arguments_: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
  storage: {
    from(bucketId: string): {
      upload(
        path: string,
        body: File,
        options: { upsert: boolean },
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export class WorkerOnboardingDraftError extends Error {
  constructor(
    message: string,
    readonly draft: WorkerOnboardingDraft,
  ) {
    super(message);
  }
}

export function createOnboardingGateway(
  client: OnboardingRpcClient,
): OnboardingGateway {
  return {
    async saveOrganisation(input) {
      const result = await client.rpc("onboard_organisation", {
        contact_display_name: input.contactName,
        contact_phone_number: input.whatsappPhone,
        display_name: input.organisationName ?? input.contactName,
        legal_name: input.organisationName ?? input.contactName,
        operating_area_ids: input.operatingAreaIds,
        record_status: input.recordStatus,
        typical_skill_ids: input.typicalSkillIds,
      });
      if (result.error) throw new Error(result.error.message);
      if (typeof result.data !== "string") {
        throw new Error("Onboarding did not return an organisation id.");
      }
      return { id: result.data };
    },
    async saveWorker(input, requestedWorkerId) {
      const begun = await client.rpc("begin_worker_onboarding", {
        payload: workerPayload(input),
        requested_worker_id: requestedWorkerId,
      });
      if (begun.error) throw new Error(begun.error.message);
      const draft = readWorkerDraft(begun.data);
      const upload = await client.storage
        .from(draft.bucketId)
        .upload(draft.objectPath, input.portrait, { upsert: true });
      if (upload.error)
        throw new WorkerOnboardingDraftError(upload.error.message, draft);

      const completed = await client.rpc("complete_worker_onboarding", {
        object_path: draft.objectPath,
        portrait_asset_id: draft.portraitAssetId,
        target_status: input.recordStatus,
        worker_id: draft.workerId,
      });
      if (completed.error)
        throw new WorkerOnboardingDraftError(completed.error.message, draft);
      if (typeof completed.data !== "string") {
        throw new WorkerOnboardingDraftError(
          "Onboarding did not return a worker id.",
          draft,
        );
      }
      return { id: completed.data };
    },
    async updateWorker(workerId, input) {
      const result = await client.rpc("update_worker_record", {
        payload: workerPayload(input),
        worker_id: workerId,
      });
      return readSavedId(result, "worker");
    },
    async updateOrganisation(organisationId, input) {
      const result = await client.rpc("update_organisation_record", {
        organisation_id: organisationId,
        payload: {
          contact_display_name: input.contactName,
          contact_phone_number: input.whatsappPhone,
          display_name: input.organisationName ?? input.contactName,
          legal_name: input.organisationName ?? input.contactName,
          operating_area_ids: input.operatingAreaIds,
          record_status: input.recordStatus,
          typical_skill_ids: input.typicalSkillIds,
        },
      });
      return readSavedId(result, "organisation");
    },
    async cancelWorker(workerId) {
      const result = await client.rpc("cancel_worker_onboarding", {
        worker_id: workerId,
      });
      if (result.error) throw new Error(result.error.message);
    },
  };
}

function workerPayload(input: WorkerRecordInput): Record<string, unknown> {
  return {
    app_participation: input.appParticipation,
    base_area_id: input.baseAreaId,
    display_name: input.displayName,
    familiar_area_ids: input.familiarAreaIds,
    area_preferences: areaPreferences(input),
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

function areaPreferences(input: WorkerRecordInput) {
  const familiar = new Set(input.familiarAreaIds);
  const travel = new Set(input.willingToTravelAreaIds);
  return [...new Set([...familiar, ...travel])].map((areaId) => ({
    area_id: areaId,
    is_familiar: familiar.has(areaId),
    willing_to_travel: travel.has(areaId),
  }));
}

function readSavedId(result: RpcResult, kind: "worker" | "organisation") {
  if (result.error) throw new Error(result.error.message);
  if (typeof result.data !== "string") {
    throw new Error(`Onboarding did not return a ${kind} id.`);
  }
  return { id: result.data };
}

function readWorkerDraft(data: unknown): WorkerOnboardingDraft {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object")
    throw new Error("Onboarding did not return a worker draft.");
  const value = row as Record<string, unknown>;
  if (
    typeof value.worker_id !== "string" ||
    typeof value.portrait_asset_id !== "string" ||
    typeof value.bucket_id !== "string" ||
    typeof value.object_path !== "string"
  ) {
    throw new Error("Onboarding returned an invalid worker draft.");
  }
  return {
    bucketId: value.bucket_id,
    objectPath: value.object_path,
    portraitAssetId: value.portrait_asset_id,
    workerId: value.worker_id,
  };
}
