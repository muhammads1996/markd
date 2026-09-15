import type { Locator, Page } from "@playwright/test";

export class SignInPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole("heading", { name: "Sign in" });
  }

  get emailInput(): Locator {
    return this.page.getByLabel("Email");
  }

  get passwordInput(): Locator {
    return this.page.getByLabel("Password");
  }

  get submitButton(): Locator {
    return this.page.getByRole("button", { name: "Sign in" });
  }

  get errorAlert(): Locator {
    return this.page.getByRole("alert");
  }

  async goto(): Promise<void> {
    await this.page.goto("/sign-in");
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async signInAndWaitForOperatorHome(
    email: string,
    password: string,
  ): Promise<void> {
    await this.signIn(email, password);
    // Sign-in is a server action that sets the session cookie and redirects
    // in one round trip; still allow generous margin for slower CI runners.
    await this.page.waitForURL(/\/operator$/, { timeout: 15_000 });
  }
}
