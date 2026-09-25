import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseSupabasePublicEnv,
  writeCiApiEnv,
  writeLocalEnv,
} from "../../scripts/env-local.ts";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "markd-env-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("CI API environment", () => {
  it("creates a private synthetic webhook secret without overwriting an existing file", async () => {
    const directory = await createTemporaryDirectory();
    const outputPath = join(directory, ".env");

    await writeCiApiEnv(outputPath);
    const contents = await readFile(outputPath, "utf8");
    expect(contents).toMatch(/^WHATSAPP_APP_SECRET=[0-9a-f]{64}\n$/);

    await expect(writeCiApiEnv(outputPath)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await expect(readFile(outputPath, "utf8")).resolves.toBe(contents);
  });
});

describe("local Supabase public environment", () => {
  it("selects only the API URL and publishable key", () => {
    const result = parseSupabasePublicEnv(`
API_URL="http://127.0.0.1:54321"
PUBLISHABLE_KEY="sb_publishable_local"
SECRET_KEY="must-not-leak"
SERVICE_ROLE_KEY="must-not-leak"
DB_URL="postgresql://must-not-leak"
`);

    expect(result).toEqual({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("supports the legacy local anonymous key as a public-key fallback", () => {
    const result = parseSupabasePublicEnv(`
API_URL=http://127.0.0.1:54321
ANON_KEY=legacy-public-key
`);

    expect(result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      "legacy-public-key",
    );
  });

  it("rejects incomplete status output", () => {
    expect(() =>
      parseSupabasePublicEnv("API_URL=http://127.0.0.1:54321"),
    ).toThrow("public key");
  });

  it("creates an env file without overwriting an existing file", async () => {
    const directory = await createTemporaryDirectory();
    const outputPath = join(directory, ".env.local");
    const values = {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-value",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    };

    await writeLocalEnv(outputPath, values);

    await expect(readFile(outputPath, "utf8")).resolves.toBe(
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n" +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=public-value\n",
    );

    await writeFile(outputPath, "user-owned=true\n", "utf8");
    await expect(writeLocalEnv(outputPath, values)).rejects.toThrow(
      "already exists",
    );
    await expect(readFile(outputPath, "utf8")).resolves.toBe(
      "user-owned=true\n",
    );
  });
});
