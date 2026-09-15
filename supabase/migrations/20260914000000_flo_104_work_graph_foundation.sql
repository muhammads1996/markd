-- FLO-104: canonical, provenance-aware Work Graph foundation.
-- This migration deliberately creates no login-facing access policy. FLO-105 owns
-- operational RLS policies; RLS is enabled here so the default is deny-by-default.

create type public.workmark_origin as enum ('operator_recorded', 'historical_claim', 'channel_event');
create type public.workmark_lifecycle as enum ('draft', 'confirmed', 'corrected', 'voided');
create type public.attendance_outcome as enum ('unknown', 'attended', 'no_show', 'partial');
create type public.completion_outcome as enum ('unknown', 'completed', 'incomplete', 'disputed');
create type public.payment_state as enum ('unknown', 'unpaid', 'paid', 'disputed');
create type public.reuse_preference as enum ('unknown', 'would_reuse', 'would_not_reuse');
create type public.assignment_state as enum ('proposed', 'contacted', 'worker_accepted', 'contractor_confirmed', 'cancelled', 'no_show', 'completed');
create type public.claim_stance as enum ('asserted', 'confirmed', 'disputed', 'corrected', 'withdrawn');
create type public.exception_state as enum ('open', 'investigating', 'resolved', 'dismissed');
create type public.proposed_action_state as enum ('pending', 'approved', 'rejected', 'executed', 'expired');

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = timezone('utc', now()); return new; end;
$$;

create table public.languages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  given_name text,
  family_name text,
  preferred_language_id uuid references public.languages(id),
  preferred_communication_mode text not null default 'call' check (preferred_communication_mode in ('text', 'voice', 'call')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.person_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  phone_number text not null check (phone_number ~ '^\+[1-9][0-9]{1,14}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);
create unique index person_phone_numbers_active_number_key on public.person_phone_numbers(phone_number) where archived_at is null;
create unique index person_phone_numbers_one_active_primary_key on public.person_phone_numbers(person_id) where is_primary and archived_at is null;

create table public.person_languages (
  person_id uuid not null references public.people(id),
  language_id uuid not null references public.languages(id),
  proficiency text not null default 'conversational' check (proficiency in ('basic', 'conversational', 'fluent', 'native')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  primary key (person_id, language_id)
);

create table public.worker_profiles (
  person_id uuid primary key references public.people(id),
  preferred_name text,
  birth_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.organisation_contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  person_id uuid not null references public.people(id),
  role_name text,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  unique (organisation_id, person_id)
);
create unique index organisation_contacts_one_active_primary_key on public.organisation_contacts(organisation_id) where is_primary and archived_at is null;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  name text not null check (length(trim(name)) > 0),
  locality text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.worker_skill_evidence (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_profiles(person_id),
  skill_id uuid not null references public.skills(id),
  source text not null check (length(trim(source)) > 0),
  source_channel_event_id uuid,
  source_proposed_action_id uuid,
  confidence numeric(3,2) check (confidence between 0 and 1),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.labour_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  site_id uuid references public.sites(id),
  requested_by_contact_id uuid references public.organisation_contacts(id),
  needed_from date not null,
  needed_to date not null,
  needed_at time,
  headcount integer not null check (headcount > 0),
  rate_cents integer check (rate_cents >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  terms text,
  source text not null default 'operator' check (length(trim(source)) > 0),
  notes text,
  state text not null default 'open' check (state in ('draft', 'open', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (needed_to >= needed_from)
);

create table public.labour_requirements (
  id uuid primary key default gen_random_uuid(),
  labour_request_id uuid not null references public.labour_requests(id),
  skill_id uuid references public.skills(id),
  headcount integer not null check (headcount > 0),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  labour_request_id uuid not null references public.labour_requests(id),
  worker_id uuid not null references public.worker_profiles(person_id),
  organisation_id uuid not null references public.organisations(id),
  site_id uuid references public.sites(id),
  source_channel_event_id uuid,
  source_proposed_action_id uuid,
  starts_on date not null,
  ends_on date not null,
  state public.assignment_state not null default 'proposed',
  agreed_rate_cents integer check (agreed_rate_cents >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (ends_on >= starts_on)
);

create table public.workmarks (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_profiles(person_id),
  organisation_id uuid not null references public.organisations(id),
  assignment_id uuid references public.assignments(id),
  site_id uuid references public.sites(id),
  organisation_contact_id uuid references public.organisation_contacts(id),
  source_channel_event_id uuid,
  source_proposed_action_id uuid,
  source_verification_claim_id uuid,
  work_started_on date not null,
  work_ended_on date not null,
  origin public.workmark_origin not null,
  lifecycle public.workmark_lifecycle not null default 'draft',
  attendance public.attendance_outcome not null default 'unknown',
  completion public.completion_outcome not null default 'unknown',
  payment public.payment_state not null default 'unknown',
  amount_cents integer check (amount_cents >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  payment_method text,
  worker_reuse_preference public.reuse_preference not null default 'unknown',
  organisation_reuse_preference public.reuse_preference not null default 'unknown',
  source text not null check (length(trim(source)) > 0),
  source_reference text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (work_ended_on >= work_started_on),
  check (origin <> 'channel_event' or source_channel_event_id is not null)
);

create table public.workmark_skills (
  workmark_id uuid not null references public.workmarks(id),
  skill_id uuid not null references public.skills(id),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workmark_id, skill_id)
);

create table public.crew_links (
  id uuid primary key default gen_random_uuid(),
  worker_a_id uuid not null references public.worker_profiles(person_id),
  worker_b_id uuid not null references public.worker_profiles(person_id),
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (worker_a_id < worker_b_id),
  unique (worker_a_id, worker_b_id)
);

create table public.availability_signals (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_profiles(person_id),
  available_from date not null,
  available_to date,
  status text not null check (status in ('available', 'unavailable', 'unknown')),
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (available_to is null or available_to >= available_from)
);

create table public.channel_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (length(trim(channel)) > 0),
  provider_event_id text not null,
  sender_phone_number text check (sender_phone_number ~ '^\+[1-9][0-9]{1,14}$'),
  received_at timestamptz not null default timezone('utc', now()),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (channel, provider_event_id)
);

create table public.proposed_actions (
  id uuid primary key default gen_random_uuid(),
  channel_event_id uuid not null references public.channel_events(id),
  action_type text not null check (length(trim(action_type)) > 0),
  risk_tier smallint not null check (risk_tier between 0 and 3),
  payload jsonb not null default '{}'::jsonb,
  state public.proposed_action_state not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.verification_claims (
  id uuid primary key default gen_random_uuid(),
  workmark_id uuid references public.workmarks(id),
  worker_id uuid references public.worker_profiles(person_id),
  organisation_id uuid references public.organisations(id),
  skill_id uuid references public.skills(id),
  stance public.claim_stance not null,
  value jsonb not null,
  claimant_person_id uuid references public.people(id),
  source text not null check (length(trim(source)) > 0),
  source_channel_event_id uuid references public.channel_events(id),
  source_proposed_action_id uuid references public.proposed_actions(id),
  source_reference text,
  supersedes_claim_id uuid references public.verification_claims(id),
  created_at timestamptz not null default timezone('utc', now()),
  check (num_nonnulls(workmark_id, worker_id, organisation_id, skill_id) = 1)
);
alter table public.workmarks add constraint workmarks_source_channel_event_id_fkey foreign key (source_channel_event_id) references public.channel_events(id);
alter table public.workmarks add constraint workmarks_source_proposed_action_id_fkey foreign key (source_proposed_action_id) references public.proposed_actions(id);
alter table public.assignments add constraint assignments_source_channel_event_id_fkey foreign key (source_channel_event_id) references public.channel_events(id);
alter table public.assignments add constraint assignments_source_proposed_action_id_fkey foreign key (source_proposed_action_id) references public.proposed_actions(id);
alter table public.worker_skill_evidence add constraint worker_skill_evidence_source_channel_event_id_fkey foreign key (source_channel_event_id) references public.channel_events(id);
alter table public.worker_skill_evidence add constraint worker_skill_evidence_source_proposed_action_id_fkey foreign key (source_proposed_action_id) references public.proposed_actions(id);
alter table public.workmarks add constraint workmarks_source_verification_claim_id_fkey foreign key (source_verification_claim_id) references public.verification_claims(id);

create table public.exception_cases (
  id uuid primary key default gen_random_uuid(),
  workmark_id uuid references public.workmarks(id),
  assignment_id uuid references public.assignments(id),
  state public.exception_state not null default 'open',
  category text not null check (length(trim(category)) > 0),
  opened_by_person_id uuid references public.people(id),
  source_channel_event_id uuid references public.channel_events(id),
  source_proposed_action_id uuid references public.proposed_actions(id),
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (num_nonnulls(workmark_id, assignment_id) = 1)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changes jsonb not null,
  source_channel_event_id uuid references public.channel_events(id),
  source_proposed_action_id uuid references public.proposed_actions(id),
  source_verification_claim_id uuid references public.verification_claims(id),
  occurred_at timestamptz not null default timezone('utc', now()),
  actor_id uuid references public.people(id)
  ,actor_kind text not null default 'unknown' check (actor_kind in ('operator', 'system', 'unknown'))
  ,check ((actor_kind = 'operator' and actor_id is not null) or (actor_kind in ('system', 'unknown') and actor_id is null))
);

create function public.prevent_audit_mutation() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'audit_events are append-only and may only be written by the audit trigger';
  end if;
  if tg_op <> 'INSERT' then raise exception 'audit_events are append-only'; end if;
  return new;
end;
$$;
create trigger audit_events_append_only before insert or update or delete on public.audit_events for each row execute function public.prevent_audit_mutation();

create function public.prevent_claim_mutation() returns trigger language plpgsql as $$
begin raise exception 'verification_claims are additive and immutable'; end;
$$;
create trigger verification_claims_immutable before update or delete on public.verification_claims for each row execute function public.prevent_claim_mutation();

create function public.prevent_evidence_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only and immutable', tg_table_name; end;
$$;
create trigger channel_events_immutable before update or delete on public.channel_events for each row execute function public.prevent_evidence_mutation();
create trigger worker_skill_evidence_immutable before update or delete on public.worker_skill_evidence for each row execute function public.prevent_evidence_mutation();
create trigger workmark_skills_immutable before update or delete on public.workmark_skills for each row execute function public.prevent_evidence_mutation();

create function public.prevent_relationship_identity_mutation() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare old_row jsonb := to_jsonb(old); new_row jsonb := to_jsonb(new);
begin
  if tg_table_name = 'assignments' and (new_row ->> 'labour_request_id' is distinct from old_row ->> 'labour_request_id' or new_row ->> 'worker_id' is distinct from old_row ->> 'worker_id' or new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' or new_row ->> 'site_id' is distinct from old_row ->> 'site_id') then raise exception 'assignment relationship identity is immutable'; end if;
  if tg_table_name = 'workmarks' and (new_row ->> 'worker_id' is distinct from old_row ->> 'worker_id' or new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' or new_row ->> 'assignment_id' is distinct from old_row ->> 'assignment_id' or new_row ->> 'site_id' is distinct from old_row ->> 'site_id' or new_row ->> 'organisation_contact_id' is distinct from old_row ->> 'organisation_contact_id' or new_row ->> 'origin' is distinct from old_row ->> 'origin' or new_row ->> 'source_channel_event_id' is distinct from old_row ->> 'source_channel_event_id' or new_row ->> 'source_proposed_action_id' is distinct from old_row ->> 'source_proposed_action_id' or new_row ->> 'source_verification_claim_id' is distinct from old_row ->> 'source_verification_claim_id') then raise exception 'workmark relationship identity is immutable'; end if;
  if tg_table_name = 'sites' and new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' then raise exception 'site organisation is immutable'; end if;
  if tg_table_name = 'organisation_contacts' and new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' then raise exception 'organisation contact organisation is immutable'; end if;
  if tg_table_name = 'labour_requests' and exists (select 1 from public.assignments where labour_request_id = old.id) and (new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' or new_row ->> 'site_id' is distinct from old_row ->> 'site_id' or new_row ->> 'requested_by_contact_id' is distinct from old_row ->> 'requested_by_contact_id') then raise exception 'labour request relationship identity is immutable after assignments exist'; end if;
  return new;
end;
$$;
create trigger assignments_relationship_identity before update on public.assignments for each row execute function public.prevent_relationship_identity_mutation();
create trigger workmarks_relationship_identity before update on public.workmarks for each row execute function public.prevent_relationship_identity_mutation();
create trigger sites_relationship_identity before update on public.sites for each row execute function public.prevent_relationship_identity_mutation();
create trigger organisation_contacts_relationship_identity before update on public.organisation_contacts for each row execute function public.prevent_relationship_identity_mutation();
create trigger labour_requests_relationship_identity before update on public.labour_requests for each row execute function public.prevent_relationship_identity_mutation();

create function public.protect_proposed_action_evidence() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.channel_event_id is distinct from old.channel_event_id or new.action_type is distinct from old.action_type or new.risk_tier is distinct from old.risk_tier or new.payload is distinct from old.payload then
    raise exception 'proposed action evidence is immutable; only state may change';
  end if;
  return new;
end;
$$;
create trigger proposed_actions_evidence_immutable before update on public.proposed_actions for each row execute function public.protect_proposed_action_evidence();
create trigger proposed_actions_delete_immutable before delete on public.proposed_actions for each row execute function public.prevent_evidence_mutation();

create function public.validate_typed_provenance() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare action_event uuid;
begin
  if new.source_proposed_action_id is not null then
    select channel_event_id into action_event from public.proposed_actions where id = new.source_proposed_action_id;
    if new.source_channel_event_id is null or action_event is distinct from new.source_channel_event_id then raise exception 'source proposed action and channel event must agree'; end if;
  end if;
  return new;
end;
$$;
create trigger assignments_typed_provenance before insert or update on public.assignments for each row execute function public.validate_typed_provenance();
create trigger workmarks_typed_provenance before insert or update on public.workmarks for each row execute function public.validate_typed_provenance();
create trigger worker_skill_evidence_typed_provenance before insert on public.worker_skill_evidence for each row execute function public.validate_typed_provenance();
create trigger verification_claims_typed_provenance before insert on public.verification_claims for each row execute function public.validate_typed_provenance();
create trigger exception_cases_typed_provenance before insert or update on public.exception_cases for each row execute function public.validate_typed_provenance();

create function public.validate_claim_supersession() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare previous public.verification_claims;
begin
  if new.supersedes_claim_id is not null then
    select * into previous from public.verification_claims where id = new.supersedes_claim_id;
    if previous.id is null or previous.workmark_id is distinct from new.workmark_id or previous.worker_id is distinct from new.worker_id or previous.organisation_id is distinct from new.organisation_id or previous.skill_id is distinct from new.skill_id then raise exception 'superseded claim must address the same subject'; end if;
  end if;
  return new;
end;
$$;
create trigger verification_claims_supersession before insert on public.verification_claims for each row execute function public.validate_claim_supersession();

create function public.validate_assignment_context() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare request_organisation uuid; request_site uuid; assignment_site_organisation uuid;
begin
  select organisation_id, site_id into request_organisation, request_site from public.labour_requests where id = new.labour_request_id;
  if new.organisation_id <> request_organisation or (request_site is not null and new.site_id is distinct from request_site) then
    raise exception 'assignment organisation and site must match its labour request';
  end if;
  if new.site_id is not null then select organisation_id into assignment_site_organisation from public.sites where id = new.site_id; if assignment_site_organisation is not null and assignment_site_organisation <> new.organisation_id then raise exception 'assignment site must belong to its organisation'; end if; end if;
  return new;
end;
$$;
create trigger assignments_context before insert or update on public.assignments for each row execute function public.validate_assignment_context();

create function public.validate_labour_request_context() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare site_organisation uuid; contact_organisation uuid;
begin
  if new.site_id is not null then select organisation_id into site_organisation from public.sites where id = new.site_id; if site_organisation is not null and site_organisation <> new.organisation_id then raise exception 'labour request site must belong to its organisation'; end if; end if;
  if new.requested_by_contact_id is not null then select organisation_id into contact_organisation from public.organisation_contacts where id = new.requested_by_contact_id; if contact_organisation <> new.organisation_id then raise exception 'labour request contact must belong to its organisation'; end if; end if;
  return new;
end;
$$;
create trigger labour_requests_context before insert or update on public.labour_requests for each row execute function public.validate_labour_request_context();

create function public.validate_workmark_context() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare assignment_worker uuid; assignment_organisation uuid; assignment_site uuid; contact_organisation uuid; site_organisation uuid;
begin
  if new.assignment_id is not null then
    select worker_id, organisation_id, site_id into assignment_worker, assignment_organisation, assignment_site from public.assignments where id = new.assignment_id;
    if new.worker_id <> assignment_worker or new.organisation_id <> assignment_organisation or (assignment_site is not null and new.site_id is distinct from assignment_site) then raise exception 'workmark must match its assignment worker, organisation, and site'; end if;
  end if;
  if new.organisation_contact_id is not null then select organisation_id into contact_organisation from public.organisation_contacts where id = new.organisation_contact_id; if contact_organisation <> new.organisation_id then raise exception 'workmark contact must belong to its organisation'; end if; end if;
  if new.site_id is not null then select organisation_id into site_organisation from public.sites where id = new.site_id; if site_organisation is not null and site_organisation <> new.organisation_id then raise exception 'workmark site must belong to its organisation'; end if; end if;
  return new;
end;
$$;
create trigger workmarks_context before insert or update on public.workmarks for each row execute function public.validate_workmark_context();

create function public.record_trust_audit() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare old_value jsonb; new_value jsonb; source_row jsonb; record_uuid uuid; action_value text; actor uuid; actor_kind_value text;
begin
  actor := case when current_setting('app.actor_person_id', true) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then current_setting('app.actor_person_id', true)::uuid else null end;
  actor_kind_value := case when actor is not null then 'operator' when current_setting('app.actor_kind', true) = 'system' then 'system' else 'unknown' end;
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
    old_value := null; new_value := jsonb_build_object('stance', new.stance, 'workmark_id', new.workmark_id, 'worker_id', new.worker_id, 'organisation_id', new.organisation_id, 'skill_id', new.skill_id, 'source_channel_event_id', new.source_channel_event_id, 'source_proposed_action_id', new.source_proposed_action_id, 'supersedes_claim_id', new.supersedes_claim_id);
  elsif tg_table_name = 'exception_cases' then
    old_value := case when tg_op = 'INSERT' then null else jsonb_build_object('state', old.state, 'category', old.category, 'workmark_id', old.workmark_id, 'assignment_id', old.assignment_id, 'source_channel_event_id', old.source_channel_event_id, 'source_proposed_action_id', old.source_proposed_action_id, 'archived_at', old.archived_at) end;
    new_value := case when tg_op = 'DELETE' then null else jsonb_build_object('state', new.state, 'category', new.category, 'workmark_id', new.workmark_id, 'assignment_id', new.assignment_id, 'source_channel_event_id', new.source_channel_event_id, 'source_proposed_action_id', new.source_proposed_action_id, 'archived_at', new.archived_at) end;
  end if;
  record_uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  action_value := tg_op;
  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_events(table_name, record_id, action, changes, actor_id, actor_kind, source_channel_event_id, source_proposed_action_id, source_verification_claim_id)
  values (tg_table_name, record_uuid, action_value, jsonb_build_object('before', old_value, 'after', new_value), actor, actor_kind_value,
    case when tg_table_name = 'proposed_actions' then nullif(source_row ->> 'channel_event_id', '')::uuid else nullif(source_row ->> 'source_channel_event_id', '')::uuid end,
    nullif(source_row ->> 'source_proposed_action_id', '')::uuid,
    case when tg_table_name = 'verification_claims' then record_uuid else nullif(source_row ->> 'source_verification_claim_id', '')::uuid end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger assignments_audit after insert or update or delete on public.assignments for each row execute function public.record_trust_audit();
create trigger workmarks_audit after insert or update or delete on public.workmarks for each row execute function public.record_trust_audit();
create trigger proposed_actions_audit after insert or update on public.proposed_actions for each row execute function public.record_trust_audit();
create trigger verification_claims_audit after insert on public.verification_claims for each row execute function public.record_trust_audit();
create trigger exception_cases_audit after insert or update or delete on public.exception_cases for each row execute function public.record_trust_audit();

create trigger languages_updated_at before update on public.languages for each row execute function public.set_updated_at();
create trigger people_updated_at before update on public.people for each row execute function public.set_updated_at();
create trigger person_phone_numbers_updated_at before update on public.person_phone_numbers for each row execute function public.set_updated_at();
create trigger person_languages_updated_at before update on public.person_languages for each row execute function public.set_updated_at();
create trigger worker_profiles_updated_at before update on public.worker_profiles for each row execute function public.set_updated_at();
create trigger organisations_updated_at before update on public.organisations for each row execute function public.set_updated_at();
create trigger organisation_contacts_updated_at before update on public.organisation_contacts for each row execute function public.set_updated_at();
create trigger sites_updated_at before update on public.sites for each row execute function public.set_updated_at();
create trigger skills_updated_at before update on public.skills for each row execute function public.set_updated_at();
create trigger labour_requests_updated_at before update on public.labour_requests for each row execute function public.set_updated_at();
create trigger labour_requirements_updated_at before update on public.labour_requirements for each row execute function public.set_updated_at();
create trigger assignments_updated_at before update on public.assignments for each row execute function public.set_updated_at();
create trigger workmarks_updated_at before update on public.workmarks for each row execute function public.set_updated_at();
create trigger crew_links_updated_at before update on public.crew_links for each row execute function public.set_updated_at();
create trigger availability_signals_updated_at before update on public.availability_signals for each row execute function public.set_updated_at();
create trigger proposed_actions_updated_at before update on public.proposed_actions for each row execute function public.set_updated_at();
create trigger exception_cases_updated_at before update on public.exception_cases for each row execute function public.set_updated_at();

create view public.worker_organisation_relationships with (security_invoker = true) as
select w.worker_id, w.organisation_id, count(*)::integer as confirmed_workmark_count,
       count(*) > 1 as is_repeat_relationship,
       count(*) filter (where w.assignment_id is not null)::integer as markd_arranged_workmark_count,
       (array_agg(w.worker_reuse_preference order by w.work_ended_on desc, w.created_at desc))[1] as latest_worker_reuse_preference,
       (array_agg(w.organisation_reuse_preference order by w.work_ended_on desc, w.created_at desc))[1] as latest_organisation_reuse_preference,
       min(w.work_started_on) as first_worked_on, max(w.work_ended_on) as last_worked_on
from public.workmarks w
where w.lifecycle = 'confirmed' and w.archived_at is null
group by w.worker_id, w.organisation_id;

create view public.worker_organisation_skill_summary with (security_invoker = true) as
select w.worker_id, w.organisation_id, ws.skill_id, count(*)::integer as confirmed_workmark_count,
       max(w.work_ended_on) as last_demonstrated_on
from public.workmarks w join public.workmark_skills ws on ws.workmark_id = w.id
where w.lifecycle = 'confirmed' and w.archived_at is null
group by w.worker_id, w.organisation_id, ws.skill_id;

create view public.worker_crew_relationships with (security_invoker = true) as
select worker_a_id, worker_b_id, created_at from public.crew_links where archived_at is null;

alter table public.languages enable row level security;
alter table public.people enable row level security;
alter table public.person_phone_numbers enable row level security;
alter table public.person_languages enable row level security;
alter table public.worker_profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_contacts enable row level security;
alter table public.sites enable row level security;
alter table public.skills enable row level security;
alter table public.worker_skill_evidence enable row level security;
alter table public.labour_requests enable row level security;
alter table public.labour_requirements enable row level security;
alter table public.assignments enable row level security;
alter table public.workmarks enable row level security;
alter table public.workmark_skills enable row level security;
alter table public.crew_links enable row level security;
alter table public.availability_signals enable row level security;
alter table public.channel_events enable row level security;
alter table public.proposed_actions enable row level security;
alter table public.verification_claims enable row level security;
alter table public.exception_cases enable row level security;
alter table public.audit_events enable row level security;
