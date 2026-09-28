import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "./support/fixtures";
import { provisionOperatorUser } from "./support/operator-db";
import {
  provisionActivationIdentity,
  readCanonicalIdentityCounts,
  readActivationState,
  removeActivationIdentity,
  type ActivationFixture,
} from "./support/participant-activation-db";
import { buildOperatorUser } from "./support/test-data";

const testPhones = {
  worker: "+15555550101",
  contractor: "+15555550102",
} as const;
const testOtp = "123456";

function localSupabaseValue(key: string): string | undefined {
  const fromEnvironment = process.env[key];
  if (fromEnvironment) return fromEnvironment;

  const envPath = resolve(process.cwd(), "apps/web/.env.local");
  try {
    const line = readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

async function operatorAccessToken(
  email: string,
  password: string,
): Promise<{
  accessToken: string;
  supabaseUrl: string;
  publishableKey: string;
}> {
  const supabaseUrl = localSupabaseValue("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = localSupabaseValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Generate apps/web/.env.local with pnpm env:local first.");
  }
  const response = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Local operator sign-in failed with HTTP ${response.status}.`,
    );
  }
  const data = (await response.json()) as { access_token?: unknown };
  if (typeof data.access_token !== "string") {
    throw new Error("Supabase did not return an operator access token.");
  }
  return { accessToken: data.access_token, supabaseUrl, publishableKey };
}

async function provisionFromOperator(
  subject: ActivationFixture,
  operator: { email: string; password: string },
): Promise<void> {
  const { accessToken, supabaseUrl, publishableKey } =
    await operatorAccessToken(operator.email, operator.password);
  const apiUrl = process.env.MARKD_API_URL ?? "http://127.0.0.1:8000";
  const provision = async () =>
    fetch(`${apiUrl}/api/v1/participant-access/provision`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope_kind: subject.scopeKind,
        subject_id: subject.subjectId,
      }),
    });

  const firstResponse = await provision();
  expect(firstResponse.status).toBe(200);
  const first = (await firstResponse.json()) as {
    person_id: string;
    status: string;
    scope_kind: string;
  };
  expect(first).toMatchObject({
    person_id: subject.personId,
    status: "pending",
    scope_kind: subject.scopeKind,
  });

  // Repeating the operator action must reuse the existing account and scope.
  const secondResponse = await provision();
  expect(secondResponse.status, await secondResponse.clone().text()).toBe(200);
  expect(await secondResponse.json()).toMatchObject(first);
  expect(supabaseUrl).toBeTruthy();
}

async function activateThroughOtp(
  page: import("@playwright/test").Page,
  subject: ActivationFixture,
): Promise<void> {
  await page.goto("/participant/sign-in");
  await page.getByLabel("Mobile phone number").fill(subject.phone);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  await page.getByLabel("Sign-in code").fill(testOtp);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(
    subject.scopeKind === "worker"
      ? /\/participant\/worker$/
      : /\/participant\/contractor$/,
  );
}

test.describe("participant activation with local Supabase OTP", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-chromium",
      "Activation tests use fixed local-only phone OTP fixtures once per run.",
    );
  });

  test("operator provisions an existing worker and OTP grants only worker access", async ({
    page,
  }) => {
    const operator = buildOperatorUser();
    const worker = await provisionActivationIdentity(
      "worker",
      testPhones.worker,
    );
    await provisionOperatorUser(operator);
    try {
      await provisionFromOperator(worker, operator);
      const identityCountsBeforeActivation =
        await readCanonicalIdentityCounts(worker);
      await activateThroughOtp(page, worker);
      await expect(
        page.getByRole("heading", { name: "Your work" }),
      ).toBeVisible();
      await expect
        .poll(() => readActivationState(worker.personId))
        .toEqual({ accountStatus: "active", scopeKinds: ["worker"] });
      expect(await readCanonicalIdentityCounts(worker)).toEqual(
        identityCountsBeforeActivation,
      );

      await page.goto("/participant/contractor");
      await expect(page).toHaveURL(/\/participant\?reason=scope$/);
      await page.goto("/operator");
      await expect(page).not.toHaveURL(/\/operator(?:\/|$)/);

      await page.goto("/participant/sign-in");
      await page
        .getByRole("button", { name: "Sign out of participant access" })
        .click();
      await expect(page).toHaveURL(/\/participant\/sign-in$/);
      await activateThroughOtp(page, worker);

      const { accessToken } = await operatorAccessToken(
        operator.email,
        operator.password,
      );
      const disable = await fetch(
        `${process.env.MARKD_API_URL ?? "http://127.0.0.1:8000"}/api/v1/participant-access/${worker.personId}/disable`,
        { method: "POST", headers: { authorization: `Bearer ${accessToken}` } },
      );
      expect(disable.status).toBe(204);
      await page.goto("/participant/worker");
      await expect(page).toHaveURL(
        /\/participant\/sign-in\?reason=not-authorised$/,
      );
      const afterDisable = await readCanonicalIdentityCounts(worker);
      expect(afterDisable).toEqual(identityCountsBeforeActivation);
    } finally {
      await removeActivationIdentity(worker);
      // Participant provisioning may append audit history for the operator.
      // The fixture helper archives the operator account when that happens.
      const { removeOperatorUser } = await import("./support/operator-db");
      await removeOperatorUser(operator.id);
    }
  });

  test("operator provisions an existing organisation contact for contractor OTP sign-in", async ({
    page,
  }) => {
    const operator = buildOperatorUser();
    const contractor = await provisionActivationIdentity(
      "contractor",
      testPhones.contractor,
    );
    await provisionOperatorUser(operator);
    try {
      await provisionFromOperator(contractor, operator);
      const identityCountsBeforeActivation =
        await readCanonicalIdentityCounts(contractor);
      await activateThroughOtp(page, contractor);
      await expect(
        page.getByRole("heading", { name: "Crew overview" }),
      ).toBeVisible();
      await expect
        .poll(() => readActivationState(contractor.personId))
        .toEqual({ accountStatus: "active", scopeKinds: ["contractor"] });
      expect(await readCanonicalIdentityCounts(contractor)).toEqual(
        identityCountsBeforeActivation,
      );
      await page.goto("/participant/worker");
      await expect(page).toHaveURL(/\/participant\?reason=scope$/);

      await page.goto("/operator");
      await expect(page).not.toHaveURL(/\/operator(?:\/|$)/);
    } finally {
      await removeActivationIdentity(contractor);
      const { removeOperatorUser } = await import("./support/operator-db");
      await removeOperatorUser(operator.id);
    }
  });
});
