import { describe, expect, it } from "vitest";

import {
  normalizeE164Phone,
  parseOrganisationOnboarding,
  parseWorkerOnboarding,
  parseWorkerUpdate,
} from "../../apps/web/src/app/operator/onboard/onboarding.ts";
import {
  createOnboardingGateway,
  type OnboardingRpcClient,
} from "../../apps/web/src/app/operator/onboard/onboarding-gateway.ts";

const portrait = new File(["image"], "portrait.jpg", { type: "image/jpeg" });

function workerForm() {
  const form = new FormData();
  form.set("displayName", "Themba");
  form.set("whatsappPhone", "+27 82 123 4567");
  form.set("preferredLanguageId", "language-id");
  form.set("preferredCommunicationMode", "voice");
  form.set("baseAreaId", "area-id");
  form.append("primarySkillIds", "skill-id");
  form.set("recordStatus", "active");
  form.set("appParticipation", "whatsapp_only");
  form.set("readAloudEnabled", "on");
  form.append("familiarAreaIds", "area-a");
  form.append("willingToTravelAreaIds", "area-b");
  form.set("portrait", portrait);
  return form;
}

function client(
  responses: Array<{ data: unknown; error: { message: string } | null }>,
  uploadError: string | null = null,
) {
  const calls: Array<{ arguments_: Record<string, unknown>; name: string }> =
    [];
  const value: OnboardingRpcClient = {
    rpc: async (name, arguments_) => {
      calls.push({ arguments_, name });
      return (
        responses.shift() ?? {
          data: null,
          error: { message: "missing response" },
        }
      );
    },
    storage: {
      from: () => ({
        upload: async () => ({
          error: uploadError ? { message: uploadError } : null,
        }),
      }),
    },
  };
  return { calls, value };
}

describe("onboarding input", () => {
  it("normalizes an E.164 WhatsApp number", () =>
    expect(normalizeE164Phone("+27 82 123 4567")).toBe("+27821234567"));
  it("rejects a local-format phone number", () =>
    expect(() => normalizeE164Phone("082 123 4567")).toThrow(
      "international format",
    ));
  it("parses the minimum worker record with separable preferences", () => {
    expect(parseWorkerOnboarding(workerForm())).toMatchObject({
      appParticipation: "whatsapp_only",
      familiarAreaIds: ["area-a"],
      kind: "worker",
      preferredCommunicationMode: "voice",
      readAloudEnabled: true,
      whatsappPhone: "+27821234567",
      willingToTravelAreaIds: ["area-b"],
    });
  });
  it("does not require a portrait when editing a worker", () => {
    const form = workerForm();
    form.delete("portrait");
    expect(parseWorkerUpdate(form)).toMatchObject({
      kind: "worker",
      displayName: "Themba",
    });
  });
  it("requires contractor areas and typical work ids", () => {
    const form = new FormData();
    form.set("organisationName", "Maseko Plumbing");
    form.set("contactName", "Lerato");
    form.set("whatsappPhone", "+27821234567");
    form.append("operatingAreaIds", "area-id");
    form.append("typicalSkillIds", "skill-id");
    form.set("recordStatus", "active");
    expect(parseOrganisationOnboarding(form)).toMatchObject({
      kind: "organisation",
      operatingAreaIds: ["area-id"],
      typicalSkillIds: ["skill-id"],
    });
  });
});

describe("worker draft gateway", () => {
  const draft = {
    bucket_id: "worker-portraits",
    object_path: "workers/worker-id/portrait.jpg",
    portrait_asset_id: "asset-id",
    worker_id: "worker-id",
  };

  it("begins, uploads privately, then completes with exact RPC arguments", async () => {
    const fake = client([
      { data: [draft], error: null },
      { data: "worker-id", error: null },
    ]);
    await expect(
      createOnboardingGateway(fake.value).saveWorker(
        parseWorkerOnboarding(workerForm()),
        "requested-id",
      ),
    ).resolves.toEqual({ id: "worker-id" });
    expect(fake.calls).toEqual([
      {
        name: "begin_worker_onboarding",
        arguments_: {
          requested_worker_id: "requested-id",
          payload: expect.objectContaining({
            display_name: "Themba",
            preferred_communication_mode: "voice",
            app_participation: "whatsapp_only",
          }),
        },
      },
      {
        name: "complete_worker_onboarding",
        arguments_: {
          worker_id: "worker-id",
          portrait_asset_id: "asset-id",
          object_path: "workers/worker-id/portrait.jpg",
          target_status: "active",
        },
      },
    ]);
  });
  it("returns a resumable draft when private upload fails", async () => {
    const fake = client([{ data: draft, error: null }], "network unavailable");
    await expect(
      createOnboardingGateway(fake.value).saveWorker(
        parseWorkerOnboarding(workerForm()),
        "requested-id",
      ),
    ).rejects.toMatchObject({
      draft: { workerId: "worker-id" },
      message: "network unavailable",
    });
  });
  it("cancels a resumable draft through the command RPC", async () => {
    const fake = client([{ data: "worker-id", error: null }]);
    await expect(
      createOnboardingGateway(fake.value).cancelWorker("worker-id"),
    ).resolves.toBeUndefined();
    expect(fake.calls).toEqual([
      {
        name: "cancel_worker_onboarding",
        arguments_: { worker_id: "worker-id" },
      },
    ]);
  });
  it("uses record update RPCs without direct client table writes", async () => {
    const fake = client([
      { data: "worker-id", error: null },
      { data: "organisation-id", error: null },
    ]);
    const gateway = createOnboardingGateway(fake.value);
    await gateway.updateWorker("worker-id", parseWorkerUpdate(workerForm()));
    const organisation = new FormData();
    organisation.set("contactName", "Lerato");
    organisation.set("whatsappPhone", "+27821234567");
    organisation.append("operatingAreaIds", "area-id");
    organisation.append("typicalSkillIds", "skill-id");
    organisation.set("recordStatus", "active");
    await gateway.updateOrganisation(
      "organisation-id",
      parseOrganisationOnboarding(organisation),
    );
    expect(fake.calls).toEqual([
      {
        name: "update_worker_record",
        arguments_: {
          worker_id: "worker-id",
          payload: expect.objectContaining({ display_name: "Themba" }),
        },
      },
      {
        name: "update_organisation_record",
        arguments_: {
          organisation_id: "organisation-id",
          payload: expect.objectContaining({ contact_display_name: "Lerato" }),
        },
      },
    ]);
  });
});
