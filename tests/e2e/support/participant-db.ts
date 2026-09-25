import { randomUUID } from "node:crypto";

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

export type ParticipantAssignmentFixture = {
  assignmentId: string;
  labourRequestId: string;
  labourRequirementId: string;
  organisationId: string;
};

export type AssignmentCloseoutState = {
  stampCount: number;
  workmarkCount: number;
  workmarkAssignmentId: string | null;
  workmarkWorkerId: string | null;
  stampAssignmentId: string | null;
  stampWorkerId: string | null;
};

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

export async function provisionParticipantWorkerAssignment(
  user: ParticipantUserFixtureData,
): Promise<ParticipantAssignmentFixture> {
  if (user.scope !== "worker") {
    throw new Error(
      "A worker assignment fixture requires a worker participant.",
    );
  }

  const fixture = {
    assignmentId: randomUUID(),
    labourRequestId: randomUUID(),
    labourRequirementId: randomUUID(),
    organisationId: randomUUID(),
  };

  await withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `insert into public.organisations(id, legal_name, display_name)
         values ($1, $2, $2)`,
        [fixture.organisationId, `Playwright closeout ${fixture.assignmentId}`],
      );
      await client.query(
        `insert into public.labour_requests(
          id, organisation_id, needed_from, needed_to, headcount, site_area
        ) values ($1, $2, '2026-09-20', '2026-09-20', 1, 'Playwright test area')`,
        [fixture.labourRequestId, fixture.organisationId],
      );
      await client.query(
        `insert into public.labour_requirements(
          id, labour_request_id, work_type, headcount
        ) values ($1, $2, 'Playwright closeout work', 1)`,
        [fixture.labourRequirementId, fixture.labourRequestId],
      );
      await client.query(
        `insert into public.assignments(
          id, labour_request_id, labour_requirement_id, worker_id, organisation_id,
          starts_on, ends_on, lifecycle, worker_response, contractor_confirmation,
          offered_at, reporting_mode, reporting_place_text, reporting_at,
          travel_authorised_at, source, version
        ) values (
          $1, $2, $3, $4, $5, '2026-09-20', '2026-09-20', 'active',
          'accepted', 'confirmed', now(), 'site', 'Playwright test area', now(),
          now(), 'playwright', 1
        )`,
        [
          fixture.assignmentId,
          fixture.labourRequestId,
          fixture.labourRequirementId,
          user.personId,
          fixture.organisationId,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  return fixture;
}

export async function readAssignmentCloseoutState(
  assignmentId: string,
): Promise<AssignmentCloseoutState> {
  return withClient(async (client) => {
    const result = await client.query<AssignmentCloseoutState>(
      `select
        (select count(*)::integer from public.assignment_stamps
          where assignment_id = $1) as "stampCount",
        (select count(*)::integer from public.workmarks
          where assignment_id = $1) as "workmarkCount",
        (select assignment_id::text from public.workmarks
          where assignment_id = $1) as "workmarkAssignmentId",
        (select worker_id::text from public.workmarks
          where assignment_id = $1) as "workmarkWorkerId",
        (select assignment_id::text from public.assignment_stamps
          where assignment_id = $1) as "stampAssignmentId",
        (select asserted_by_person_id::text from public.assignment_stamps
          where assignment_id = $1) as "stampWorkerId"`,
      [assignmentId],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new Error("Closeout state query returned no row.");
    return row;
  });
}

export async function removeParticipantWorkerAssignment(
  user: ParticipantUserFixtureData,
  fixture: ParticipantAssignmentFixture,
): Promise<void> {
  await withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local session_replication_role = 'replica'");
      await client.query(
        `delete from private.outbox_messages
         where domain_event_id in (
           select id from private.domain_events
           where command_execution_id in (
             select id from private.command_executions where actor_user_id = $1
           )
         )`,
        [user.id],
      );
      await client.query(
        `delete from private.domain_events
         where command_execution_id in (
           select id from private.command_executions where actor_user_id = $1
         )`,
        [user.id],
      );
      await client.query(
        "delete from private.command_executions where actor_user_id = $1",
        [user.id],
      );
      await client.query(
        `delete from public.audit_events
         where actor_id = $1 or record_id = any($2::uuid[])`,
        [
          user.personId,
          [
            fixture.assignmentId,
            fixture.labourRequestId,
            fixture.labourRequirementId,
            fixture.organisationId,
          ],
        ],
      );
      await client.query(
        `delete from public.workmark_corrections
         where workmark_id in (
           select id from public.workmarks where assignment_id = $1
         )`,
        [fixture.assignmentId],
      );
      await client.query(
        "delete from public.assignment_stamps where assignment_id = $1",
        [fixture.assignmentId],
      );
      await client.query(
        "delete from public.assignment_acknowledgements where assignment_id = $1",
        [fixture.assignmentId],
      );
      await client.query(
        "delete from public.workmarks where assignment_id = $1",
        [fixture.assignmentId],
      );
      await client.query("delete from public.assignments where id = $1", [
        fixture.assignmentId,
      ]);
      await client.query(
        "delete from public.labour_requirements where id = $1",
        [fixture.labourRequirementId],
      );
      await client.query("delete from public.labour_requests where id = $1", [
        fixture.labourRequestId,
      ]);
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
