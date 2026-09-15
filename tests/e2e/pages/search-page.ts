import type { Locator, Page } from "@playwright/test";

export class SearchPage {
  constructor(private readonly page: Page) {}

  async goto(query: string): Promise<void> {
    await this.page.goto(`/search?q=${encodeURIComponent(query)}`);
  }

  resultText(text: string, options?: { exact?: boolean }): Locator {
    return this.page.getByText(text, options);
  }
}
