import { expect, test } from "./support/fixtures";

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
      signInPage,
    }) => {
      await page.goto(route);

      await expect(page).toHaveURL(
        /\/sign-in(?:\?reason=(?:configuration|not-authorised))?$/,
      );
      await expect(signInPage.heading).toBeVisible();
    });
  }

  test("renders the operator sign-in form with browser validation", async ({
    signInPage,
  }) => {
    await signInPage.goto();

    await expect(signInPage.emailInput).toHaveAttribute(
      "autocomplete",
      "email",
    );
    await expect(signInPage.passwordInput).toHaveAttribute(
      "autocomplete",
      "current-password",
    );

    await signInPage.submitButton.click();
    await expect(signInPage.emailInput).toBeFocused();
  });
});
