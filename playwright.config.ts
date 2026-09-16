import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const useExistingServer = process.env.PLAYWRIGHT_BASE_URL !== undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  ...(useExistingServer
    ? {}
    : {
        webServer: {
          command:
            process.env.MARKD_PARTICIPANT_FIXTURES === "1"
              ? "corepack pnpm dev"
              : "corepack pnpm start",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
