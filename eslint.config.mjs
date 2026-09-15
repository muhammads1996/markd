import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
    rules: {
      // Allow deliberately unused parameters (e.g. unimplemented provider
      // stubs that must match an interface) when prefixed with underscore.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Playwright fixtures call a `use(...)` callback param; that name alone
    // trips the react-hooks plugin's naming heuristic outside any React code.
    files: ["tests/e2e/support/fixtures.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  prettier,
  globalIgnores([
    "**/.next/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "supabase/.temp/**",
  ]),
]);
