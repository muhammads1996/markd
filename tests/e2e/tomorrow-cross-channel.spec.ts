import { randomUUID } from "node:crypto";
import {
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

import { expect, test } from "./support/fixtures";
import { buildParticipantUser } from "./support/test-data";
import {
  provisionTomorrowCommandFixture,
  readTomorrowAssignmentId,
  readTomorrowAssignmentState,
  readTomorrowRequirementId,
  readTomorrowTravelDelivery,
  readTomorrowTravelQueue,
  removeTomorrowCommandFixture,
  publishTomorrowCommandOutbox,
  runWhatsAppProcessorForFixtureEvent,
  signWhatsAppWebhookBody,
} from "./support/tomorrow-command-db";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_MARKD_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

function accessTokenFromCookies(
  cookies: Array<{ name: string; value: string }>,
): string {
  const chunks = cookies
    .filter((cookie) => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
      }),
    );
  const value = chunks
    .map((cookie) => decodeURIComponent(cookie.value))
    .join("");
  if (!value) throw new Error("Supabase session cookie was not found.");
  const serialized = value.startsWith("base64-")
    ? Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")
    : value;
  const session: unknown = JSON.parse(serialized);
  if (
    typeof session === "object" &&
    session !== null &&
    "access_token" in session &&
    typeof session.access_token === "string"
  ) {
    return session.access_token;
  }
  if (Array.isArray(session) && typeof session[0] === "string") {
    return session[0];
  }
  throw new Error("Supabase session cookie had no access token.");
}

test("WhatsApp acceptance, Tomorrow commands and the worker PWA converge on one assignment", async ({
  page,
  browser,
  loggedInAsOperator,
}, testInfo) => {
  const worker = buildParticipantUser({
    displayName: `Cross Channel Worker ${testInfo.project.name} ${randomUUID().slice(0, 8)}`,
  });
  const fixture = await provisionTomorrowCommandFixture(
    worker,
    testInfo.project.name === "mobile-chromium" ? 4 : 3,
  );
  const createRequestKey = `tomorrow-cross-channel-request-${randomUUID()}`;
  fixture.operatorCommandKeys.push(createRequestKey);
  let workerContext: BrowserContext | undefined;
  let api: APIRequestContext | undefined;

  try {
    workerContext = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    });
    const token = accessTokenFromCookies(await page.context().cookies());
    api = await playwrightRequest.newContext({
      baseURL: apiBaseUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const requestResponse = await api.post("/api/v1/labour-requests", {
      headers: { "Idempotency-Key": createRequestKey },
      data: {
        contractor_organisation_id: fixture.organisationId,
        contractor_contact_id: fixture.contactId,
        work_date: fixture.date,
        start_time: "07:30",
        timezone: "Africa/Johannesburg",
        site_area: "Bellville",
        site_text: "Synthetic North Gate",
        pay: { amount_minor: 125000, currency: "ZAR", basis: "daily" },
        requirements: [{ work_type: "Plastering", headcount: 1 }],
      },
    });
    expect(requestResponse.status()).toBe(201);
    const createdRequest = (await requestResponse.json()) as {
      resource: { id: string };
    };
    fixture.requestId = createdRequest.resource.id;
    fixture.requirementId = await readTomorrowRequirementId(fixture.requestId);

    // Exercise the gap-to-search path; worker selection and the outbound offer
    // must use the same canonical commands as the operator UI.
    await page.goto(`/operator/tomorrow?date=${fixture.date}`);
    await page.getByRole("link", { name: "Find and offer worker" }).click();
    await page
      .getByLabel("Search the private Work Graph")
      .fill(worker.displayName);
    await page.getByRole("button", { name: "Search" }).click();
    await page
      .getByRole("link", { name: new RegExp(worker.displayName) })
      .click();
    await page
      .getByRole("button", { name: `Offer ${worker.displayName}` })
      .click();
    await page.waitForURL(
      new RegExp(`/operator/tomorrow\\?date=${fixture.date}`),
    );
    const assignmentId = await readTomorrowAssignmentId(
      fixture.requestId,
      worker.personId,
    );
    fixture.assignmentId = assignmentId;

    const workerPage = await workerContext.newPage();
    await workerPage.goto("/sign-in?returnTo=%2Fparticipant%2Fworker");
    await workerPage.getByLabel("Email").fill(worker.email);
    await workerPage.getByLabel("Password").fill(worker.password);
    await workerPage.getByRole("button", { name: "Sign in" }).click();
    await workerPage.waitForURL(/\/participant\/worker$/);
    const offerCard = workerPage
      .getByRole("region", { name: "Assigned work" })
      .getByRole("article");
    await expect(offerCard).toContainText("Plastering");
    await expect(offerCard).toContainText("Work offer");

    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: `playwright-${randomUUID()}`,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "playwright-fixture" },
                contacts: [{ wa_id: fixture.phone.slice(1) }],
                messages: [
                  {
                    from: fixture.phone.slice(1),
                    id: fixture.providerMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: "text",
                    text: { body: "YES" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(payload);
    const signature = await signWhatsAppWebhookBody(body);
    const webhookResponse = await api.post("/webhooks/whatsapp", {
      data: body,
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
      },
    });
    expect(webhookResponse.status()).toBe(200);
    expect(await webhookResponse.json()).toMatchObject({
      received: true,
      inbound_messages: 1,
    });

    await runWhatsAppProcessorForFixtureEvent(fixture.providerMessageId);
    await expect
      .poll(() => readTomorrowAssignmentState(assignmentId))
      .toMatchObject({
        workerResponse: "accepted",
        responseSource: "whatsapp",
      });
    await workerPage.reload();
    const assignmentCard = workerPage
      .getByRole("region", { name: "Assigned work" })
      .getByRole("article");
    await expect(assignmentCard).toContainText("Accepted");
    await expect(assignmentCard).toContainText("To be confirmed");

    await page.goto(`/operator/tomorrow?date=${fixture.date}`);
    const tomorrowAssignment = page
      .getByRole("region", { name: "Tomorrow labour requests" })
      .locator('[data-state="accepted_waiting"]');
    await expect(tomorrowAssignment).toContainText("Cross Channel Worker");
    await tomorrowAssignment
      .getByRole("button", { name: "Confirm assignment" })
      .click();
    const logistics = tomorrowAssignment.getByText("Set logistics");
    await logistics.click();
    await tomorrowAssignment
      .getByLabel("Site or pickup location")
      .fill("Synthetic North Gate");
    await tomorrowAssignment
      .getByLabel("Reporting time")
      .fill(`${fixture.date}T06:30`);
    await tomorrowAssignment
      .getByRole("button", { name: "Save logistics" })
      .click();
    const readyAction = page
      .locator('[data-state="accepted_waiting"]')
      .filter({ hasText: "Cross Channel Worker" });
    await expect(
      readyAction.getByRole("button", { name: "Authorise travel" }),
    ).toBeVisible();
    await readyAction.getByRole("button", { name: "Authorise travel" }).click();

    await expect
      .poll(() => readTomorrowTravelQueue(assignmentId))
      .toMatch(/^(pending|leased|published)$/);
    await expect
      .poll(() => readTomorrowAssignmentState(assignmentId))
      .toMatchObject({ travelAuthorised: true });
    await publishTomorrowCommandOutbox();
    await expect
      .poll(() => readTomorrowTravelDelivery(assignmentId))
      .toBe("queued");
    await expect
      .poll(() => readTomorrowTravelQueue(assignmentId))
      .toBe("published");

    await workerPage.reload();
    const readyCard = workerPage
      .getByRole("region", { name: "Assigned work" })
      .getByRole("article");
    await expect(readyCard).toContainText("Travel ready");
    await expect(readyCard).toContainText("Synthetic North Gate");
  } finally {
    await api?.dispose();
    await workerContext?.close();
    await removeTomorrowCommandFixture(fixture, loggedInAsOperator.id);
  }
});
