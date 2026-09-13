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
