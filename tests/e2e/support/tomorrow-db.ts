import { randomUUID } from "node:crypto";

import { Client } from "pg";

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

export type TomorrowScenarioFixture = {
  date: string;
  organisationId: string;
  hirerPersonId: string;
  workerIds: string[];
  labourRequestId: string;
  requirementId: string;
  assignmentIds: string[];
  exceptionId: string;
  commandExecutionId: string;
  domainEventId: string;
  channelDeliveryId: string;
};

export async function provisionTomorrowScenario(
  operatorUserId: string,
  dateOffset = 1,
): Promise<TomorrowScenarioFixture> {
  const fixture: TomorrowScenarioFixture = {
    date: "",
    organisationId: randomUUID(),
    hirerPersonId: randomUUID(),
    workerIds: [randomUUID(), randomUUID(), randomUUID()],
    labourRequestId: randomUUID(),
    requirementId: randomUUID(),
    assignmentIds: [randomUUID(), randomUUID(), randomUUID()],
    exceptionId: randomUUID(),
    commandExecutionId: randomUUID(),
    domainEventId: randomUUID(),
    channelDeliveryId: randomUUID(),
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
        throw new Error("Tomorrow fixture could not resolve its work date.");
      }
      fixture.date = workDate;

      await client.query(
        `insert into public.people(id, display_name) values
          ($1, 'Tomorrow Fixture Hirer'), ($2, 'Mina Accepted'),
          ($3, 'Sizwe Travel Ready'), ($4, 'Aphiwe Offered')`,
        [fixture.hirerPersonId, ...fixture.workerIds],
      );
      await client.query(
        `insert into public.worker_profiles(person_id) values ($1), ($2), ($3)`,
        fixture.workerIds,
      );
      await client.query(
        `insert into public.organisations(id, legal_name, display_name)
         values ($1, 'Tomorrow Fixture Build (Synthetic)', 'Tomorrow Fixture Build')`,
        [fixture.organisationId],
      );
      await client.query(
        `insert into public.labour_requests(
           id, organisation_id, requester_person_id, needed_from, needed_to,
           needed_at, headcount, rate_cents, currency, site_area, site_text,
           lifecycle, source
         ) values (
           $1, $2, null, $3::date, $3::date, '07:30', 4, 125000, 'ZAR',
           'Bellville', 'Synthetic North Gate', 'active', 'playwright synthetic fixture'
         )`,
        [fixture.labourRequestId, fixture.organisationId, fixture.date],
      );
      await client.query(
        `insert into public.labour_requirements(id, labour_request_id, work_type, headcount)
         values ($1, $2, 'Plastering', 4)`,
        [fixture.requirementId, fixture.labourRequestId],
      );

      // Keep the states deliberately distinct: accepted is still waiting, only
      // the second assignment has canonical travel authorisation, and the third
      // is still waiting on the worker.
      await client.query(
        `insert into public.assignments(
           id, labour_request_id, labour_requirement_id, worker_id,
           organisation_id, hirer_person_id, starts_on, ends_on,
           lifecycle, worker_response, contractor_confirmation, offered_at,
           reporting_mode, reporting_place_text, reporting_at,
           travel_authorised_at, version, source
         ) values
           ($1, $2, $3, $4, $5, null, $6::date, $6::date, 'active', 'accepted', 'pending', now(),
             null, null, null, null, 1, 'playwright synthetic fixture'),
           ($7, $2, $3, $8, $5, null, $6::date, $6::date, 'active', 'accepted', 'confirmed', now(),
             'pickup', 'Bellville Library', ($6::date + time '06:45') at time zone 'Africa/Johannesburg',
             now(), 1, 'playwright synthetic fixture'),
           ($9, $2, $3, $10, $5, null, $6::date, $6::date, 'active', 'pending', 'pending', now(),
             null, null, null, null, 1, 'playwright synthetic fixture')`,
        [
          fixture.assignmentIds[0],
          fixture.labourRequestId,
          fixture.requirementId,
          fixture.workerIds[0],
          fixture.organisationId,
          fixture.date,
          fixture.assignmentIds[1],
          fixture.workerIds[1],
          fixture.assignmentIds[2],
          fixture.workerIds[2],
        ],
      );
      await client.query(
        `insert into public.exception_cases(
           id, assignment_id, state, category, summary, source, recorded_by_user_id
         ) values (
           $1, $2, 'open', 'verification_trust_concern',
           'Synthetic follow-up requires operator review',
           'playwright synthetic fixture', $3
         )`,
        [fixture.exceptionId, fixture.assignmentIds[1], operatorUserId],
      );

      await client.query(
        `insert into private.command_executions(
           id, actor_user_id, command_name, idempotency_key, request_hash,
           state, response_status, response_body, completed_at
         ) values ($1, $2, 'PlaywrightFixture', $3, repeat('a', 64), 'completed', 200, '{}'::jsonb, now())`,
        [
          fixture.commandExecutionId,
          operatorUserId,
          `tomorrow-fixture-${fixture.commandExecutionId}`,
        ],
      );
      await client.query(
        `insert into private.domain_events(
           id, command_execution_id, event_type, aggregate_type, aggregate_id
         ) values ($1, $2, 'assignment.travel_authorised', 'assignment', $3)`,
        [
          fixture.domainEventId,
          fixture.commandExecutionId,
          fixture.assignmentIds[1],
        ],
      );
      await client.query(
        `insert into public.channel_deliveries(
           id, channel, recipient_phone_number, message_kind, body,
           source_table, source_record_id, idempotency_key, state, failure_reason
         ) values (
           $1, 'whatsapp', '+12125550101', 'assignment.travel_authorised',
           'Synthetic travel-ready confirmation', 'domain_events', $2::uuid,
           'domain-event:' || $2::uuid::text, 'failed', 'Synthetic provider delivery failure'
         )`,
        [fixture.channelDeliveryId, fixture.domainEventId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  return fixture;
}

export async function removeTomorrowScenario(
  fixture: TomorrowScenarioFixture,
): Promise<void> {
  await withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local session_replication_role = 'replica'");
      const executions = await client.query<{ id: string }>(
        `select distinct execution.id from private.command_executions execution
         left join private.domain_events event on event.command_execution_id = execution.id
         where execution.id = $1
            or event.aggregate_id = any($2::uuid[])
            or event.aggregate_id = $3`,
        [
          fixture.commandExecutionId,
          fixture.assignmentIds,
          fixture.labourRequestId,
        ],
      );
      const executionIds = executions.rows.map((row) => row.id);
      await client.query(
        "delete from public.channel_deliveries where id = $1",
        [fixture.channelDeliveryId],
      );
      await client.query(
        `delete from public.channel_deliveries
         where idempotency_key in (
           select 'domain-event:' || event.id::text
           from private.domain_events event
           join private.command_executions execution
             on execution.id = event.command_execution_id
           where execution.id = any($1::uuid[])
         )`,
        [executionIds],
      );
      await client.query(
        `delete from private.outbox_messages
         where domain_event_id in (
           select event.id from private.domain_events event
           join private.command_executions execution
             on execution.id = event.command_execution_id
           where execution.id = any($1::uuid[])
         )`,
        [executionIds],
      );
      await client.query(
        `delete from private.domain_events
         where command_execution_id in (
           select id from private.command_executions where id = any($1::uuid[])
         )`,
        [executionIds],
      );
      await client.query(
        "delete from private.command_executions where id = any($1::uuid[])",
        [executionIds],
      );
      await client.query(
        `delete from public.audit_events where record_id = any($1::uuid[])`,
        [
          [
            fixture.exceptionId,
            ...fixture.assignmentIds,
            fixture.requirementId,
            fixture.labourRequestId,
            ...fixture.workerIds,
            fixture.hirerPersonId,
            fixture.organisationId,
          ],
        ],
      );
      await client.query("delete from public.exception_cases where id = $1", [
        fixture.exceptionId,
      ]);
      await client.query(
        "delete from public.assignments where id = any($1::uuid[])",
        [fixture.assignmentIds],
      );
      await client.query(
        "delete from public.labour_requirements where id = $1",
        [fixture.requirementId],
      );
      await client.query("delete from public.labour_requests where id = $1", [
        fixture.labourRequestId,
      ]);
      await client.query(
        "delete from public.worker_profiles where person_id = any($1::uuid[])",
        [fixture.workerIds],
      );
      await client.query(
        "delete from public.people where id = any($1::uuid[])",
        [[fixture.hirerPersonId, ...fixture.workerIds]],
      );
      await client.query("delete from public.organisations where id = $1", [
        fixture.organisationId,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}
