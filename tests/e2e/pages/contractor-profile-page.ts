import type { Locator, Page } from "@playwright/test";

export class ContractorProfilePage {
  constructor(private readonly page: Page) {}

  get knownLabourNetworkHeading(): Locator {
    return this.page.getByRole("heading", { name: "Known labour network" });
  }

  get editContractorLink(): Locator {
    return this.page.getByRole("link", { name: "Edit contractor" });
  }

  async goto(organisationId: string): Promise<void> {
    await this.page.goto(`/contractors/${organisationId}`);
  }
}
