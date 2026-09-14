-- FLO-105: Auth-backed operator access, private data, and private media.
--
-- Operator status is granted deliberately by an existing ops_admin (or during
-- controlled bootstrap). A successful Supabase Auth sign-in alone is never
-- sufficient to access the Work Graph.

create type public.operator_role as enum ('ops_admin', 'ops_user');

create table public.operator_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  person_id uuid unique references public.people(id),
  role public.operator_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (archived_at is null or archived_at >= created_at)
);

create trigger operator_accounts_updated_at
before update on public.operator_accounts
for each row execute function public.set_updated_at();

-- Existing free-text notes and dates of birth are private operational data.
-- They are removed from the profile records used by the allowlisted Work Card
-- projection below, rather than relying on a UI convention to hide them.
create table public.person_private_details (
  person_id uuid primary key references public.people(id),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

insert into public.person_private_details (person_id, notes)
select id, notes
from public.people
where notes is not null;

alter table public.people drop column notes;

create table public.worker_private_details (
  worker_id uuid primary key references public.worker_profiles(person_id),
  birth_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

insert into public.worker_private_details (worker_id, birth_date)
select person_id, birth_date
from public.worker_profiles
where birth_date is not null;

alter table public.worker_profiles drop column birth_date;

create trigger person_private_details_updated_at
before update on public.person_private_details
for each row execute function public.set_updated_at();

create trigger worker_private_details_updated_at
before update on public.worker_private_details
for each row execute function public.set_updated_at();

create table public.worker_media_assets (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_profiles(person_id),
  bucket_id text not null check (bucket_id in ('worker-portraits', 'worker-verification-media')),
  object_path text not null check (
    object_path ~ '^workers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/].*$'
  ),
  media_kind text not null check (media_kind in ('portrait', 'verification')),
  created_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  unique (bucket_id, object_path),
  check ((bucket_id = 'worker-portraits') = (media_kind = 'portrait')),
  check (lower(split_part(object_path, '/', 2)) = worker_id::text)
);

-- This projection is deliberately internal only. It contains just the fields
-- an operator can scan to identify a worker; no notes, DOB, phone number,
-- verification media, or unresolved exception data is selectable through it.
create view public.operator_work_cards with (security_invoker = true) as
select
  worker.person_id as worker_id,
  person.display_name,
  worker.preferred_name,
  portrait.object_path as portrait_object_path,
  count(distinct workmark.id) filter (
    where workmark.lifecycle = 'confirmed' and workmark.archived_at is null
  )::integer as confirmed_workmark_count,
  max(workmark.work_ended_on) filter (
    where workmark.lifecycle = 'confirmed' and workmark.archived_at is null
  ) as last_confirmed_worked_on
from public.worker_profiles as worker
join public.people as person on person.id = worker.person_id
left join public.worker_media_assets as portrait
  on portrait.worker_id = worker.person_id
  and portrait.bucket_id = 'worker-portraits'
  and portrait.archived_at is null
left join public.workmarks as workmark on workmark.worker_id = worker.person_id
where worker.archived_at is null and person.archived_at is null
group by worker.person_id, person.display_name, worker.preferred_name, portrait.object_path;

-- auth.uid() reads the authenticated request subject rather than mutable
-- user_metadata or stale JWT application claims. These helpers use the live
-- role table and therefore immediately honour revocation/archival.
create function public.current_operator_role()
returns public.operator_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select operator.role
  from public.operator_accounts as operator
  where operator.user_id = auth.uid()
    and operator.archived_at is null
$$;

create function public.is_active_operator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_operator_role() is not null
$$;

create function public.is_ops_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_operator_role() = 'ops_admin'::public.operator_role
$$;

revoke all on function public.current_operator_role() from public;
revoke all on function public.is_active_operator() from public;
revoke all on function public.is_ops_admin() from public;
grant execute on function public.current_operator_role() to authenticated;
grant execute on function public.is_active_operator() to authenticated;
grant execute on function public.is_ops_admin() to authenticated;

-- Audit events retain the linked domain person where known and additionally
-- preserve the immutable auth account that authorised the write.
alter table public.audit_events
  add column operator_account_id uuid references public.operator_accounts(user_id);

alter table public.audit_events
  drop constraint audit_events_check;

alter table public.audit_events
  add constraint audit_events_actor_context_check check (
    (actor_kind = 'operator' and (actor_id is not null or operator_account_id is not null))
    or (actor_kind in ('system', 'unknown') and actor_id is null and operator_account_id is null)
  );

-- A signed-media read is the one non-trigger audit event in this migration.
-- Only the narrowly scoped security-definer authorizer below can set this
-- transaction-local marker; authenticated callers still have neither INSERT
-- privileges nor an INSERT policy on audit_events.
create or replace function public.prevent_audit_mutation() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() < 2
    and current_setting('app.audit_write', true) is distinct from 'authorized' then
    raise exception 'audit_events are append-only and may only be written by the audit trigger';
  end if;
  if tg_op <> 'INSERT' then raise exception 'audit_events are append-only'; end if;
  return new;
end;
$$;

create or replace function public.record_trust_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_value jsonb;
  new_value jsonb;
  source_row jsonb;
  record_uuid uuid;
  action_value text;
  actor uuid;
  operator_user_id uuid;
  actor_kind_value text;
begin
  operator_user_id := auth.uid();

  if operator_user_id is not null and exists (
    select 1 from public.operator_accounts
    where user_id = operator_user_id and archived_at is null
  ) then
    select person_id into actor
    from public.operator_accounts where user_id = operator_user_id;
    actor_kind_value := 'operator';
  else
    -- Trusted backend commands retain the FLO-104 actor-person setting. API
    -- callers cannot use it to bypass RLS because all user-facing policies
    -- require an active auth-backed operator account.
    actor := case
      when current_setting('app.actor_person_id', true)
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then current_setting('app.actor_person_id', true)::uuid
      else null
    end;
    actor_kind_value := case
      when actor is not null then 'operator'
      when current_setting('app.actor_kind', true) = 'system' then 'system'
      else 'unknown'
    end;
  end if;

  if tg_table_name = 'workmarks' then
    old_value := case when tg_op = 'INSERT' then null else jsonb_build_object('worker_id', old.worker_id, 'organisation_id', old.organisation_id, 'assignment_id', old.assignment_id, 'site_id', old.site_id, 'organisation_contact_id', old.organisation_contact_id, 'origin', old.origin, 'source_channel_event_id', old.source_channel_event_id, 'source_proposed_action_id', old.source_proposed_action_id, 'source_verification_claim_id', old.source_verification_claim_id, 'lifecycle', old.lifecycle, 'attendance', old.attendance, 'completion', old.completion, 'payment', old.payment, 'worker_reuse_preference', old.worker_reuse_preference, 'organisation_reuse_preference', old.organisation_reuse_preference, 'work_started_on', old.work_started_on, 'work_ended_on', old.work_ended_on, 'amount_cents', old.amount_cents, 'currency', old.currency, 'payment_method', old.payment_method, 'archived_at', old.archived_at) end;
    new_value := case when tg_op = 'DELETE' then null else jsonb_build_object('worker_id', new.worker_id, 'organisation_id', new.organisation_id, 'assignment_id', new.assignment_id, 'site_id', new.site_id, 'organisation_contact_id', new.organisation_contact_id, 'origin', new.origin, 'source_channel_event_id', new.source_channel_event_id, 'source_proposed_action_id', new.source_proposed_action_id, 'source_verification_claim_id', new.source_verification_claim_id, 'lifecycle', new.lifecycle, 'attendance', new.attendance, 'completion', new.completion, 'payment', new.payment, 'worker_reuse_preference', new.worker_reuse_preference, 'organisation_reuse_preference', new.organisation_reuse_preference, 'work_started_on', new.work_started_on, 'work_ended_on', new.work_ended_on, 'amount_cents', new.amount_cents, 'currency', new.currency, 'payment_method', new.payment_method, 'archived_at', new.archived_at) end;
  elsif tg_table_name = 'assignments' then
    old_value := case when tg_op = 'INSERT' then null else jsonb_build_object('labour_request_id', old.labour_request_id, 'worker_id', old.worker_id, 'organisation_id', old.organisation_id, 'site_id', old.site_id, 'source_channel_event_id', old.source_channel_event_id, 'source_proposed_action_id', old.source_proposed_action_id, 'state', old.state, 'starts_on', old.starts_on, 'ends_on', old.ends_on, 'agreed_rate_cents', old.agreed_rate_cents, 'currency', old.currency, 'archived_at', old.archived_at) end;
    new_value := case when tg_op = 'DELETE' then null else jsonb_build_object('labour_request_id', new.labour_request_id, 'worker_id', new.worker_id, 'organisation_id', new.organisation_id, 'site_id', new.site_id, 'source_channel_event_id', new.source_channel_event_id, 'source_proposed_action_id', new.source_proposed_action_id, 'state', new.state, 'starts_on', new.starts_on, 'ends_on', new.ends_on, 'agreed_rate_cents', new.agreed_rate_cents, 'currency', new.currency, 'archived_at', new.archived_at) end;
  elsif tg_table_name = 'proposed_actions' then
    old_value := case when tg_op = 'INSERT' then null else jsonb_build_object('channel_event_id', old.channel_event_id, 'action_type', old.action_type, 'risk_tier', old.risk_tier, 'state', old.state, 'archived_at', old.archived_at) end;
    new_value := case when tg_op = 'DELETE' then null else jsonb_build_object('channel_event_id', new.channel_event_id, 'action_type', new.action_type, 'risk_tier', new.risk_tier, 'state', new.state, 'archived_at', new.archived_at) end;
  elsif tg_table_name = 'verification_claims' then
    old_value := null;
    new_value := jsonb_build_object('stance', new.stance, 'workmark_id', new.workmark_id, 'worker_id', new.worker_id, 'organisation_id', new.organisation_id, 'skill_id', new.skill_id, 'source_channel_event_id', new.source_channel_event_id, 'source_proposed_action_id', new.source_proposed_action_id, 'supersedes_claim_id', new.supersedes_claim_id);
  elsif tg_table_name = 'exception_cases' then
    old_value := case when tg_op = 'INSERT' then null else jsonb_build_object('state', old.state, 'category', old.category, 'workmark_id', old.workmark_id, 'assignment_id', old.assignment_id, 'source_channel_event_id', old.source_channel_event_id, 'source_proposed_action_id', old.source_proposed_action_id, 'archived_at', old.archived_at) end;
    new_value := case when tg_op = 'DELETE' then null else jsonb_build_object('state', new.state, 'category', new.category, 'workmark_id', new.workmark_id, 'assignment_id', new.assignment_id, 'source_channel_event_id', new.source_channel_event_id, 'source_proposed_action_id', new.source_proposed_action_id, 'archived_at', new.archived_at) end;
  end if;

  record_uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  action_value := tg_op;
  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  insert into public.audit_events(
    table_name, record_id, action, changes, actor_id, operator_account_id,
    actor_kind, source_channel_event_id, source_proposed_action_id,
    source_verification_claim_id
  ) values (
    tg_table_name, record_uuid, action_value,
    jsonb_build_object('before', old_value, 'after', new_value),
    actor, case when actor_kind_value = 'operator' then operator_user_id else null end,
    actor_kind_value,
    case when tg_table_name = 'proposed_actions' then nullif(source_row ->> 'channel_event_id', '')::uuid else nullif(source_row ->> 'source_channel_event_id', '')::uuid end,
    nullif(source_row ->> 'source_proposed_action_id', '')::uuid,
    case when tg_table_name = 'verification_claims' then record_uuid else nullif(source_row ->> 'source_verification_claim_id', '')::uuid end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.record_trust_audit() from public;

-- Explicit table grants keep the Data API surface intentional. RLS remains the
-- row-level enforcement layer and no operator role receives DELETE access.
alter table public.operator_accounts enable row level security;
alter table public.person_private_details enable row level security;
alter table public.worker_private_details enable row level security;
alter table public.worker_media_assets enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'people', 'person_phone_numbers', 'person_languages', 'worker_profiles',
    'person_private_details', 'worker_private_details', 'worker_media_assets',
    'organisations', 'organisation_contacts', 'sites',
    'labour_requests', 'labour_requirements', 'crew_links',
    'availability_signals'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on table public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_active_operator()))', table_name || '_operator_read', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_active_operator()))', table_name || '_operator_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_active_operator())) with check ((select public.is_active_operator()))', table_name || '_operator_update', table_name);
  end loop;

  -- Trust-relevant evidence is deliberately not writable through the generic
  -- Data API. The upcoming explicit domain commands own those transitions;
  -- this prevents a browser client from bypassing validation and provenance
  -- policy while keeping the underlying evidence readable to operators.
  foreach table_name in array array[
    'worker_skill_evidence', 'assignments', 'workmarks', 'workmark_skills',
    'verification_claims', 'exception_cases'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_active_operator()))', table_name || '_operator_read', table_name);
  end loop;

  foreach table_name in array array['languages', 'skills'] loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on table public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_active_operator()))', table_name || '_operator_read', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_ops_admin()))', table_name || '_admin_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_ops_admin())) with check ((select public.is_ops_admin()))', table_name || '_admin_update', table_name);
  end loop;

  foreach table_name in array array['channel_events', 'proposed_actions'] loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_active_operator()))', table_name || '_operator_read', table_name);
  end loop;
end
$$;

revoke all on table public.audit_events from anon, authenticated;
grant select on table public.audit_events to authenticated;
create policy audit_events_admin_read on public.audit_events
for select to authenticated using ((select public.is_ops_admin()));

revoke all on table public.operator_accounts from anon, authenticated;
grant select, insert, update on table public.operator_accounts to authenticated;
create policy operator_accounts_read on public.operator_accounts
for select to authenticated
using (user_id = auth.uid() or (select public.is_ops_admin()));
create policy operator_accounts_admin_insert on public.operator_accounts
for insert to authenticated with check ((select public.is_ops_admin()));
create policy operator_accounts_admin_update on public.operator_accounts
for update to authenticated
using ((select public.is_ops_admin()))
with check ((select public.is_ops_admin()));

revoke all on table public.operator_work_cards from anon, authenticated;
grant select on table public.operator_work_cards to authenticated;

revoke all on table public.worker_organisation_relationships, public.worker_organisation_skill_summary, public.worker_crew_relationships from anon, authenticated;
grant select on table public.worker_organisation_relationships, public.worker_organisation_skill_summary, public.worker_crew_relationships to authenticated;

-- The object store is private at both bucket and object-policy levels. Paths
-- use a worker UUID prefix so operator tooling can keep the association clear.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('worker-portraits', 'worker-portraits', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('worker-verification-media', 'worker-verification-media', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

revoke all on table storage.objects from anon, authenticated;
grant select, insert, update on table storage.objects to authenticated;

create policy worker_media_operator_read on storage.objects
for select to authenticated
using (
  bucket_id in ('worker-portraits', 'worker-verification-media')
  and (select public.is_active_operator())
);
create policy worker_media_operator_insert on storage.objects
for insert to authenticated
with check (
  bucket_id in ('worker-portraits', 'worker-verification-media')
  and name ~ '^workers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/].*$'
  and exists (
    select 1 from public.worker_profiles as worker
    where worker.person_id::text = lower(split_part(name, '/', 2))
      and worker.archived_at is null
  )
  and (select public.is_active_operator())
);
create policy worker_media_operator_update on storage.objects
for update to authenticated
using (
  bucket_id in ('worker-portraits', 'worker-verification-media')
  and (select public.is_active_operator())
)
with check (
  bucket_id in ('worker-portraits', 'worker-verification-media')
  and name ~ '^workers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/].*$'
  and exists (
    select 1 from public.worker_profiles as worker
    where worker.person_id::text = lower(split_part(name, '/', 2))
      and worker.archived_at is null
  )
  and (select public.is_active_operator())
);

-- Boundary mutations and sensitive-media access are auditable without
-- copying the private notes, dates of birth, or object contents themselves.
create function public.record_operator_boundary_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  acting_user_id uuid := auth.uid();
  record_uuid uuid;
  audit_actor_kind text;
  audit_operator_account_id uuid;
  safe_changes jsonb;
begin
  if acting_user_id is not null and exists (
    select 1 from public.operator_accounts
    where user_id = acting_user_id and archived_at is null
  ) then
    audit_actor_kind := 'operator';
    audit_operator_account_id := acting_user_id;
  elsif current_setting('app.actor_kind', true) = 'system' then
    audit_actor_kind := 'system';
    audit_operator_account_id := null;
  else
    -- Bootstrap/database work has no HTTP subject. Browser writes cannot use
    -- this branch because their RLS policies already require an active role.
    audit_actor_kind := 'unknown';
    audit_operator_account_id := null;
  end if;

  if tg_table_name = 'operator_accounts' then
    record_uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    safe_changes := jsonb_build_object(
      'role', case when tg_op = 'DELETE' then old.role else new.role end,
      'archived_at', case when tg_op = 'DELETE' then old.archived_at else new.archived_at end
    );
  elsif tg_table_name = 'worker_media_assets' then
    record_uuid := case when tg_op = 'DELETE' then old.id else new.id end;
    safe_changes := jsonb_build_object(
      'worker_id', case when tg_op = 'DELETE' then old.worker_id else new.worker_id end,
      'bucket_id', case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end,
      'object_path', case when tg_op = 'DELETE' then old.object_path else new.object_path end,
      'media_kind', case when tg_op = 'DELETE' then old.media_kind else new.media_kind end,
      'archived_at', case when tg_op = 'DELETE' then old.archived_at else new.archived_at end
    );
  else
    record_uuid := case when tg_op = 'DELETE' then old.person_id else new.person_id end;
    safe_changes := jsonb_build_object(
      'subject_id', case when tg_op = 'DELETE' then old.person_id else new.person_id end,
      'archived_at', case when tg_op = 'DELETE' then old.archived_at else new.archived_at end
    );
  end if;

  insert into public.audit_events(
    table_name, record_id, action, changes, operator_account_id, actor_kind
  ) values (
    tg_table_name, record_uuid, tg_op, safe_changes, audit_operator_account_id, audit_actor_kind
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger operator_accounts_audit
after insert or update on public.operator_accounts
for each row execute function public.record_operator_boundary_audit();
create trigger person_private_details_audit
after insert or update on public.person_private_details
for each row execute function public.record_operator_boundary_audit();
create trigger worker_private_details_audit
after insert or update on public.worker_private_details
for each row execute function public.record_operator_boundary_audit();
create trigger worker_media_assets_audit
after insert or update on public.worker_media_assets
for each row execute function public.record_operator_boundary_audit();

create function public.authorize_worker_media_read(
  requested_asset_id uuid,
  requested_expires_in integer
)
returns table(bucket_id text, object_path text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  acting_user_id uuid := auth.uid();
begin
  if requested_expires_in < 1 or requested_expires_in > 300 then
    raise exception 'signed media expiry must be between 1 and 300 seconds';
  end if;
  if acting_user_id is null or not public.is_active_operator() then
    raise exception 'an active operator is required to read sensitive media';
  end if;
  perform set_config('app.audit_write', 'authorized', true);
  insert into public.audit_events(
    table_name, record_id, action, changes, operator_account_id, actor_kind
  ) values (
    'worker_media_assets', requested_asset_id, 'UPDATE',
    jsonb_build_object('event', 'signed_media_read', 'signed_url_expires_in_seconds', requested_expires_in),
    acting_user_id, 'operator'
  );
  return query
    select asset.bucket_id, asset.object_path
    from public.worker_media_assets as asset
    where asset.id = requested_asset_id and asset.archived_at is null;
  if not found then
    raise exception 'media asset is unavailable';
  end if;
end;
$$;

revoke all on function public.record_operator_boundary_audit() from public;
revoke all on function public.authorize_worker_media_read(uuid, integer) from public;
grant execute on function public.authorize_worker_media_read(uuid, integer) to authenticated;
