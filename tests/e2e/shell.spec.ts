import { expect, test } from "@playwright/test";

test("serves the responsive MARKD application shell", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveTitle("MARKD Operator Platform");
  await expect(page.getByRole("heading", { name: "MARKD" })).toBeVisible();
  await expect(page.getByText("Repository bootstrap active")).toBeVisible();

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
  };
  expect(manifest.name).toBe("MARKD Operator Platform");
  expect(manifest.icons?.length).toBeGreaterThanOrEqual(2);

  for (const icon of manifest.icons ?? []) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
  }
});
