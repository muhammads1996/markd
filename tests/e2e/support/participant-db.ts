import { Client } from "pg";

import type { ParticipantUserFixtureData } from "./test-data";

const authInstanceId = "00000000-0000-0000-0000-000000000000";
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

export async function provisionParticipantUser(
  user: ParticipantUserFixtureData,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change, email_change_token_current, email_change_token_new, reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, $2, 'authenticated', 'authenticated', $3, crypt($4, gen_salt('bf')), now(), '', '', '', '', '', '', '{}', '{}', now(), now())`,
      [user.id, authInstanceId, user.email, user.password],
    );
    await client.query(
      "insert into public.people(id, display_name) values ($1, $2)",
      [user.personId, user.displayName],
    );
    if (user.scope === "worker") {
      await client.query(
        "insert into public.worker_profiles(person_id) values ($1)",
        [user.personId],
      );
    } else {
      await client.query(
        "insert into public.organisations(id, legal_name, display_name) values ($1, $2, $2)",
        [user.organisationId, `${user.displayName} Test Build`],
      );
      await client.query(
        "insert into public.organisation_contacts(id, organisation_id, person_id, is_primary) values ($1, $2, $3, true)",
        [user.organisationContactId, user.organisationId, user.personId],
      );
    }
    await client.query(
      "insert into public.participant_accounts(auth_user_id, person_id) values ($1, $2)",
      [user.id, user.personId],
    );
    await client.query(
      "insert into public.participant_account_scopes(auth_user_id, scope_kind, organisation_contact_id) values ($1, $2, $3)",
      [
        user.id,
        user.scope,
        user.scope === "contractor" ? user.organisationContactId : null,
      ],
    );
  });
}

export async function removeParticipantUser(
  user: ParticipantUserFixtureData,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      "delete from public.participant_account_scopes where auth_user_id = $1",
      [user.id],
    );
    await client.query(
      "delete from public.participant_accounts where auth_user_id = $1",
      [user.id],
    );
    if (user.scope === "worker")
      await client.query(
        "delete from public.worker_profiles where person_id = $1",
        [user.personId],
      );
    if (user.scope === "contractor") {
      await client.query(
        "delete from public.organisation_contacts where id = $1",
        [user.organisationContactId],
      );
      await client.query("delete from public.organisations where id = $1", [
        user.organisationId,
      ]);
    }
    await client.query("delete from public.people where id = $1", [
      user.personId,
    ]);
    await client.query("delete from auth.users where id = $1", [user.id]);
  });
}
