import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export type PublicSupabaseEnvironment = Readonly<{
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
}>;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSupabasePublicEnv(
  statusOutput: string,
): PublicSupabaseEnvironment {
  const values = new Map<string, string>();

  for (const line of statusOutput.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      values.set(match[1], unquote(match[2]));
    }
  }

  const url = values.get("API_URL");
  if (!url) {
    throw new Error(
      "Supabase status did not include API_URL. Run `pnpm db:start` first.",
    );
  }

  const publishableKey =
    values.get("PUBLISHABLE_KEY") ?? values.get("ANON_KEY");
  if (!publishableKey) {
    throw new Error(
      "Supabase status did not include a public key. Run `pnpm db:start` first.",
    );
  }

  return {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: url,
  };
}

export async function writeLocalEnv(
  outputPath: string,
  values: PublicSupabaseEnvironment,
): Promise<void> {
  const contents =
    `NEXT_PUBLIC_SUPABASE_URL=${values.NEXT_PUBLIC_SUPABASE_URL}\n` +
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}\n`;

  try {
    await writeFile(outputPath, contents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`${outputPath} already exists; it was not changed.`, {
        cause: error,
      });
    }
    throw error;
  }
}

function readLocalSupabaseStatus(): string {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const cliPath = resolve(
    repositoryRoot,
    "node_modules/supabase/dist/supabase.js",
  );
  return execFileSync(process.execPath, [cliPath, "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function main(): Promise<void> {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const outputPath = resolve(repositoryRoot, "apps/web/.env.local");
  const values = parseSupabasePublicEnv(readLocalSupabaseStatus());
  await writeLocalEnv(outputPath, values);
  console.log("Created apps/web/.env.local with local public Supabase values.");
}

const entryPoint = process.argv[1];
if (entryPoint && pathToFileURL(resolve(entryPoint)).href === import.meta.url) {
  await main();
}
