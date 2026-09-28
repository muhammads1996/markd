import { randomUUID } from "node:crypto";

import { Client } from "pg";

const localDatabaseUrl = () =>
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: localDatabaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export type ActivationFixture = {
  personId: string;
  phone: string;
  scopeKind: "worker" | "contractor";
  subjectId: string;
  organisationId: string | null;
};

export async function provisionActivationIdentity(
  scopeKind: ActivationFixture["scopeKind"],
  phone: string,
): Promise<ActivationFixture> {
  const fixture: ActivationFixture = {
    personId: randomUUID(),
    phone,
    scopeKind,
    subjectId: scopeKind === "worker" ? "" : randomUUID(),
    organisationId: scopeKind === "contractor" ? randomUUID() : null,
  };
  fixture.subjectId =
    scopeKind === "worker" ? fixture.personId : fixture.subjectId;
  await withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        "insert into public.people(id, display_name) values ($1, $2)",
        [fixture.personId, `Synthetic ${scopeKind} activation`],
      );
      await client.query(
        `insert into public.person_phone_numbers(person_id, phone_number, is_primary)
         values ($1, $2, true)`,
        [fixture.personId, phone],
      );
      if (scopeKind === "worker") {
        await client.query(
          "insert into public.worker_profiles(person_id) values ($1)",
          [fixture.personId],
        );
      } else {
        await client.query(
          `insert into public.organisations(id, legal_name, display_name)
           values ($1, 'Synthetic activation contractor', 'Synthetic activation contractor')`,
          [fixture.organisationId],
        );
        await client.query(
          `insert into public.organisation_contacts(id, organisation_id, person_id, is_primary)
           values ($1, $2, $3, true)`,
          [fixture.subjectId, fixture.organisationId, fixture.personId],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
  return fixture;
}

export async function removeActivationIdentity(
  fixture: ActivationFixture,
): Promise<void> {
  await withClient(async (client) => {
    await client.query("begin");
    try {
      // E2E setup rows are synthetic. Remove them so the fixed local OTP
      // numbers remain reusable by a later run.
      await client.query(
        "delete from public.participant_account_events where person_id = $1",
        [fixture.personId],
      );
      await client.query(
        `delete from public.participant_account_scopes
         where auth_user_id in (
           select auth_user_id from public.participant_accounts where person_id = $1
         )`,
        [fixture.personId],
      );
      await client.query(
        "delete from public.participant_accounts where person_id = $1",
        [fixture.personId],
      );
      await client.query(
        "delete from auth.users where raw_app_meta_data->>'markd_participant_person_id' = $1",
        [fixture.personId],
      );
      await client.query(
        "delete from public.person_phone_numbers where person_id = $1",
        [fixture.personId],
      );
      if (fixture.scopeKind === "worker") {
        await client.query(
          "delete from public.worker_profiles where person_id = $1",
          [fixture.personId],
        );
      } else {
        await client.query(
          "delete from public.organisation_contacts where id = $1",
          [fixture.subjectId],
        );
        await client.query("delete from public.organisations where id = $1", [
          fixture.organisationId,
        ]);
      }
      await client.query("delete from public.people where id = $1", [
        fixture.personId,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function readActivationState(personId: string): Promise<{
  accountStatus: string | null;
  scopeKinds: string[];
}> {
  return withClient(async (client) => {
    const result = await client.query<{
      account_status: string | null;
      scope_kinds: string[] | null;
    }>(
      `select account.status::text as account_status,
         coalesce(array_agg(scope.scope_kind::text) filter (where scope.scope_kind is not null), '{}') as scope_kinds
       from (select $1::uuid as person_id) as target
       left join public.participant_accounts as account on account.person_id = target.person_id
       left join public.participant_account_scopes as scope on scope.auth_user_id = account.auth_user_id
       group by account.status`,
      [personId],
    );
    return {
      accountStatus: result.rows[0]?.account_status ?? null,
      scopeKinds: result.rows[0]?.scope_kinds ?? [],
    };
  });
}

export async function readCanonicalIdentityCounts(
  fixture: ActivationFixture,
): Promise<{
  people: number;
  workerProfiles: number;
  organisationContacts: number;
}> {
  return withClient(async (client) => {
    const result = await client.query<{
      people: number;
      worker_profiles: number;
      organisation_contacts: number;
    }>(
      `select
         (select count(*)::integer from public.people where id = $1) as people,
         (select count(*)::integer from public.worker_profiles where person_id = $1) as worker_profiles,
         (select count(*)::integer from public.organisation_contacts where person_id = $1) as organisation_contacts`,
      [fixture.personId],
    );
    const row = result.rows[0];
    return {
      people: row?.people ?? 0,
      workerProfiles: row?.worker_profiles ?? 0,
      organisationContacts: row?.organisation_contacts ?? 0,
    };
  });
}
