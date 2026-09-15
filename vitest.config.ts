import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@markd/contracts": resolve("packages/contracts/src/index.ts"),
      "@markd/language": resolve("packages/language/src/index.ts"),
      "@markd/messaging": resolve("packages/messaging/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    restoreMocks: true,
    sequence: {
      concurrent: false,
    },
  },
});
