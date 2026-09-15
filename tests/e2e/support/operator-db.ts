import { Client } from "pg";

import type { OperatorUserFixtureData } from "./test-data";

const authInstanceId = "00000000-0000-0000-0000-000000000000";

function localDatabaseUrl(): string {
  return (
    process.env.SUPABASE_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  );
}

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: localDatabaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function provisionOperatorUser(
  user: OperatorUserFixtureData,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `insert into auth.users(
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, confirmation_token, recovery_token, email_change,
        email_change_token_current, email_change_token_new, reauthentication_token,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        $1, $2, 'authenticated', 'authenticated', $3,
          crypt($4, gen_salt('bf')), now(), '', '', '', '', '', '', '{}', '{}', now(), now()
      )
      on conflict (id) do update set
        email = excluded.email,
        encrypted_password = excluded.encrypted_password,
        email_confirmed_at = excluded.email_confirmed_at,
        confirmation_token = ''::text,
        recovery_token = ''::text,
        email_change = ''::text,
        email_change_token_current = ''::text,
        email_change_token_new = ''::text,
        reauthentication_token = ''::text,
        updated_at = now()`,
      [user.id, authInstanceId, user.email, user.password],
    );
    await client.query(
      `insert into public.operator_accounts(user_id, role)
       values ($1, $2)
       on conflict (user_id) do update set role = excluded.role, archived_at = null`,
      [user.id, user.role],
    );
  });
}

export async function removeOperatorUser(userId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `delete from public.operator_accounts where user_id = $1`,
      [userId],
    );
    await client.query(`delete from auth.users where id = $1`, [userId]);
  });
}
