import { expect, test } from "@playwright/test";

const protectedRoutes = [
  "/operator",
  "/operator/onboard",
  "/search",
  "/workers/10000000-0000-4000-8000-000000000001",
  "/contractors/20000000-0000-4000-8000-000000000001",
];

test.describe("operator access boundary", () => {
  for (const route of protectedRoutes) {
    test(`${route} redirects unauthenticated visitors to sign-in`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page).toHaveURL(
        /\/sign-in(?:\?reason=(?:configuration|not-authorised))?$/,
      );
      await expect(
        page.getByRole("heading", { name: "Sign in" }),
      ).toBeVisible();
    });
  }

  test("renders the operator sign-in form with browser validation", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    await expect(page.getByLabel("Email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Email")).toBeFocused();
  });
});
