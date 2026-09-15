import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputPath = resolve(repositoryRoot, "packages/db/src/database.types.ts");

function generateTypes(): string {
  const cliPath = resolve(
    repositoryRoot,
    "node_modules/supabase/dist/supabase.js",
  );
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "gen",
      "types",
      "--local",
      "--lang",
      "typescript",
      "--schema",
      "public",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      "Supabase type generation failed. Run `pnpm db:start` and try again.",
    );
  }

  const output = result.stdout.replace(/\r\n/gu, "\n").trimEnd();
  if (!output) throw new Error("Supabase type generation returned no output.");
  return `${output}\n`;
}

async function checkTypes(generated: string): Promise<void> {
  const committed = (await readFile(outputPath, "utf8")).replace(
    /\r\n/gu,
    "\n",
  );
  if (committed !== generated) {
    throw new Error(
      "Generated database types are stale. Run `pnpm db:types` and commit the result.",
    );
  }
  console.log("Generated database types are current.");
}

async function writeTypes(generated: string): Promise<void> {
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, generated, "utf8");
  await rename(temporaryPath, outputPath);
  console.log("Updated packages/db/src/database.types.ts.");
}

const generated = generateTypes();
if (process.argv.includes("--check")) {
  await checkTypes(generated);
} else {
  await writeTypes(generated);
}
