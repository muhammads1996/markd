import { describe, expect, it } from "vitest";

import {
  normalizeE164Phone,
  parseOrganisationOnboarding,
  parseWorkerOnboarding,
  parseWorkerUpdate,
} from "../../apps/web/src/app/operator/onboard/onboarding.ts";
import { createOnboardingGateway } from "../../apps/web/src/app/operator/onboard/onboarding-gateway.ts";
import type { MarkdApiClient } from "../../apps/web/src/lib/markd-api.ts";

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

function client(responses: unknown[], uploadError: string | null = null) {
  const calls: Array<{
    body?: unknown;
    key?: string | undefined;
    path: string;
  }> = [];
  const value: MarkdApiClient = {
    json: async (path, options) => {
      calls.push({
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
        key: options?.headers?.["Idempotency-Key"],
        path,
      });
      return (responses.shift() ?? {}) as never;
    },
    upload: async (path, _body, key) => {
      calls.push({ key, path });
      if (uploadError) throw new Error(uploadError);
      return {} as never;
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
      { ...draft, command_id: "command-id" },
      { worker_id: "worker-id" },
    ]);
    await expect(
      createOnboardingGateway(fake.value).saveWorker(
        parseWorkerOnboarding(workerForm()),
        "requested-id",
      ),
    ).resolves.toEqual({ id: "worker-id" });
    expect(fake.calls[0]).toMatchObject({
      path: "/api/v1/onboarding/workers/requested-id/begin",
      body: expect.objectContaining({
        display_name: "Themba",
        preferred_communication_mode: "voice",
        app_participation: "whatsapp_only",
      }),
    });
    expect(fake.calls[1]).toMatchObject({
      path: "/api/v1/onboarding/workers/worker-id/portrait",
    });
    expect(fake.calls[2]).toMatchObject({
      path: "/api/v1/onboarding/workers/worker-id/complete",
      body: {
        object_path: "workers/worker-id/portrait.jpg",
        portrait_asset_id: "asset-id",
        target_status: "active",
      },
    });
  });
  it("returns a resumable draft when private upload fails", async () => {
    const fake = client(
      [{ ...draft, command_id: "command-id" }],
      "network unavailable",
    );
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
    const fake = client([{}]);
    await expect(
      createOnboardingGateway(fake.value).cancelWorker("worker-id"),
    ).resolves.toBeUndefined();
    expect(fake.calls).toEqual([
      {
        key: "worker-cancel-worker-id",
        path: "/api/v1/onboarding/workers/worker-id/cancel",
      },
    ]);
  });
  it("uses record update RPCs without direct client table writes", async () => {
    const fake = client([
      { worker_id: "worker-id" },
      { organisation_id: "organisation-id" },
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
    expect(fake.calls[0]).toMatchObject({
      path: "/api/v1/workers/worker-id",
      body: expect.objectContaining({ display_name: "Themba" }),
    });
    expect(fake.calls[1]).toMatchObject({
      path: "/api/v1/organisations/organisation-id",
      body: expect.objectContaining({ whatsapp_phone: "+27821234567" }),
    });
  });
});
