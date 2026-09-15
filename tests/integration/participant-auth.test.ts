import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const localDatabaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const authInstanceId = "00000000-0000-0000-0000-000000000000";
const participantA = "90000000-0000-4000-8000-000000000126";
const participantB = "90000000-0000-4000-8000-000000000127";
const operatorOnly = "90000000-0000-4000-8000-000000000128";
const clients: Client[] = [];

async function connect() {
  const client = new Client({
    connectionString: localDatabaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  clients.push(client);
  await client.connect();
  await client.query("begin");
  return client;
}

async function createAuthUser(client: Client, userId: string) {
  await client.query(
    `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, $2, 'authenticated', 'authenticated', $3, 'unused', now(), '{}', '{}', now(), now())`,
    [userId, authInstanceId, `${userId}@example.test`],
  );
}

async function becomeAuthenticated(client: Client, userId: string) {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ]);
  await client.query("set local role authenticated");
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
});

describe("participant account mappings", () => {
  it("allows authenticated participants to read only their own narrow account and scopes", async () => {
    const client = await connect();
    await createAuthUser(client, participantA);
    await createAuthUser(client, participantB);
    const people = await client.query<{ id: string }>(
      "insert into public.people(display_name) values ('Participant A'), ('Participant B') returning id",
    );
    const personA = people.rows[0]?.id;
    const personB = people.rows[1]?.id;
    await client.query(
      "insert into public.worker_profiles(person_id) values ($1), ($2)",
      [personA, personB],
    );
    await client.query(
      "insert into public.participant_accounts(auth_user_id, person_id) values ($1, $2), ($3, $4)",
      [participantA, personA, participantB, personB],
    );
    await client.query(
      "insert into public.participant_account_scopes(auth_user_id, scope_kind) values ($1, 'worker'), ($2, 'worker')",
      [participantA, participantB],
    );

    await becomeAuthenticated(client, participantA);
    const accounts = await client.query<{
      auth_user_id: string;
      status: string;
    }>("select auth_user_id, status::text from public.participant_accounts");
    const scopes = await client.query<{
      auth_user_id: string;
      scope_kind: string;
    }>(
      "select auth_user_id, scope_kind::text from public.participant_account_scopes",
    );
    expect(accounts.rows).toEqual([
      { auth_user_id: participantA, status: "active" },
    ]);
    expect(scopes.rows).toEqual([
      { auth_user_id: participantA, scope_kind: "worker" },
    ]);
    await expect(
      client.query(
        "update public.participant_accounts set status = 'disabled'",
      ),
    ).rejects.toThrow("permission denied");
    await client.query("rollback");
  });

  it("denies anonymous reads and gives operator auth no implicit participant mapping", async () => {
    const client = await connect();
    await createAuthUser(client, operatorOnly);
    await client.query(
      "insert into public.operator_accounts(user_id, role) values ($1, 'ops_user')",
      [operatorOnly],
    );
    await client.query("set local role anon");
    await expect(
      client.query("select * from public.participant_accounts"),
    ).rejects.toThrow("permission denied");
    await client.query("set local role postgres");
    await becomeAuthenticated(client, operatorOnly);
    const accounts = await client.query(
      "select * from public.participant_accounts",
    );
    const scopes = await client.query(
      "select * from public.participant_account_scopes",
    );
    expect(accounts.rows).toEqual([]);
    expect(scopes.rows).toEqual([]);
    await client.query("rollback");
  });

  it("validates worker and contractor scopes against active mapped relationships", async () => {
    const client = await connect();
    await createAuthUser(client, participantA);
    const people = await client.query<{ id: string }>(
      "insert into public.people(display_name) values ('Mapped person'), ('Other contact') returning id",
    );
    const personA = people.rows[0]?.id;
    const otherPerson = people.rows[1]?.id;
    await client.query(
      "insert into public.participant_accounts(auth_user_id, person_id, status) values ($1, $2, 'disabled')",
      [participantA, personA],
    );
    const disabled = await client.query<{ status: string }>(
      "select status::text from public.participant_accounts where auth_user_id = $1",
      [participantA],
    );
    expect(disabled.rows[0]?.status).toBe("disabled");

    await client.query("savepoint worker_mismatch");
    await expect(
      client.query(
        "insert into public.participant_account_scopes(auth_user_id, scope_kind) values ($1, 'worker')",
        [participantA],
      ),
    ).rejects.toThrow("active worker profile");
    await client.query("rollback to savepoint worker_mismatch");

    const organisation = await client.query<{ id: string }>(
      "insert into public.organisations(legal_name, display_name) values ('Scope Test Ltd', 'Scope Test') returning id",
    );
    const contact = await client.query<{ id: string }>(
      "insert into public.organisation_contacts(organisation_id, person_id) values ($1, $2) returning id",
      [organisation.rows[0]?.id, otherPerson],
    );
    await client.query("savepoint contractor_mismatch");
    await expect(
      client.query(
        "insert into public.participant_account_scopes(auth_user_id, scope_kind, organisation_contact_id) values ($1, 'contractor', $2)",
        [participantA, contact.rows[0]?.id],
      ),
    ).rejects.toThrow("mapped person");
    await client.query("rollback to savepoint contractor_mismatch");
    await client.query("rollback");
  });

  it("does not grant mapped participants access to private Work Graph data", async () => {
    const client = await connect();
    await createAuthUser(client, participantA);
    const person = await client.query<{ id: string }>(
      "insert into public.people(display_name) values ('Mapped worker') returning id",
    );
    const personId = person.rows[0]?.id;
    await client.query(
      "insert into public.worker_profiles(person_id) values ($1)",
      [personId],
    );
    await client.query(
      "insert into public.participant_accounts(auth_user_id, person_id) values ($1, $2)",
      [participantA, personId],
    );
    await client.query(
      "insert into public.participant_account_scopes(auth_user_id, scope_kind) values ($1, 'worker')",
      [participantA],
    );
    await becomeAuthenticated(client, participantA);

    for (const table of [
      "people",
      "worker_profiles",
      "workmarks",
      "assignments",
      "person_private_details",
      "worker_private_details",
    ] as const) {
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from public.${table}`,
      );
      expect(result.rows[0]?.count, table).toBe("0");
    }
    await client.query("rollback");
  });
});
