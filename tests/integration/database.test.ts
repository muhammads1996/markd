import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const localDatabaseUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const clients: Client[] = [];

const authInstanceId = "00000000-0000-0000-0000-000000000000";
const operatorAdminId = "90000000-0000-4000-8000-000000000001";
const operatorUserId = "90000000-0000-4000-8000-000000000002";
const unprovisionedUserId = "90000000-0000-4000-8000-000000000003";

async function createOperator(
  client: Client,
  userId: string,
  role: "ops_admin" | "ops_user",
): Promise<void> {
  await client.query(
    `insert into auth.users(
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      $1, $2, 'authenticated', 'authenticated', $3, 'not-used-in-tests',
      now(), '{}', '{}', now(), now()
    )`,
    [userId, authInstanceId, `${userId}-${role}@example.test`],
  );
  await client.query(
    "insert into public.operator_accounts(user_id, role) values ($1, $2::public.operator_role)",
    [userId, role],
  );
}

async function becomeAuthenticatedOperator(
  client: Client,
  userId: string,
): Promise<void> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ]);
  await client.query("set local role authenticated");
}

const domainTables = [
  "assignments",
  "audit_events",
  "availability_signals",
  "channel_events",
  "crew_links",
  "exception_cases",
  "labour_requests",
  "labour_requirements",
  "languages",
  "operator_accounts",
  "organisation_contacts",
  "organisations",
  "people",
  "person_languages",
  "person_phone_numbers",
  "person_private_details",
  "proposed_actions",
  "sites",
  "skills",
  "verification_claims",
  "worker_media_assets",
  "worker_private_details",
  "worker_profiles",
  "worker_skill_evidence",
  "workmark_skills",
  "workmarks",
] as const;

async function insertTestWorkmark(client: Client): Promise<string> {
  const worker = await client.query<{ id: string }>(
    "insert into public.people(display_name) values ('Worker test') returning id",
  );
  const workerId = worker.rows[0]?.id;
  await client.query(
    "insert into public.worker_profiles(person_id) values ($1)",
    [workerId],
  );
  const organisation = await client.query<{ id: string }>(
    "insert into public.organisations(legal_name, display_name) values ('Test Build Ltd', 'Test Build') returning id",
  );
  const organisationId = organisation.rows[0]?.id;
  const workmark = await client.query<{ id: string }>(
    "insert into public.workmarks(worker_id, organisation_id, work_started_on, work_ended_on, origin, lifecycle, attendance, source) values ($1, $2, '2026-09-01', '2026-09-01', 'operator_recorded', 'confirmed', 'attended', 'test') returning id",
    [workerId, organisationId],
  );
  return workmark.rows[0]?.id ?? "";
}

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

  it("enforces canonical constraints and preserves historical phone numbers", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");

    const person = await client.query<{ id: string }>(
      "insert into public.people(display_name) values ('Constraint sample') returning id",
    );
    const personId = person.rows[0]?.id;
    expect(personId).toBeDefined();
    await client.query(
      "insert into public.person_phone_numbers(person_id, phone_number, is_primary) values ($1, '+27821111111', true)",
      [personId],
    );
    await client.query(
      "update public.person_phone_numbers set archived_at = now() where person_id = $1",
      [personId],
    );
    await client.query(
      "insert into public.person_phone_numbers(person_id, phone_number, is_primary) values ($1, '+27821111111', true)",
      [personId],
    );
    await expect(
      client.query(
        "insert into public.person_phone_numbers(person_id, phone_number) values ($1, '0820000001')",
        [personId],
      ),
    ).rejects.toThrow();
    await client.query("rollback");
  });

  it("keeps verification claims immutable, auditable, and separate from objective outcomes", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    const workmarkId = await insertTestWorkmark(client);
    const claim = await client.query<{ id: string }>(
      "insert into public.verification_claims(workmark_id, stance, value, source) values ($1, 'disputed', '{\"attendance\":\"no_show\"}', 'test') returning id",
      [workmarkId],
    );
    const claimId = claim.rows[0]?.id;
    await client.query("savepoint immutable_claim");
    await expect(
      client.query(
        "update public.verification_claims set stance = 'confirmed' where id = $1",
        [claimId],
      ),
    ).rejects.toThrow("additive and immutable");
    await client.query("rollback to savepoint immutable_claim");
    const workmark = await client.query<{ attendance: string }>(
      "select attendance::text from public.workmarks where id = $1",
      [workmarkId],
    );
    expect(workmark.rows[0]?.attendance).toBe("attended");
    const audit = await client.query<{ count: string }>(
      "select count(*)::text as count from public.audit_events where table_name = 'verification_claims' and record_id = $1",
      [claimId],
    );
    expect(audit.rows[0]?.count).toBe("1");
    await expect(
      client.query(
        "insert into public.audit_events(table_name, record_id, action, changes) values ('test', gen_random_uuid(), 'INSERT', '{}')",
      ),
    ).rejects.toThrow("append-only");
    await client.query("rollback");
  });

  it("preserves typed source and actor context without copying sensitive source content into audit rows", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await client.query(
      "select set_config('app.actor_person_id', '10000000-0000-4000-8000-000000000002', true)",
    );
    const inserted = await client.query<{ id: string }>(
      `insert into public.workmarks(
        worker_id, organisation_id, source_channel_event_id,
        source_proposed_action_id, work_started_on, work_ended_on,
        origin, lifecycle, source, source_reference
      ) values (
        '10000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001',
        '72000000-0000-4000-8000-000000000001',
        '73000000-0000-4000-8000-000000000001',
        '2026-09-10', '2026-09-10', 'channel_event', 'draft',
        'private operator source', 'private external reference'
      ) returning id`,
    );
    const audit = await client.query<{
      actor_id: string | null;
      actor_kind: string;
      changes: Record<string, unknown>;
      source_channel_event_id: string | null;
      source_proposed_action_id: string | null;
    }>(
      `select actor_id, actor_kind, changes, source_channel_event_id, source_proposed_action_id
       from public.audit_events where table_name = 'workmarks' and record_id = $1`,
      [inserted.rows[0]?.id],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_id: "10000000-0000-4000-8000-000000000002",
      actor_kind: "operator",
      source_channel_event_id: "72000000-0000-4000-8000-000000000001",
      source_proposed_action_id: "73000000-0000-4000-8000-000000000001",
    });
    expect(JSON.stringify(audit.rows[0]?.changes)).not.toContain(
      "private operator source",
    );
    expect(JSON.stringify(audit.rows[0]?.changes)).not.toContain(
      "private external reference",
    );
    await client.query("rollback");
  });

  it("rejects contradictory assignment and Workmark graph edges", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    const otherOrganisation = await client.query<{ id: string }>(
      "insert into public.organisations(legal_name, display_name) values ('Other Synthetic Ltd', 'Other Synthetic') returning id",
    );
    const otherSite = await client.query<{ id: string }>(
      "insert into public.sites(organisation_id, name) values ($1, 'Other synthetic site') returning id",
      [otherOrganisation.rows[0]?.id],
    );
    await client.query("savepoint invalid_request_site");
    await expect(
      client.query(
        `insert into public.labour_requests(
          organisation_id, site_id, needed_from, needed_to, headcount
        ) values (
          '20000000-0000-4000-8000-000000000001', $1,
          '2026-09-10', '2026-09-10', 1
        )`,
        [otherSite.rows[0]?.id],
      ),
    ).rejects.toThrow("site must belong to its organisation");
    await client.query("rollback to savepoint invalid_request_site");
    await client.query("savepoint invalid_request_contact");
    await expect(
      client.query(
        `insert into public.labour_requests(
          organisation_id, requested_by_contact_id,
          needed_from, needed_to, headcount
        ) values ($1, '21000000-0000-4000-8000-000000000001',
                  '2026-09-10', '2026-09-10', 1)`,
        [otherOrganisation.rows[0]?.id],
      ),
    ).rejects.toThrow("contact must belong to its organisation");
    await client.query("rollback to savepoint invalid_request_contact");
    const siteLessRequest = await client.query<{ id: string }>(
      `insert into public.labour_requests(
        organisation_id, needed_from, needed_to, headcount
      ) values (
        '20000000-0000-4000-8000-000000000001',
        '2026-09-10', '2026-09-10', 1
      ) returning id`,
    );
    await client.query("savepoint invalid_assignment_site");
    await expect(
      client.query(
        `insert into public.assignments(
          labour_request_id, worker_id, organisation_id, site_id,
          starts_on, ends_on
        ) values (
          $1, '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000001', $2,
          '2026-09-10', '2026-09-10'
        )`,
        [siteLessRequest.rows[0]?.id, otherSite.rows[0]?.id],
      ),
    ).rejects.toThrow("site must belong to its organisation");
    await client.query("rollback to savepoint invalid_assignment_site");
    await client.query("savepoint invalid_assignment");
    await expect(
      client.query(
        `insert into public.assignments(
          labour_request_id, worker_id, organisation_id, starts_on, ends_on
        ) values (
          '60000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000003', $1,
          '2026-09-08', '2026-09-09'
        )`,
        [otherOrganisation.rows[0]?.id],
      ),
    ).rejects.toThrow("must match its labour request");
    await client.query("rollback to savepoint invalid_assignment");
    await client.query("savepoint invalid_workmark");
    await expect(
      client.query(
        `insert into public.workmarks(
          worker_id, organisation_id, assignment_id, site_id,
          work_started_on, work_ended_on, origin, source
        ) values (
          '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000001',
          '62000000-0000-4000-8000-000000000001',
          '22000000-0000-4000-8000-000000000001',
          '2026-09-08', '2026-09-09', 'operator_recorded', 'test'
        )`,
      ),
    ).rejects.toThrow("must match its assignment");
    await client.query("rollback to savepoint invalid_workmark");
    for (const [savepoint, statement, message] of [
      [
        "assignment_parent_update",
        "update public.assignments set worker_id = '10000000-0000-4000-8000-000000000003' where id = '62000000-0000-4000-8000-000000000001'",
        "assignment relationship identity is immutable",
      ],
      [
        "request_parent_update",
        "update public.labour_requests set site_id = null where id = '60000000-0000-4000-8000-000000000001'",
        "labour request relationship identity is immutable",
      ],
      [
        "site_parent_update",
        "update public.sites set organisation_id = gen_random_uuid() where id = '22000000-0000-4000-8000-000000000001'",
        "site organisation is immutable",
      ],
      [
        "contact_parent_update",
        "update public.organisation_contacts set organisation_id = gen_random_uuid() where id = '21000000-0000-4000-8000-000000000001'",
        "organisation contact organisation is immutable",
      ],
    ] as const) {
      await client.query(`savepoint ${savepoint}`);
      await expect(client.query(statement)).rejects.toThrow(message);
      await client.query(`rollback to savepoint ${savepoint}`);
    }
    await client.query("rollback");
  });

  it("keeps raw channel, skill, Workmark-skill, and proposal evidence append-only", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await client.query("savepoint channel_event_mutation");
    await expect(
      client.query(
        "update public.channel_events set payload = '{}' where id = '72000000-0000-4000-8000-000000000001'",
      ),
    ).rejects.toThrow("append-only and immutable");
    await client.query("rollback to savepoint channel_event_mutation");
    await client.query("savepoint skill_evidence_mutation");
    await expect(
      client.query(
        "delete from public.worker_skill_evidence where id = '31000000-0000-4000-8000-000000000001'",
      ),
    ).rejects.toThrow("append-only and immutable");
    await client.query("rollback to savepoint skill_evidence_mutation");
    await client.query("savepoint workmark_skill_mutation");
    await expect(
      client.query(
        `delete from public.workmark_skills
         where workmark_id = '40000000-0000-4000-8000-000000000001'
           and skill_id = '30000000-0000-4000-8000-000000000001'`,
      ),
    ).rejects.toThrow("append-only and immutable");
    await client.query("rollback to savepoint workmark_skill_mutation");
    await client.query("savepoint proposal_evidence_mutation");
    await expect(
      client.query(
        `update public.proposed_actions set action_type = 'changed'
         where id = '73000000-0000-4000-8000-000000000001'`,
      ),
    ).rejects.toThrow("proposed action evidence is immutable");
    await client.query("rollback to savepoint proposal_evidence_mutation");
    await client.query("select set_config('app.actor_kind', 'system', true)");
    await client.query(
      `update public.proposed_actions set state = 'executed'
       where id = '73000000-0000-4000-8000-000000000001'`,
    );
    const proposalAudit = await client.query<{
      actor_kind: string;
      source_channel_event_id: string;
    }>(
      `select actor_kind, source_channel_event_id from public.audit_events
       where table_name = 'proposed_actions'
         and record_id = '73000000-0000-4000-8000-000000000001'
         and action = 'UPDATE'`,
    );
    expect(proposalAudit.rows[0]).toEqual({
      actor_kind: "system",
      source_channel_event_id: "72000000-0000-4000-8000-000000000001",
    });
    await client.query("rollback");
  });

  it("preserves archival provenance honestly and rejects identity, source, or correction rewrites", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    const workmarkId = await insertTestWorkmark(client);
    const creationAudit = await client.query<{ actor_kind: string }>(
      `select actor_kind from public.audit_events
       where table_name = 'workmarks' and record_id = $1 and action = 'INSERT'`,
      [workmarkId],
    );
    expect(creationAudit.rows[0]?.actor_kind).toBe("unknown");
    await client.query("savepoint immutable_workmark_identity");
    await expect(
      client.query(
        "update public.workmarks set worker_id = '10000000-0000-4000-8000-000000000003' where id = $1",
        [workmarkId],
      ),
    ).rejects.toThrow("workmark relationship identity is immutable");
    await client.query("rollback to savepoint immutable_workmark_identity");
    await client.query(
      "update public.workmarks set archived_at = now() where id = $1",
      [workmarkId],
    );
    const archiveAudit = await client.query<{
      after_archived: string | null;
      before_archived: string | null;
    }>(
      `select changes #>> '{after,archived_at}' as after_archived,
              changes #>> '{before,archived_at}' as before_archived
       from public.audit_events
       where table_name = 'workmarks' and record_id = $1 and action = 'UPDATE'`,
      [workmarkId],
    );
    expect(archiveAudit.rows[0]?.before_archived).toBeNull();
    expect(archiveAudit.rows[0]?.after_archived).not.toBeNull();
    const otherEvent = await client.query<{ id: string }>(
      `insert into public.channel_events(channel, provider_event_id, payload)
       values ('whatsapp', 'synthetic-event-mismatch', '{}') returning id`,
    );
    await client.query("savepoint mismatched_provenance");
    await expect(
      client.query(
        `insert into public.workmarks(
          worker_id, organisation_id, source_channel_event_id,
          source_proposed_action_id, work_started_on, work_ended_on,
          origin, source
        ) values (
          '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000001', $1,
          '73000000-0000-4000-8000-000000000001',
          '2026-09-11', '2026-09-11', 'channel_event', 'test'
        )`,
        [otherEvent.rows[0]?.id],
      ),
    ).rejects.toThrow("must agree");
    await client.query("rollback to savepoint mismatched_provenance");
    await client.query("savepoint unrelated_correction");
    await expect(
      client.query(
        `insert into public.verification_claims(
          worker_id, stance, value, source, supersedes_claim_id
        ) values (
          '10000000-0000-4000-8000-000000000003', 'corrected', '{}',
          'test', '50000000-0000-4000-8000-000000000001'
        )`,
      ),
    ).rejects.toThrow("same subject");
    await client.query("rollback to savepoint unrelated_correction");
    await client.query("rollback");
  });

  it("models preferred communication as text, voice, or call", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await expect(
      client.query(
        "insert into public.people(display_name, preferred_communication_mode) values ('Voice sample', 'voice')",
      ),
    ).resolves.toBeDefined();
    await client.query("savepoint invalid_mode");
    await expect(
      client.query(
        "insert into public.people(display_name, preferred_communication_mode) values ('Invalid mode', 'whatsapp')",
      ),
    ).rejects.toThrow();
    await client.query("rollback to savepoint invalid_mode");
    await client.query("rollback");
  });

  it("exposes only confirmed work through relationship views and denies anonymous reads", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    const workmarkId = await insertTestWorkmark(client);
    const relationship = await client.query<{
      confirmed_workmark_count: number;
    }>(
      "select confirmed_workmark_count from public.worker_organisation_relationships where worker_id = (select worker_id from public.workmarks where id = $1)",
      [workmarkId],
    );
    expect(relationship.rows[0]?.confirmed_workmark_count).toBe(1);
    await client.query("set local role anon");
    await client.query("savepoint workmarks_denied");
    await expect(
      client.query("select * from public.workmarks"),
    ).rejects.toThrow("permission denied");
    await client.query("rollback to savepoint workmarks_denied");
    await client.query("savepoint relationship_view_denied");
    await expect(
      client.query("select * from public.worker_organisation_relationships"),
    ).rejects.toThrow("permission denied");
    await client.query("rollback to savepoint relationship_view_denied");
    await client.query("rollback");
  });

  it("enables deny-by-default RLS on every domain table for API roles", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    const rls = await client.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace
         and relkind = 'r' and relrowsecurity
       order by relname`,
    );
    expect(rls.rows.map(({ relname }) => relname)).toEqual(
      [...domainTables].sort(),
    );

    await client.query("begin");
    await client.query("set local role anon");
    for (const table of domainTables) {
      await client.query(`savepoint anon_${table}`);
      await expect(
        client.query(`select count(*)::text as count from public.${table}`),
      ).rejects.toThrow("permission denied");
      await client.query(`rollback to savepoint anon_${table}`);
    }
    await client.query("rollback");

    for (const role of ["authenticated"] as const) {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      for (const table of domainTables) {
        const result = await client.query<{ count: string }>(
          `select count(*)::text as count from public.${table}`,
        );
        expect(result.rows[0]?.count, `${role} read ${table}`).toBe("0");
      }
      await client.query("savepoint denied_write");
      await expect(
        client.query(
          "insert into public.people(display_name) values ('Denied API write')",
        ),
      ).rejects.toThrow();
      await client.query("rollback to savepoint denied_write");
      await client.query("rollback");
    }
  });

  it("seeds the complete synthetic work-graph slice and excludes unconfirmed history from relationships", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    for (const table of [
      "labour_requests",
      "labour_requirements",
      "assignments",
      "crew_links",
      "availability_signals",
      "channel_events",
      "proposed_actions",
      "exception_cases",
    ] as const) {
      const seeded = await client.query<{ count: string }>(
        `select count(*)::text as count from public.${table}`,
      );
      expect(Number(seeded.rows[0]?.count), table).toBeGreaterThan(0);
    }
    const relationship = await client.query<{
      confirmed_workmark_count: number;
      is_repeat_relationship: boolean;
      markd_arranged_workmark_count: number;
    }>(
      `select confirmed_workmark_count, is_repeat_relationship,
              markd_arranged_workmark_count
       from public.worker_organisation_relationships
       where worker_id = '10000000-0000-4000-8000-000000000001'`,
    );
    expect(relationship.rows[0]).toMatchObject({
      confirmed_workmark_count: 2,
      is_repeat_relationship: true,
      markd_arranged_workmark_count: 1,
    });
    const unconfirmed = await client.query(
      `select 1 from public.worker_organisation_relationships
       where worker_id = '10000000-0000-4000-8000-000000000003'`,
    );
    expect(unconfirmed.rows).toEqual([]);
  });

  it("contains no competing relationship or work-event truth tables", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    const prohibited = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('relationships', 'relationship_events', 'stamps', 'work_events', 'work_records')",
    );
    expect(prohibited.rows).toEqual([]);
    const scoreColumns = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and column_name ~* '(rating|rank|overall_score|trust_score)'`,
    );
    expect(scoreColumns.rows).toEqual([]);
  });

  it("requires a live auth-backed operator account for Work Graph access", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorAdminId, "ops_admin");
    await createOperator(client, operatorUserId, "ops_user");
    await createOperator(client, unprovisionedUserId, "ops_user");
    await client.query("set local role postgres");
    await client.query(
      "delete from public.operator_accounts where user_id = $1",
      [unprovisionedUserId],
    );

    await becomeAuthenticatedOperator(client, operatorUserId);
    const visible = await client.query<{ count: string }>(
      "select count(*)::text as count from public.people",
    );
    expect(Number(visible.rows[0]?.count)).toBeGreaterThan(0);
    await expect(
      client.query(
        "insert into public.people(display_name) values ('Authorised operator sample')",
      ),
    ).resolves.toBeDefined();
    await expect(
      client.query("select * from public.audit_events"),
    ).resolves.toMatchObject({ rows: [] });

    await client.query("set local role postgres");
    await becomeAuthenticatedOperator(client, unprovisionedUserId);
    await expect(
      client.query("select * from public.people"),
    ).resolves.toMatchObject({ rows: [] });
    await client.query("savepoint unprovisioned_write");
    await expect(
      client.query(
        "insert into public.people(display_name) values ('Unprovisioned API write')",
      ),
    ).rejects.toThrow();
    await client.query("rollback to savepoint unprovisioned_write");

    await client.query("set local role postgres");
    await client.query(
      "update public.operator_accounts set archived_at = now() where user_id = $1",
      [operatorUserId],
    );
    await becomeAuthenticatedOperator(client, operatorUserId);
    await expect(
      client.query("select * from public.people"),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      client.query(
        "insert into public.people(display_name) values ('Revoked operator sample')",
      ),
    ).rejects.toThrow();
    await client.query("rollback");
  });

  it("keeps private fields and media inaccessible to anonymous requests", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorAdminId, "ops_admin");

    const privateColumns = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'operator_work_cards'
       order by column_name`,
    );
    expect(privateColumns.rows.map(({ column_name }) => column_name)).toEqual([
      "confirmed_workmark_count",
      "display_name",
      "last_confirmed_worked_on",
      "portrait_object_path",
      "preferred_name",
      "worker_id",
    ]);

    await client.query("set local role anon");
    await client.query("savepoint private_table_denied");
    await expect(
      client.query("select * from public.person_private_details"),
    ).rejects.toThrow();
    await client.query("rollback to savepoint private_table_denied");
    await client.query("savepoint work_card_denied");
    await expect(
      client.query("select * from public.operator_work_cards"),
    ).rejects.toThrow();
    await client.query("rollback to savepoint work_card_denied");
    await expect(
      client.query(
        "select * from storage.objects where bucket_id = 'worker-portraits'",
      ),
    ).resolves.toMatchObject({ rows: [] });

    await client.query("set local role postgres");
    await becomeAuthenticatedOperator(client, operatorAdminId);
    await expect(
      client.query("select * from public.operator_work_cards"),
    ).resolves.toMatchObject({ rows: expect.any(Array) });
    await expect(
      client.query(
        `insert into storage.objects(bucket_id, name)
         values ('worker-portraits', 'workers/10000000-0000-4000-8000-000000000001/portrait.jpg')`,
      ),
    ).resolves.toBeDefined();
    await expect(
      client.query(
        `insert into public.worker_media_assets(worker_id, bucket_id, object_path, media_kind)
         values (
           '10000000-0000-4000-8000-000000000001', 'worker-portraits',
           'workers/10000000-0000-4000-8000-000000000001/portrait.jpg', 'portrait'
         )`,
      ),
    ).resolves.toBeDefined();
    await client.query("savepoint media_worker_mismatch");
    await expect(
      client.query(
        `insert into public.worker_media_assets(worker_id, bucket_id, object_path, media_kind)
         values (
           '10000000-0000-4000-8000-000000000002', 'worker-portraits',
           'workers/10000000-0000-4000-8000-000000000001/mismatch.jpg', 'portrait'
         )`,
      ),
    ).rejects.toThrow();
    await client.query("rollback to savepoint media_worker_mismatch");
    await client.query("set local role anon");
    const hiddenMedia = await client.query<{ count: string }>(
      "select count(*)::text as count from storage.objects where bucket_id = 'worker-portraits'",
    );
    expect(hiddenMedia.rows[0]?.count).toBe("0");
    await client.query("rollback");
  });

  it("audits private-boundary mutations and signed sensitive-media reads without private content", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorAdminId, "ops_admin");
    await becomeAuthenticatedOperator(client, operatorAdminId);

    const asset = await client.query<{ id: string }>(
      `insert into public.worker_media_assets(worker_id, bucket_id, object_path, media_kind)
       values (
         '10000000-0000-4000-8000-000000000001', 'worker-verification-media',
         'workers/10000000-0000-4000-8000-000000000001/id.pdf', 'verification'
       ) returning id`,
    );
    await client.query(
      "insert into public.person_private_details(person_id, notes) values ('10000000-0000-4000-8000-000000000001', 'Never audit this private note') on conflict (person_id) do update set notes = excluded.notes",
    );
    const authorised = await client.query<{
      bucket_id: string;
      object_path: string;
    }>("select * from public.authorize_worker_media_read($1, 300)", [
      asset.rows[0]?.id,
    ]);
    expect(authorised.rows[0]).toEqual({
      bucket_id: "worker-verification-media",
      object_path: "workers/10000000-0000-4000-8000-000000000001/id.pdf",
    });
    await client.query("savepoint signed_media_expiry");
    await expect(
      client.query(
        "select * from public.authorize_worker_media_read($1, 301)",
        [asset.rows[0]?.id],
      ),
    ).rejects.toThrow("signed media expiry");
    await client.query("rollback to savepoint signed_media_expiry");
    await client.query("set local role postgres");
    const audit = await client.query<{
      actor_kind: string;
      operator_account_id: string | null;
      changes: Record<string, unknown>;
    }>(
      `select actor_kind, operator_account_id, changes
       from public.audit_events
       where table_name = 'worker_media_assets' and record_id = $1
       and action = 'UPDATE'
       and changes ->> 'event' = 'signed_media_read'`,
      [asset.rows[0]?.id],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_kind: "operator",
      operator_account_id: operatorAdminId,
    });
    expect(JSON.stringify(audit.rows[0]?.changes)).not.toContain("Never audit");
    await becomeAuthenticatedOperator(client, operatorAdminId);
    await expect(
      client.query(
        `insert into public.workmarks(
          worker_id, organisation_id, work_started_on, work_ended_on, origin, source
        ) values (
          '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000001', '2026-09-14', '2026-09-14',
          'operator_recorded', 'browser direct write'
        )`,
      ),
    ).rejects.toThrow("permission denied");
    await client.query("rollback");
  });
});
