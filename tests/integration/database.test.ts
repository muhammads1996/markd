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

async function becomeApiOperator(
  client: Client,
  userId: string,
): Promise<void> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ]);
  await client.query("set local role postgres");
}

const domainTables = [
  "areas",
  "assignments",
  "audit_events",
  "availability_signals",
  "channel_deliveries",
  "channel_events",
  "channel_media_assets",
  "channel_processing_jobs",
  "crew_links",
  "exception_cases",
  "labour_requests",
  "labour_requirements",
  "languages",
  "operator_accounts",
  "organisation_contacts",
  "organisation_operating_areas",
  "organisation_typical_skills",
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
  "worker_area_preferences",
  "worker_participation_preferences",
  "worker_primary_skills",
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

  it("keeps provider evidence idempotent, private, and recoverable", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");

    const messageEvent = await client.query<{ id: string }>(
      `insert into public.channel_events(
        channel, event_type, provider_event_id, provider_message_id, payload
      ) values (
        'whatsapp', 'message', 'flo-129-inbound-event', 'flo-129-inbound-message', '{}'
      ) returning id`,
    );
    const channelEventId = messageEvent.rows[0]?.id;
    const processingJob = await client.query<{ id: string }>(
      "select id from public.channel_processing_jobs where channel_event_id = $1",
      [channelEventId],
    );
    expect(processingJob.rows).toHaveLength(1);

    await client.query("savepoint duplicate_channel_event");
    await expect(
      client.query(
        `insert into public.channel_events(
          channel, event_type, provider_event_id, provider_message_id, payload
        ) values (
          'whatsapp', 'message', 'flo-129-replay-event', 'flo-129-inbound-message', '{}'
        )`,
      ),
    ).rejects.toThrow();
    await client.query("rollback to savepoint duplicate_channel_event");

    await client.query(
      `insert into public.proposed_actions(
        channel_event_id, action_type, payload, risk_tier, ambiguity,
        entity_resolution, interpretation
      ) values (
        $1, 'labour_request', '{"actionType":"labour_request","fields":{},"entityIds":{}}',
        'operational', 'clear', '{}', '{}'
      )`,
      [channelEventId],
    );
    await client.query("savepoint duplicate_proposed_action");
    await expect(
      client.query(
        `insert into public.proposed_actions(
          channel_event_id, action_type, payload, risk_tier, ambiguity,
          entity_resolution, interpretation
        ) values (
          $1, 'labour_request', '{"actionType":"labour_request","fields":{},"entityIds":{}}',
          'operational', 'clear', '{}', '{}'
        )`,
        [channelEventId],
      ),
    ).rejects.toThrow();
    await client.query("rollback to savepoint duplicate_proposed_action");

    const statusEvent = await client.query<{ id: string }>(
      `insert into public.channel_events(
        channel, event_type, provider_event_id, provider_message_id, payload
      ) values (
        'whatsapp', 'status', 'flo-129-status-event', 'flo-129-status-event', '{}'
      ) returning id`,
    );
    const statusJob = await client.query(
      "select id from public.channel_processing_jobs where channel_event_id = $1",
      [statusEvent.rows[0]?.id],
    );
    expect(statusJob.rows).toHaveLength(0);

    const media = await client.query<{ id: string }>(
      `insert into public.channel_media_assets(
        channel_event_id, provider_media_id, media_type, storage_bucket,
        storage_path, retrieval_state
      ) values (
        $1, 'flo-129-media', 'audio', 'whatsapp-media',
        'channel-events/flo-129/audio.ogg', 'retrieved'
      ) returning id`,
      [channelEventId],
    );
    const mediaId = media.rows[0]?.id;
    await createOperator(client, operatorUserId, "ops_user");
    await becomeAuthenticatedOperator(client, operatorUserId);
    const authorisedMedia = await client.query<{
      bucket_id: string;
      object_path: string;
    }>("select * from public.authorize_channel_media_read($1, 300)", [mediaId]);
    expect(authorisedMedia.rows).toEqual([
      {
        bucket_id: "whatsapp-media",
        object_path: "channel-events/flo-129/audio.ogg",
      },
    ]);
    await client.query("set local role postgres");
    await becomeAuthenticatedOperator(client, unprovisionedUserId);
    const deniedMedia = await client.query(
      "select * from public.authorize_channel_media_read($1, 300)",
      [mediaId],
    );
    expect(deniedMedia.rows).toEqual([]);

    await client.query("set local role postgres");
    const retryDelivery = await client.query<{ id: string }>(
      `insert into public.channel_deliveries(
        channel, recipient_phone_number, message_kind, body, idempotency_key
      ) values (
        'whatsapp', '+27821110000', 'provider_test', 'test message',
        'flo-129-retry-delivery'
      ) returning id`,
    );
    const claimedDeliveries = await client.query<{ id: string }>(
      "select id from public.claim_channel_deliveries(100)",
    );
    expect(claimedDeliveries.rows.map(({ id }) => id)).toContain(
      retryDelivery.rows[0]?.id,
    );
    const retried = await client.query<{ state: string; attempts: number }>(
      "select state::text, attempts from public.complete_channel_delivery($1, false, null, 'synthetic network failure', true)",
      [retryDelivery.rows[0]?.id],
    );
    expect(retried.rows[0]).toEqual({ state: "queued", attempts: 1 });

    const successfulDelivery = await client.query<{ id: string }>(
      `insert into public.channel_deliveries(
        channel, recipient_phone_number, message_kind, body, idempotency_key
      ) values (
        'whatsapp', '+27821110001', 'provider_test', 'test message',
        'flo-129-success-delivery'
      ) returning id`,
    );
    const successfulClaim = await client.query<{ id: string }>(
      "select id from public.claim_channel_deliveries(100)",
    );
    expect(successfulClaim.rows.map(({ id }) => id)).toContain(
      successfulDelivery.rows[0]?.id,
    );
    await client.query(
      "select public.complete_channel_delivery($1, true, 'wamid.flo-129', null, false)",
      [successfulDelivery.rows[0]?.id],
    );
    const delivered = await client.query<{
      state: string;
      provider_message_id: string;
      delivered_at: string | null;
    }>(
      "select state::text, provider_message_id, delivered_at from public.record_channel_delivery_status('wamid.flo-129', 'delivered', now(), null)",
    );
    expect(delivered.rows[0]).toMatchObject({
      state: "delivered",
      provider_message_id: "wamid.flo-129",
    });
    expect(delivered.rows[0]?.delivered_at).not.toBeNull();

    await client.query(
      "update public.channel_processing_jobs set state = 'leased', leased_until = now() - interval '1 minute' where id = $1",
      [processingJob.rows[0]?.id],
    );
    await expect(
      client.query("select public.requeue_expired_channel_processing_jobs()"),
    ).resolves.toBeDefined();
    const recovered = await client.query<{ state: string }>(
      "select state from public.channel_processing_jobs where id = $1",
      [processingJob.rows[0]?.id],
    );
    expect(recovered.rows[0]?.state).toBe("queued");
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

  it("keeps consequential command RPCs behind the API database role", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorUserId, "ops_user");
    await becomeAuthenticatedOperator(client, operatorUserId);

    await expect(
      client.query(
        "select * from public.begin_worker_onboarding($1, $2::jsonb)",
        [
          "91000000-0000-4000-8000-000000000099",
          JSON.stringify({ display_name: "Browser command attempt" }),
        ],
      ),
    ).rejects.toThrow("permission denied");
    await client.query("rollback");
  });

  it("runs draft-first worker onboarding and refuses activation before portrait upload", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorUserId, "ops_user");
    const area = await client.query<{ id: string }>(
      "insert into public.areas(name) values ('Onboarding area') returning id",
    );
    const language = await client.query<{ id: string }>(
      "select id from public.languages where archived_at is null order by code limit 1",
    );
    const skill = await client.query<{ id: string }>(
      "insert into public.skills(name) values ('Onboarding evidence skill') returning id",
    );
    await becomeApiOperator(client, operatorUserId);
    const draft = await client.query<{
      worker_id: string;
      portrait_asset_id: string;
      bucket_id: string;
      object_path: string;
    }>(`select * from public.begin_worker_onboarding($1, $2::jsonb)`, [
      "91000000-0000-4000-8000-000000000001",
      JSON.stringify({
        display_name: "Thandi Ndlovu",
        phone_number: "+27821234567",
        preferred_language_id: language.rows[0]?.id,
        language_ids: [language.rows[0]?.id],
        skill_ids: [skill.rows[0]?.id],
        base_area_id: area.rows[0]?.id,
        preferred_communication_mode: "voice",
      }),
    ]);
    expect(draft.rows[0]).toMatchObject({
      worker_id: "91000000-0000-4000-8000-000000000001",
      bucket_id: "worker-portraits",
    });
    await client.query("savepoint portrait_required");
    await expect(
      client.query(
        "select public.complete_worker_onboarding($1, $2, $3, 'active')",
        [
          draft.rows[0]?.worker_id,
          draft.rows[0]?.portrait_asset_id,
          draft.rows[0]?.object_path,
        ],
      ),
    ).rejects.toThrow("uploaded portrait");
    await client.query("rollback to savepoint portrait_required");
    await client.query(
      "insert into storage.objects(bucket_id, name) values ($1, $2)",
      [draft.rows[0]?.bucket_id, draft.rows[0]?.object_path],
    );
    await expect(
      client.query(
        "select public.complete_worker_onboarding($1, $2, $3, 'active')",
        [
          draft.rows[0]?.worker_id,
          draft.rows[0]?.portrait_asset_id,
          draft.rows[0]?.object_path,
        ],
      ),
    ).resolves.toBeDefined();
    const worker = await client.query<{
      record_status: string;
      source: string;
    }>(
      `select worker.record_status, evidence.source
       from public.worker_profiles as worker
       join public.worker_skill_evidence as evidence on evidence.worker_id = worker.person_id
       where worker.person_id = $1`,
      [draft.rows[0]?.worker_id],
    );
    expect(worker.rows[0]).toEqual({
      record_status: "active",
      source: "operator_onboarding",
    });
    await client.query("rollback");
  });

  it("onboards an organisation with areas and typical skills through its active-operator command", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorUserId, "ops_user");
    const area = await client.query<{ id: string }>(
      "insert into public.areas(name) values ('Organisation area') returning id",
    );
    const skill = await client.query<{ id: string }>(
      "insert into public.skills(name) values ('Organisation typical skill') returning id",
    );
    await becomeApiOperator(client, operatorUserId);
    const organisation = await client.query<{ id: string }>(
      `select public.onboard_organisation(
        'Mahlobo Build (Pty) Ltd', 'Mahlobo Build', 'Anele Dlamini',
        '+27829876543', 'Site manager', array[$1]::uuid[], array[$2]::uuid[], 'inactive'
      ) as id`,
      [area.rows[0]?.id, skill.rows[0]?.id],
    );
    const result = await client.query<{
      record_status: string;
      phone_number: string;
    }>(
      `select organisation.record_status::text, phone.phone_number
       from public.organisations as organisation
       join public.organisation_contacts as contact on contact.organisation_id = organisation.id and contact.is_primary
       join public.person_phone_numbers as phone on phone.person_id = contact.person_id and phone.is_primary
       where organisation.id = $1`,
      [organisation.rows[0]?.id],
    );
    expect(result.rows[0]).toEqual({
      record_status: "inactive",
      phone_number: "+27829876543",
    });
    await expect(
      client.query(
        "select * from public.organisation_operating_areas where organisation_id = $1",
        [organisation.rows[0]?.id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      client.query(
        "select * from public.organisation_typical_skills where organisation_id = $1",
        [organisation.rows[0]?.id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await client.query("rollback");
  });

  it("persists worker area-array preferences and keeps participant profile preferences allowlisted", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorUserId, "ops_user");
    const areas = await client.query<{ id: string }>(
      "insert into public.areas(name, locality) values ('Familiar area', 'Test'), ('Travel area', 'Test') returning id",
    );
    const language = await client.query<{ id: string }>(
      "select id from public.languages where archived_at is null order by code limit 1",
    );
    const skill = await client.query<{ id: string }>(
      "insert into public.skills(name) values ('Area-array skill') returning id",
    );
    const replacementSkill = await client.query<{ id: string }>(
      "insert into public.skills(name) values ('Replacement primary skill') returning id",
    );
    await becomeApiOperator(client, operatorUserId);
    const workerId = "91000000-0000-4000-8000-000000000011";
    const draft = await client.query<{
      bucket_id: string;
      object_path: string;
      portrait_asset_id: string;
    }>("select * from public.begin_worker_onboarding($1, $2::jsonb)", [
      workerId,
      JSON.stringify({
        display_name: "Area Array Worker",
        phone_number: "+27821111111",
        preferred_language_id: language.rows[0]?.id,
        language_ids: [language.rows[0]?.id],
        skill_ids: [skill.rows[0]?.id],
        base_area_id: areas.rows[0]?.id,
        familiar_area_ids: [areas.rows[0]?.id],
        willing_to_travel_area_ids: [areas.rows[1]?.id],
      }),
    ]);
    await client.query("select public.update_worker_record($1, $2::jsonb)", [
      workerId,
      JSON.stringify({
        familiar_area_ids: [areas.rows[1]?.id],
        willing_to_travel_area_ids: [areas.rows[0]?.id, areas.rows[1]?.id],
        read_aloud_enabled: true,
        app_participation: "interested",
        skill_ids: [replacementSkill.rows[0]?.id],
      }),
    ]);
    const preferences = await client.query<{
      area_id: string;
      is_familiar: boolean;
      willing_to_travel: boolean;
    }>(
      "select area_id, is_familiar, willing_to_travel from public.worker_area_preferences where worker_id = $1 and archived_at is null order by area_id",
      [workerId],
    );
    expect(preferences.rows).toHaveLength(2);
    expect(preferences.rows).toEqual(
      expect.arrayContaining([
        {
          area_id: areas.rows[0]?.id,
          is_familiar: false,
          willing_to_travel: true,
        },
        {
          area_id: areas.rows[1]?.id,
          is_familiar: true,
          willing_to_travel: true,
        },
      ]),
    );
    const primarySkills = await client.query<{ skill_id: string }>(
      "select skill_id from public.worker_primary_skills where worker_id = $1 and archived_at is null",
      [workerId],
    );
    expect(primarySkills.rows).toEqual([
      { skill_id: replacementSkill.rows[0]?.id },
    ]);
    const immutableEvidence = await client.query<{ skill_id: string }>(
      "select skill_id from public.worker_skill_evidence where worker_id = $1 order by created_at, id",
      [workerId],
    );
    expect(immutableEvidence.rows).toEqual(
      expect.arrayContaining([
        { skill_id: skill.rows[0]?.id },
        { skill_id: replacementSkill.rows[0]?.id },
      ]),
    );
    await client.query(
      "insert into storage.objects(bucket_id, name) values ($1, $2)",
      [draft.rows[0]?.bucket_id, draft.rows[0]?.object_path],
    );
    await client.query(
      "select public.complete_worker_onboarding($1, $2, $3, 'active')",
      [workerId, draft.rows[0]?.portrait_asset_id, draft.rows[0]?.object_path],
    );
    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'participant_worker_profile_preferences' order by ordinal_position",
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "worker_id",
      "preferred_language_code",
      "preferred_communication_mode",
      "read_aloud_enabled",
      "app_participation",
      "availability_status",
      "available_from",
      "available_to",
      "familiar_area_ids",
      "willing_to_travel_area_ids",
    ]);
    const projection = await client.query<{
      read_aloud_enabled: boolean;
      app_participation: string;
      familiar_area_ids: string[];
      willing_to_travel_area_ids: string[];
    }>(
      "select read_aloud_enabled, app_participation, familiar_area_ids, willing_to_travel_area_ids from public.participant_worker_profile_preferences where worker_id = $1",
      [workerId],
    );
    expect(projection.rows[0]).toMatchObject({
      read_aloud_enabled: true,
      app_participation: "interested",
      familiar_area_ids: [areas.rows[1]?.id],
    });
    expect(projection.rows[0]?.willing_to_travel_area_ids).toEqual(
      expect.arrayContaining([areas.rows[0]?.id, areas.rows[1]?.id]),
    );
    expect(projection.rows[0]?.willing_to_travel_area_ids).toHaveLength(2);
    await client.query("set local role anon");
    await expect(
      client.query(
        "select * from public.participant_worker_profile_preferences",
      ),
    ).rejects.toThrow("permission denied");
    await client.query("rollback");
  });

  it("rejects duplicate onboarding phones before creating a partial worker", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorUserId, "ops_user");
    await becomeApiOperator(client, operatorUserId);
    const duplicateWorkerId = "91000000-0000-4000-8000-000000000012";
    await client.query("savepoint duplicate_phone");
    await expect(
      client.query(
        "select * from public.begin_worker_onboarding($1, $2::jsonb)",
        [
          duplicateWorkerId,
          JSON.stringify({
            display_name: "Duplicate Phone",
            phone_number: "+27820000001",
          }),
        ],
      ),
    ).rejects.toThrow("already linked");
    await client.query("rollback to savepoint duplicate_phone");
    const partial = await client.query(
      "select 1 from public.people where id = $1",
      [duplicateWorkerId],
    );
    expect(partial.rows).toEqual([]);
    await client.query("rollback");
  });

  it("keeps search and participant projections policy-controlled, safe, and provenance-aware", async () => {
    const client = new Client({ connectionString: localDatabaseUrl });
    clients.push(client);
    await client.connect();
    await client.query("begin");
    await createOperator(client, operatorUserId, "ops_user");
    await createOperator(client, unprovisionedUserId, "ops_user");
    await client.query("set local role postgres");
    await client.query(
      "delete from public.operator_accounts where user_id = $1",
      [unprovisionedUserId],
    );

    await becomeAuthenticatedOperator(client, operatorUserId);
    const phoneResults = await client.query<{
      result_kind: string;
      title: string;
      detail: string;
    }>("select * from public.search_work_graph('+27 82 000 0002', 40)");
    expect(phoneResults.rows).toEqual([
      expect.objectContaining({
        result_kind: "contractor",
        title: "Example Build",
      }),
    ]);
    expect(JSON.stringify(phoneResults.rows)).not.toContain("27820000002");

    const skillResults = await client.query<{
      result_kind: string;
      title: string;
    }>(
      "select result_kind, title from public.search_work_graph('General labour', 40)",
    );
    expect(skillResults.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ result_kind: "worker", title: "Anele" }),
        expect.objectContaining({
          result_kind: "contractor",
          title: "Example Build",
        }),
        expect.objectContaining({
          result_kind: "skill",
          title: "General labour",
        }),
      ]),
    );

    const work = await client.query<{
      is_markd_arranged: boolean;
      origin: string;
    }>(
      `select origin, is_markd_arranged
       from public.participant_worker_work
       where worker_id = '10000000-0000-4000-8000-000000000001'
       order by work_started_on`,
    );
    expect(work.rows).toEqual([
      { origin: "operator_recorded", is_markd_arranged: false },
      { origin: "operator_recorded", is_markd_arranged: true },
    ]);

    await client.query("set local role postgres");
    const unsafeColumns = await client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name like 'participant_%'
         and column_name ~* '(phone|notes|birth|object_path|rate|payment|source_reference|exception|dispute)'`,
    );
    expect(unsafeColumns.rows).toEqual([]);

    await becomeAuthenticatedOperator(client, unprovisionedUserId);
    for (const view of [
      "participant_worker_home",
      "participant_worker_profile_preferences",
      "participant_worker_work",
      "participant_worker_card",
      "participant_contractor_labour_book",
      "participant_candidate_summary",
    ]) {
      const hidden = await client.query<{ count: string }>(
        `select count(*)::text as count from public.${view}`,
      );
      expect(hidden.rows[0]?.count).toBe("0");
    }
    await expect(
      client.query("select * from public.search_work_graph('Anele', 40)"),
    ).rejects.toThrow("active operator");
    await client.query("rollback");
  });
});
