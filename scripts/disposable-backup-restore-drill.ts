import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const localDatabaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const disposableContainer = "supabase_db_markd";

function assertDisposableTarget() {
  if (process.env.MARKD_RUN_DISPOSABLE_BACKUP_RESTORE_DRILL !== "1") {
    throw new Error(
      "Refusing to run. Set MARKD_RUN_DISPOSABLE_BACKUP_RESTORE_DRILL=1 for the local disposable Supabase database.",
    );
  }
  const target = new URL(localDatabaseUrl);
  if (target.hostname !== "127.0.0.1" || target.port !== "54322") {
    throw new Error("Refusing a non-local Supabase database target.");
  }
}

function docker(args: string[], input?: Buffer) {
  return execFileSync("docker", args, {
    input,
    encoding: input ? undefined : "utf8",
    stdio: input ? ["pipe", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
  });
}

async function assertRestoredState(client: Client) {
  const people = await client.query(
    "select count(*)::integer as count from public.people",
  );
  const workCards = await client.query(
    "select count(*)::integer as count from public.operator_work_cards",
  );
  const operatorAccounts = await client.query(
    "select to_regclass('public.operator_accounts') as relation_name",
  );
  if ((people.rows[0]?.count ?? 0) < 1 || (workCards.rows[0]?.count ?? 0) < 1) {
    throw new Error(
      "Restored database is missing the synthetic Work Graph assertions.",
    );
  }
  if (operatorAccounts.rows[0]?.relation_name !== "operator_accounts") {
    throw new Error(
      "Restored database is missing the operator access boundary.",
    );
  }
}

async function main() {
  assertDisposableTarget();
  const tempDirectory = mkdtempSync(join(tmpdir(), "markd-backup-drill-"));
  const backupPath = join(tempDirectory, "markd-local.sql");
  try {
    // The container name and localhost port are fixed local-Supabase values;
    // no remote project credentials or production URL can reach this command.
    const dump = docker([
      "exec",
      disposableContainer,
      "pg_dump",
      "-U",
      "postgres",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "postgres",
    ]) as Buffer;
    writeFileSync(backupPath, dump);

    // Local Supabase applies a database-level log setting owned by its
    // container bootstrap role. It is irrelevant to data recovery and cannot
    // be replayed by the disposable restore role.
    const restoreSql = Buffer.from(
      dump.toString("utf8").replace(/^.*log_min_messages.*\r?\n/gm, ""),
      "utf8",
    );

    // Restore into an isolated database inside the local container. It does
    // not replace the running `postgres` database used by development.
    docker([
      "exec",
      disposableContainer,
      "dropdb",
      "-U",
      "postgres",
      "--if-exists",
      "markd_restore_drill",
    ]);
    docker([
      "exec",
      disposableContainer,
      "createdb",
      "-U",
      "postgres",
      "-T",
      "template0",
      "markd_restore_drill",
    ]);
    docker([
      "exec",
      disposableContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "markd_restore_drill",
      "-c",
      "drop schema public cascade",
    ]);
    // The canonical backup is the application-owned public schema. A
    // disposable database supplies only the minimal managed Auth contract
    // needed to recreate its foreign keys and RLS helper functions.
    docker([
      "exec",
      disposableContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "markd_restore_drill",
      "-c",
      "create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;",
    ]);
    docker(
      [
        "exec",
        "-i",
        disposableContainer,
        "psql",
        "-U",
        "postgres",
        "--set",
        "ON_ERROR_STOP=1",
        "-d",
        "markd_restore_drill",
      ],
      restoreSql,
    );

    const restored = new Client({
      connectionString: localDatabaseUrl.replace(
        /\/postgres$/,
        "/markd_restore_drill",
      ),
    });
    await restored.connect();
    try {
      await assertRestoredState(restored);
    } finally {
      await restored.end();
    }
    console.log("Disposable local backup/restore drill passed.");
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
    // Best-effort cleanup is intentionally local and explicit.
    docker([
      "exec",
      disposableContainer,
      "dropdb",
      "-U",
      "postgres",
      "--if-exists",
      "markd_restore_drill",
    ]);
  }
}

void main();
