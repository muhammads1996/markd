import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const localDatabaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(
    clients.splice(0).map(async (client) => {
      await client.end();
    }),
  );
});

describe("local Supabase database", () => {
  it("accepts a transaction and rolls it back cleanly", async () => {
    const client = new Client({
      connectionString: localDatabaseUrl,
      connectionTimeoutMillis: 5_000,
    });
    clients.push(client);

    try {
      await client.connect();
    } catch (error) {
      throw new Error(
        "Local Supabase is unavailable. Run `pnpm db:start` before integration tests.",
        { cause: error },
      );
    }

    await client.query("begin");
    await client.query(
      "create table markd_bootstrap_probe (id integer primary key)",
    );
    await client.query("insert into markd_bootstrap_probe (id) values (1)");

    const inserted = await client.query<{ id: number }>(
      "select id from markd_bootstrap_probe",
    );
    expect(inserted.rows).toEqual([{ id: 1 }]);

    await client.query("rollback");
    const relation = await client.query<{ relation: string | null }>(
      "select to_regclass('public.markd_bootstrap_probe')::text as relation",
    );
    expect(relation.rows[0]?.relation).toBeNull();
  });
});
