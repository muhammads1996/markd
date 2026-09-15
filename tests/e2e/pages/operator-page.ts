import type { Locator, Page } from "@playwright/test";

export class OperatorPage {
  constructor(private readonly page: Page) {}

  get todayHeading(): Locator {
    return this.page.getByRole("heading", { name: "Today" });
  }

  get signOutButton(): Locator {
    return this.page.getByRole("button", { name: "Sign out" });
  }

  async goto(): Promise<void> {
    await this.page.goto("/operator");
  }
}
