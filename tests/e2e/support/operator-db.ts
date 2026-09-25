import { randomUUID } from "node:crypto";

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
    // Keep the synthetic identity when immutable audit history records it.
    // Deleting that history would break provenance and its operator FK.
    const audit = await client.query<{ referenced: boolean }>(
      `select exists (
         select 1 from public.audit_events where operator_account_id = $1
       ) as referenced`,
      [userId],
    );
    if (audit.rows[0]?.referenced) {
      await client.query(
        `update public.operator_accounts
         set archived_at = timezone('utc', now())
         where user_id = $1`,
        [userId],
      );
      return;
    }
    await client.query(
      `delete from public.operator_accounts where user_id = $1`,
      [userId],
    );
    await client.query(`delete from auth.users where id = $1`, [userId]);
  });
}

export type PendingInboxItemFixture = {
  actionId: string;
  channelEventId: string;
  originalText: string;
};

export async function provisionPendingInboxItem(): Promise<PendingInboxItemFixture> {
  const fixture = {
    actionId: randomUUID(),
    channelEventId: randomUUID(),
    originalText: `Playwright inbox review ${randomUUID()}`,
  };

  await withClient(async (client) => {
    await client.query(
      `insert into public.channel_events(
        id, channel, provider_event_id, sender_phone_number, event_type,
        occurred_at, state, payload
      ) values ($1, 'whatsapp', $2, '+27820000099', 'message', now(), 'processed', $3::jsonb)`,
      [
        fixture.channelEventId,
        `playwright-${fixture.channelEventId}`,
        JSON.stringify({ synthetic: true }),
      ],
    );
    await client.query(
      `insert into public.proposed_actions(
        id, channel_event_id, action_type, risk_tier, payload, state,
        confidence, ambiguity, interpretation, model_provider, model_name
      ) values (
        $1, $2, 'propose_workmark', 'operational', $3::jsonb, 'pending',
        0.91, 'clear', $4::jsonb, 'playwright', 'fixture'
      )`,
      [
        fixture.actionId,
        fixture.channelEventId,
        JSON.stringify({
          fields: { workDate: "2026-09-20" },
          entityIds: {},
        }),
        JSON.stringify({ originalText: fixture.originalText }),
      ],
    );
  });

  return fixture;
}

export async function removePendingInboxItem(
  fixture: PendingInboxItemFixture,
): Promise<void> {
  await withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local session_replication_role = 'replica'");
      await client.query(`delete from public.proposed_actions where id = $1`, [
        fixture.actionId,
      ]);
      await client.query(`delete from public.channel_events where id = $1`, [
        fixture.channelEventId,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}
