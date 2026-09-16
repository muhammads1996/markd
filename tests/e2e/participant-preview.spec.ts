import { expect, test } from "@playwright/test";

test.skip(
  process.env.MARKD_PARTICIPANT_FIXTURES !== "1",
  "Participant previews require the explicit fixture flag and a development server.",
);

test.use({ viewport: { width: 320, height: 720 } });

test("worker preview covers confirmed state without horizontal overflow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/participant/preview/worker?view=home&scenario=travel_ready",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Do I have work today?" }),
  ).toBeVisible();
  await expect(page.getByText("You can travel.")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Worker preview navigation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(
    (await page.screenshot({ animations: "disabled" })).byteLength,
  ).toBeGreaterThan(1_000);
});

test("worker offer acceptance remains local and never becomes travel ready", async ({
  page,
}) => {
  await page.goto("/participant/preview/worker?view=home&scenario=offer");
  await page.getByRole("button", { name: /Take job/i }).click();
  await expect(
    page.getByText("Waiting for contractor confirmation"),
  ).toBeVisible();
  await expect(page.getByText("Do not travel yet")).toBeVisible();
  await expect(page.getByText("You can travel.")).toHaveCount(0);
});

test("worker can request a call or decline without receiving travel authorisation", async ({
  page,
}) => {
  await page.goto("/participant/preview/worker?view=home&scenario=offer");
  await page.getByRole("button", { name: /call me/i }).click();
  await expect(page.getByText("MARKD will call you.")).toBeVisible();
  await page.getByRole("button", { name: /can't go/i }).click();
  await expect(page.getByText("Work cancelled")).toBeVisible();
  await expect(
    page.getByText("Do not travel. This work is cancelled."),
  ).toBeVisible();
  await expect(page.getByText("You can travel.")).toHaveCount(0);
});

test("worker cancellation scenario never shows confirmed travel styling", async ({
  page,
}) => {
  await page.goto("/participant/preview/worker?view=home&scenario=cancelled");
  await expect(page.getByText("Work cancelled")).toBeVisible();
  await expect(
    page.getByText("Do not travel. This work is cancelled."),
  ).toBeVisible();
  await expect(page.getByText("You can travel.")).toHaveCount(0);
});

test("contractor preview shows crew gap and visual-only repeat hire", async ({
  page,
}) => {
  await page.goto("/participant/preview/contractor?view=hire");
  await expect(page.getByText("2 open positions")).toBeVisible();
  await page
    .getByRole("button", { name: /Hire again/i })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("demo only");
});

test("manifest and service worker contain only conservative offline behavior", async ({
  request,
}) => {
  const manifest = (await (
    await request.get("/manifest.webmanifest")
  ).json()) as {
    name: string;
    scope: string;
    icons: { type: string; sizes: string }[];
  };
  expect(manifest).toMatchObject({ name: "MARKD", scope: "/participant/" });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "image/png", sizes: "192x192" }),
      expect.objectContaining({ type: "image/png", sizes: "512x512" }),
    ]),
  );
  const serviceWorker = await (await request.get("/sw.js")).text();
  expect(serviceWorker).toContain("/participant/offline");
  expect(serviceWorker).toContain('request.method !== "GET"');
  expect(serviceWorker).not.toContain("sync");
  expect(serviceWorker).not.toContain("push");
});

const visualCases = [
  {
    name: "worker-confirmed-home",
    path: "/participant/preview/worker?view=home&scenario=travel_ready",
  },
  {
    name: "worker-accepted-waiting",
    path: "/participant/preview/worker?view=home&scenario=accepted_waiting",
  },
  {
    name: "worker-work-card",
    path: "/participant/preview/worker?view=card",
  },
  {
    name: "contractor-crew-home",
    path: "/participant/preview/contractor?view=home",
  },
  {
    name: "contractor-hire",
    path: "/participant/preview/contractor?view=hire",
  },
] as const;

for (const visualCase of visualCases) {
  test(`mobile visual: ${visualCase.name}`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "Visual references use the approved mobile comparison viewport.",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(visualCase.path);
    await expect(page).toHaveScreenshot(`${visualCase.name}.png`, {
      animations: "disabled",
      fullPage: true,
    });
  });
}
