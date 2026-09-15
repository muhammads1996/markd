import { expect, test } from "@playwright/test";

test("routes the root entry into participant authentication", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(browserErrors).toEqual([]);
});

test("publishes a local web app manifest and icons", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);

  const manifest = (await manifestResponse.json()) as {
    icons?: Array<{ src: string }>;
    name?: string;
    start_url?: string;
  };
  expect(manifest.name).toBe("MARKD");
  expect(manifest.start_url).toBe("/participant");
  expect(manifest.icons?.length).toBeGreaterThanOrEqual(3);

  for (const icon of manifest.icons ?? []) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
  }
});

test("keeps the phone-sized operator route behind operator sign-in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/operator");

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
