import { randomUUID } from "node:crypto";

import { Client } from "pg";

import type { ParticipantUserFixtureData } from "./test-data";

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

export type TomorrowCommandFixture = {
  date: string;
  organisationId: string;
  contactId: string;
  hirerPersonId: string;
  phone: string;
  providerMessageId: string;
  requestId?: string;
  requirementId?: string;
  assignmentId?: string;
  worker: ParticipantUserFixtureData;
  operatorCommandKeys: string[];
};

export async function provisionTomorrowCommandFixture(
  worker: ParticipantUserFixtureData,
  dateOffset: number,
): Promise<TomorrowCommandFixture> {
  const fixture: TomorrowCommandFixture = {
    date: "",
    organisationId: randomUUID(),
    contactId: randomUUID(),
    hirerPersonId: randomUUID(),
    // NANP 555-0100..0199 is reserved for fictional use; never target a real worker.
    phone: `+121255501${String(dateOffset).padStart(2, "0")}`,
    providerMessageId: `wamid.playwright.${randomUUID().replaceAll("-", "")}`,
    worker,
    operatorCommandKeys: [],
  };

  await withClient(async (client) => {
    await client.query("begin");
    try {
      const date = await client.query<{ work_date: string }>(
        `select (timezone('Africa/Johannesburg', now())::date + $1::integer)::text as work_date`,
        [dateOffset],
      );
      const workDate = date.rows[0]?.work_date;
      if (workDate === undefined) {
        throw new Error("Tomorrow command fixture could not resolve its date.");
      }
      fixture.date = workDate;

      await client.query(
        `insert into auth.users(
           id, instance_id, aud, role, email, encrypted_password,
           email_confirmed_at, confirmation_token, recovery_token, email_change,
           email_change_token_current, email_change_token_new, reauthentication_token,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at
         ) values (
           $1, '00000000-0000-0000-0000-000000000000', 'authenticated',
           'authenticated', $2, crypt($3, gen_salt('bf')), now(), '', '', '',
           '', '', '', '{}', '{}', now(), now()
         )`,
        [worker.id, worker.email, worker.password],
      );
      await client.query(
        `insert into public.people(id, display_name) values
          ($1, $2), ($3, 'Tomorrow Command Hirer')`,
        [worker.personId, worker.displayName, fixture.hirerPersonId],
      );
      await client.query(
        `insert into public.worker_profiles(person_id) values ($1)`,
        [worker.personId],
      );
      await client.query(
        `insert into public.person_phone_numbers(person_id, phone_number, is_primary)
         values ($1, $2, true)`,
        [worker.personId, fixture.phone],
      );
      await client.query(
        `insert into public.participant_accounts(auth_user_id, person_id)
         values ($1, $2)`,
        [worker.id, worker.personId],
      );
      await client.query(
        `insert into public.participant_account_scopes(auth_user_id, scope_kind)
         values ($1, 'worker')`,
        [worker.id],
      );
      await client.query(
        `insert into public.organisations(id, legal_name, display_name)
         values ($1, 'Tomorrow Command Build (Synthetic)', 'Tomorrow Command Build')`,
        [fixture.organisationId],
      );
      await client.query(
        `insert into public.organisation_contacts(
           id, organisation_id, person_id, role_name, is_primary
         ) values ($1, $2, $3, 'Synthetic fixture contact', true)`,
        [fixture.contactId, fixture.organisationId, fixture.hirerPersonId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  return fixture;
}

export async function readTomorrowRequirementId(
  requestId: string,
): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `select id from public.labour_requirements
       where labour_request_id = $1 and archived_at is null
       order by created_at limit 1`,
      [requestId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("Canonical Labour Request created no requirement.");
    }
    return id;
  });
}

export async function readTomorrowAssignmentId(
  requestId: string,
  workerId: string,
): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `select assignment.id
       from public.assignments assignment
       join public.labour_requirements requirement
         on requirement.id = assignment.labour_requirement_id
       where requirement.labour_request_id = $1 and assignment.worker_id = $2
       order by assignment.created_at desc limit 1`,
      [requestId, workerId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("Canonical worker offer created no Assignment.");
    }
    return id;
  });
}

export async function readTomorrowAssignmentState(
  assignmentId: string,
): Promise<{
  workerResponse: string;
  travelAuthorised: boolean;
  responseSource: string | null;
}> {
  return withClient(async (client) => {
    const result = await client.query<{
      workerResponse: string;
      travelAuthorised: boolean;
      responseSource: string | null;
    }>(
      `select worker_response as "workerResponse",
              travel_authorised_at is not null and travel_revoked_at is null as "travelAuthorised",
              (select event.source_channel from private.domain_events event
               where event.aggregate_type = 'assignment' and event.aggregate_id = assignment.id
                 and event.event_type = 'assignment.worker_responded'
               order by event.occurred_at desc limit 1) as "responseSource"
       from public.assignments assignment where id = $1`,
      [assignmentId],
    );
    const state = result.rows[0];
    if (state === undefined)
      throw new Error("Tomorrow Assignment disappeared.");
    return state;
  });
}

export async function readTomorrowTravelQueue(
  assignmentId: string,
): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ state: string }>(
      `select outbox.state
       from private.domain_events event
       join private.outbox_messages outbox on outbox.domain_event_id = event.id
       where event.aggregate_type = 'assignment'
         and event.aggregate_id = $1
         and event.event_type = 'assignment.travel_authorised'
       order by event.occurred_at desc limit 1`,
      [assignmentId],
    );
    return result.rows[0]?.state ?? null;
  });
}

export async function readTomorrowTravelDelivery(
  assignmentId: string,
): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ state: string }>(
      `select delivery.state
       from private.domain_events event
       join public.channel_deliveries delivery
         on delivery.idempotency_key = 'domain-event:' || event.id::text
       where event.aggregate_type = 'assignment'
         and event.aggregate_id = $1
         and event.event_type = 'assignment.travel_authorised'
         and delivery.channel = 'whatsapp'
       order by event.occurred_at desc limit 1`,
      [assignmentId],
    );
    return result.rows[0]?.state ?? null;
  });
}

async function runApiPython(
  python: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  return execFileAsync(
    "uv",
    ["run", "--project", "apps/api", "python", "-c", python, ...args],
    { cwd: process.cwd(), windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  );
}

export async function signWhatsAppWebhookBody(body: string): Promise<string> {
  const python = String.raw`
import hashlib, hmac, sys
from app.core.config import get_settings
secret = get_settings().whatsapp_app_secret.encode("utf-8")
print("sha256=" + hmac.new(secret, sys.argv[1].encode("utf-8"), hashlib.sha256).hexdigest())
`;
  const { stdout } = await runApiPython(python, [body]);
  return stdout.trim();
}

export async function runWhatsAppProcessorForFixtureEvent(
  providerMessageId: string,
): Promise<void> {
  const python = String.raw`
import asyncio, sys
sys.path.insert(0, "apps/api")
from app.core.config import get_settings
from app.integrations.database import Database
from app.workers.whatsapp import _process_message_job

async def main():
    settings = get_settings()
    database = Database(settings)
    await database.open()
    try:
        async with database.service_transaction() as connection:
            result = await connection.execute(
                "select id from public.channel_events where provider_message_id = %s",
                (sys.argv[1],),
            )
            event = await result.fetchone()
            if event is None:
                raise RuntimeError("Fixture WhatsApp ChannelEvent was not persisted")
            event_id = str(event["id"])
        async with database.service_transaction() as connection:
            outcome = await _process_message_job(connection, event_id, settings, database)
            job_result = await connection.execute(
                "select id from public.channel_processing_jobs where channel_event_id = %s::uuid",
                (event_id,),
            )
            job = await job_result.fetchone()
            if job is not None:
                await connection.execute(
                    "update public.channel_processing_jobs set state = 'leased', attempts = attempts + 1, leased_until = now() + interval '1 minute' where id = %s and state = 'queued'",
                    (job["id"],),
                )
                await connection.execute(
                    "select public.complete_channel_processing_job(%s, %s, %s, %s)",
                    (job["id"], outcome != "failed", None, False),
                )
        if outcome != "executed":
            raise RuntimeError("WhatsApp worker did not execute the assignment response: " + outcome)
    finally:
        await database.close()

asyncio.run(main())
`;
  await runApiPython(python, [providerMessageId]);
}

export async function publishTomorrowCommandOutbox(): Promise<void> {
  // The existing publisher materialises queued channel deliveries; it never
  // invokes the provider sender. Require an isolated, reset local E2E DB:
  // the publisher claims pending rows globally, not only this fixture.
  const hostname = new URL(localDatabaseUrl()).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      "Tomorrow E2E outbox publishing requires a local database.",
    );
  }
  const python = String.raw`
import asyncio, sys
sys.path.insert(0, "apps/api")
from app.core.config import get_settings
from app.integrations.database import Database
from app.workers.whatsapp import run_command_outbox_jobs

async def main():
    database = Database(get_settings())
    await database.open()
    try:
        outcomes = await run_command_outbox_jobs(database, batch_size=100)
        if any(item["outcome"] == "failed" for item in outcomes):
            raise RuntimeError("Command outbox publisher failed")
    finally:
        await database.close()

asyncio.run(main())
`;
  await runApiPython(python, []);
}

export async function removeTomorrowCommandFixture(
  fixture: TomorrowCommandFixture,
  operatorUserId: string,
): Promise<void> {
  await withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local session_replication_role = 'replica'");
      // Resolve committed Assignments even when the browser failed between the
      // create and offer commands, before the test could capture their IDs.
      const assignments = fixture.requestId
        ? await client.query<{ id: string }>(
            "select id from public.assignments where labour_request_id = $1 and worker_id = $2",
            [fixture.requestId, fixture.worker.personId],
          )
        : { rows: [] };
      const assignmentIds = [
        ...new Set([
          ...assignments.rows.map((row) => row.id),
          ...[fixture.assignmentId].filter(
            (id): id is string => id !== undefined,
          ),
        ]),
      ];
      const aggregateIds = [fixture.requestId, ...assignmentIds].filter(
        (id): id is string => id !== undefined,
      );
      const event = await client.query<{ id: string }>(
        `select id from public.channel_events where provider_message_id = $1`,
        [fixture.providerMessageId],
      );
      const eventIds = event.rows.map((row) => row.id);
      const actions = await client.query<{ id: string }>(
        "select id from public.proposed_actions where channel_event_id = any($1::uuid[])",
        [eventIds],
      );
      const actionIds = actions.rows.map((row) => row.id);
      const executionResult = await client.query<{ id: string }>(
        `select distinct execution.id
         from private.command_executions execution
         left join private.domain_events domain_event
           on domain_event.command_execution_id = execution.id
         where (execution.actor_user_id = any($1::uuid[])
                and execution.idempotency_key = any($2::text[]))
            or domain_event.aggregate_id = any($3::uuid[])
            or domain_event.source_channel_event_id = any($4::uuid[])`,
        [
          [operatorUserId, fixture.worker.id],
          fixture.operatorCommandKeys,
          aggregateIds,
          eventIds,
        ],
      );
      const executionIds = executionResult.rows.map((row) => row.id);
      await client.query(
        `delete from public.channel_deliveries
         where source_channel_event_id = any($2::uuid[])
            or source_proposed_action_id = any($3::uuid[])
            or idempotency_key in (
           select 'domain-event:' || id::text from private.domain_events
           where command_execution_id = any($1::uuid[])
         )`,
        [executionIds, eventIds, actionIds],
      );
      await client.query(
        `delete from private.outbox_messages where domain_event_id in
         (select id from private.domain_events where command_execution_id = any($1::uuid[]))`,
        [executionIds],
      );
      await client.query(
        "delete from private.domain_events where command_execution_id = any($1::uuid[])",
        [executionIds],
      );
      await client.query(
        "delete from private.command_executions where id = any($1::uuid[])",
        [executionIds],
      );
      await client.query(
        "delete from public.channel_processing_jobs where channel_event_id = any($1::uuid[])",
        [eventIds],
      );
      await client.query(
        "delete from public.audit_events where source_channel_event_id = any($1::uuid[])",
        [eventIds],
      );
      await client.query(
        "delete from public.audit_events where source_proposed_action_id = any($1::uuid[])",
        [actionIds],
      );
      await client.query(
        "delete from public.semantic_decisions where channel_event_id = any($1::uuid[])",
        [eventIds],
      );
      await client.query(
        "delete from public.proposed_actions where id = any($1::uuid[])",
        [actionIds],
      );
      await client.query(
        "delete from public.channel_media_assets where channel_event_id = any($1::uuid[])",
        [eventIds],
      );
      await client.query(
        "delete from public.channel_events where id = any($1::uuid[])",
        [eventIds],
      );
      await client.query(
        `delete from public.audit_events where record_id = any($1::uuid[])`,
        [
          [
            ...aggregateIds,
            fixture.requirementId,
            fixture.worker.personId,
            fixture.hirerPersonId,
            fixture.organisationId,
            fixture.contactId,
          ].filter((id): id is string => id !== undefined),
        ],
      );
      await client.query(
        "delete from public.assignments where id = any($1::uuid[])",
        [assignmentIds],
      );
      if (fixture.requirementId) {
        await client.query(
          "delete from public.labour_requirements where id = $1",
          [fixture.requirementId],
        );
      }
      if (fixture.requestId) {
        await client.query("delete from public.labour_requests where id = $1", [
          fixture.requestId,
        ]);
      }
      await client.query(
        "delete from public.person_phone_numbers where person_id = $1",
        [fixture.worker.personId],
      );
      await client.query(
        "delete from public.participant_account_scopes where auth_user_id = $1",
        [fixture.worker.id],
      );
      await client.query(
        "delete from public.participant_accounts where auth_user_id = $1",
        [fixture.worker.id],
      );
      await client.query(
        "delete from public.worker_profiles where person_id = $1",
        [fixture.worker.personId],
      );
      await client.query(
        "delete from public.organisation_contacts where id = $1",
        [fixture.contactId],
      );
      await client.query("delete from public.organisations where id = $1", [
        fixture.organisationId,
      ]);
      await client.query(
        "delete from public.people where id = any($1::uuid[])",
        [[fixture.worker.personId, fixture.hirerPersonId]],
      );
      await client.query("delete from auth.users where id = $1", [
        fixture.worker.id,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}
