import type { Locator, Page } from "@playwright/test";

export class ParticipantPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }
  get navigation(): Locator {
    return this.page.getByRole("navigation");
  }

  async gotoWorker(): Promise<void> {
    await this.page.goto("/participant/worker");
  }
  async gotoContractor(): Promise<void> {
    await this.page.goto("/participant/contractor");
  }
}
