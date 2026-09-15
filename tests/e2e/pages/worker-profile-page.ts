import type { Locator, Page } from "@playwright/test";

export class WorkerProfilePage {
  constructor(private readonly page: Page) {}

  get markdArrangedWorkText(): Locator {
    return this.page.getByText("MARKD-arranged work");
  }

  get demonstratedSkillsHeading(): Locator {
    return this.page.getByRole("heading", { name: "Demonstrated skills" });
  }

  get confirmedWorkmarkEvidenceText(): Locator {
    return this.page.getByText("Confirmed Workmark evidence from work history");
  }

  get editWorkerLink(): Locator {
    return this.page.getByRole("link", { name: "Edit worker" });
  }

  get historicalClaimText(): Locator {
    return this.page.getByText("Historical claim");
  }

  async goto(workerId: string): Promise<void> {
    await this.page.goto(`/workers/${workerId}`);
  }
}
