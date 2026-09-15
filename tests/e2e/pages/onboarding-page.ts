import type { Locator, Page } from "@playwright/test";

export class OnboardingPage {
  constructor(private readonly page: Page) {}

  get addHeading(): Locator {
    return this.page.getByRole("heading", { name: "Add someone to MARKD" });
  }

  get updateHeading(): Locator {
    return this.page.getByRole("heading", { name: "Update MARKD record" });
  }

  get preferredNameInput(): Locator {
    return this.page.getByLabel("Preferred name");
  }

  get communicationPreferenceInput(): Locator {
    return this.page.getByLabel("Communication preference");
  }

  get optionalParticipationText(): Locator {
    return this.page.getByText("Optional participation preferences");
  }

  async goto(workerId?: string): Promise<void> {
    await this.page.goto(
      workerId ? `/operator/onboard?workerId=${workerId}` : "/operator/onboard",
    );
  }
}
