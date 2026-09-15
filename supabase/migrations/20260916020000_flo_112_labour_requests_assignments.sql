-- FLO-112: canonical Labour Request and Assignment command state.
-- Legacy assignment state is decomposed so acceptance and contractor
-- confirmation remain independently auditable facts.

alter table public.labour_requests
  alter column organisation_id drop not null,
  add column requester_person_id uuid references public.people(id),
  add column source_channel_event_id uuid references public.channel_events(id),
  add column source_proposed_action_id uuid references public.proposed_actions(id),
  add column site_area text not null default 'Unspecified' check (length(trim(site_area)) > 0),
  add column site_text text,
  add column timezone text not null default 'Africa/Johannesburg' check (length(trim(timezone)) > 0),
  add column rate_basis text not null default 'daily' check (rate_basis in ('daily', 'hourly', 'fixed', 'other')),
  add column lifecycle text not null default 'active' check (lifecycle in ('active', 'cancelled')),
  add column cancellation_reason text,
  add column cancelled_at timestamptz,
  add column version integer not null default 1 check (version > 0),
  add constraint labour_requests_one_requester_check
    check (num_nonnulls(organisation_id, requester_person_id) = 1),
  add constraint labour_requests_contact_requires_organisation_check
    check (requested_by_contact_id is null or organisation_id is not null);

update public.labour_requests
set lifecycle = case when state = 'cancelled' then 'cancelled' else 'active' end;

alter table public.labour_requests drop column state;

alter table public.labour_requirements
  add column work_type text,
  add column version integer not null default 1 check (version > 0);

update public.labour_requirements as requirement
set work_type = coalesce(skill.name, 'General labour')
from public.skills as skill
where skill.id = requirement.skill_id;

update public.labour_requirements
set work_type = 'General labour'
where work_type is null;

alter table public.labour_requirements
  alter column work_type set not null;

alter table public.assignments
  alter column organisation_id drop not null,
  add column labour_requirement_id uuid references public.labour_requirements(id),
  add column hirer_person_id uuid references public.people(id),
  add column lifecycle text not null default 'active'
    check (lifecycle in ('active', 'completed', 'cancelled', 'no_show')),
  add column worker_response text not null default 'pending'
    check (worker_response in ('pending', 'call_me', 'accepted', 'declined')),
  add column contractor_confirmation text not null default 'pending'
    check (contractor_confirmation in ('pending', 'confirmed', 'rejected')),
  add column offered_at timestamptz,
  add column worker_responded_at timestamptz,
  add column contractor_confirmed_at timestamptz,
  add column travel_authorised_at timestamptz,
  add column travel_revoked_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancellation_reason text,
  add column cancellation_note text,
  add column cancelled_after_travel_authorised boolean not null default false,
  add column source text not null default 'api' check (length(trim(source)) > 0),
  add column version integer not null default 1 check (version > 0),
  add constraint assignments_one_hirer_check
    check (num_nonnulls(organisation_id, hirer_person_id) = 1);

alter table public.audit_events
  drop constraint audit_events_actor_kind_check,
  drop constraint audit_events_actor_context_check;

alter table public.audit_events
  add constraint audit_events_actor_kind_check
    check (actor_kind in ('operator', 'participant', 'system', 'unknown')),
  add constraint audit_events_actor_context_check check (
    (actor_kind in ('operator', 'participant') and actor_id is not null)
    or (actor_kind = 'operator' and operator_account_id is not null)
    or (actor_kind in ('system', 'unknown') and actor_id is null
        and operator_account_id is null)
  );

update public.assignments
set lifecycle = case
      when state = 'completed' then 'completed'
      when state = 'no_show' then 'no_show'
      when state = 'cancelled' then 'cancelled'
      else 'active'
    end,
    worker_response = case
      when state in ('worker_accepted', 'contractor_confirmed') then 'accepted'
      else 'pending'
    end,
    contractor_confirmation = case
      when state = 'contractor_confirmed' then 'confirmed'
      else 'pending'
    end,
    offered_at = case
      when state in ('contacted', 'worker_accepted', 'contractor_confirmed') then created_at
      else null
    end;

alter table public.assignments drop column state;
drop type public.assignment_state;

create unique index assignments_active_requirement_worker_key
  on public.assignments(labour_request_id, labour_requirement_id, worker_id)
  where lifecycle = 'active' and labour_requirement_id is not null;

create or replace function public.validate_assignment_context()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  request_organisation uuid;
  request_hirer uuid;
  request_site uuid;
  assignment_site_organisation uuid;
begin
  select organisation_id, requester_person_id, site_id
  into request_organisation, request_hirer, request_site
  from public.labour_requests
  where id = new.labour_request_id;

  if new.organisation_id is distinct from request_organisation
    or new.hirer_person_id is distinct from request_hirer
    or (request_site is not null and new.site_id is distinct from request_site) then
    raise exception 'assignment hirer and site must match its labour request';
  end if;
  if new.site_id is not null then
    select organisation_id into assignment_site_organisation
    from public.sites where id = new.site_id;
    if assignment_site_organisation is not null
      and assignment_site_organisation is distinct from new.organisation_id then
      raise exception 'assignment site must belong to its organisation';
    end if;
  end if;
  if new.labour_requirement_id is not null and not exists (
    select 1 from public.labour_requirements
    where id = new.labour_requirement_id and labour_request_id = new.labour_request_id
  ) then
    raise exception 'assignment requirement must belong to its labour request';
  end if;
  return new;
end;
$$;

create or replace function public.validate_labour_request_context()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  site_organisation uuid;
  contact_organisation uuid;
begin
  if new.site_id is not null then
    select organisation_id into site_organisation from public.sites where id = new.site_id;
    if new.organisation_id is null or site_organisation is distinct from new.organisation_id then
      raise exception 'labour request site must belong to its organisation';
    end if;
  end if;
  if new.requested_by_contact_id is not null then
    select organisation_id into contact_organisation
    from public.organisation_contacts where id = new.requested_by_contact_id;
    if contact_organisation is distinct from new.organisation_id then
      raise exception 'labour request contact must belong to its organisation';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_relationship_identity_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_table_name = 'assignments' and (
    new_row ->> 'labour_request_id' is distinct from old_row ->> 'labour_request_id'
    or new_row ->> 'labour_requirement_id' is distinct from old_row ->> 'labour_requirement_id'
    or new_row ->> 'worker_id' is distinct from old_row ->> 'worker_id'
    or new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id'
    or new_row ->> 'hirer_person_id' is distinct from old_row ->> 'hirer_person_id'
    or new_row ->> 'site_id' is distinct from old_row ->> 'site_id'
  ) then
    raise exception 'assignment relationship identity is immutable';
  end if;
  if tg_table_name = 'workmarks' and (
    new_row ->> 'worker_id' is distinct from old_row ->> 'worker_id'
    or new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id'
    or new_row ->> 'assignment_id' is distinct from old_row ->> 'assignment_id'
    or new_row ->> 'site_id' is distinct from old_row ->> 'site_id'
    or new_row ->> 'organisation_contact_id' is distinct from old_row ->> 'organisation_contact_id'
    or new_row ->> 'origin' is distinct from old_row ->> 'origin'
    or new_row ->> 'source_channel_event_id' is distinct from old_row ->> 'source_channel_event_id'
    or new_row ->> 'source_proposed_action_id' is distinct from old_row ->> 'source_proposed_action_id'
    or new_row ->> 'source_verification_claim_id' is distinct from old_row ->> 'source_verification_claim_id'
  ) then
    raise exception 'workmark relationship identity is immutable';
  end if;
  if tg_table_name = 'sites' and new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' then
    raise exception 'site organisation is immutable';
  end if;
  if tg_table_name = 'organisation_contacts' and new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id' then
    raise exception 'organisation contact organisation is immutable';
  end if;
  if tg_table_name = 'labour_requests'
    and exists (select 1 from public.assignments where labour_request_id = old.id)
    and (
      new_row ->> 'organisation_id' is distinct from old_row ->> 'organisation_id'
      or new_row ->> 'requester_person_id' is distinct from old_row ->> 'requester_person_id'
      or new_row ->> 'site_id' is distinct from old_row ->> 'site_id'
      or new_row ->> 'requested_by_contact_id' is distinct from old_row ->> 'requested_by_contact_id'
    ) then
    raise exception 'labour request relationship identity is immutable after assignments exist';
  end if;
  return new;
end;
$$;

create function public.record_labour_flow_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_person_id uuid;
  actor_account_id uuid;
  actor_kind_value text;
  source_row jsonb;
begin
  actor_account_id := auth.uid();
  if actor_account_id is not null and exists (
    select 1 from public.operator_accounts
    where user_id = actor_account_id and archived_at is null
  ) then
    select person_id into actor_person_id
    from public.operator_accounts
    where user_id = actor_account_id;
    actor_kind_value := 'operator';
  elsif actor_account_id is not null and exists (
    select 1 from public.participant_accounts
    where auth_user_id = actor_account_id and status = 'active'
  ) then
    select person_id into actor_person_id
    from public.participant_accounts
    where auth_user_id = actor_account_id and status = 'active';
    actor_account_id := null;
    actor_kind_value := 'participant';
  else
    actor_account_id := null;
    actor_kind_value := case
      when current_setting('app.actor_kind', true) = 'system' then 'system'
      else 'unknown'
    end;
  end if;

  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_events(
    table_name, record_id, action, changes, actor_id, operator_account_id,
    actor_kind, source_channel_event_id, source_proposed_action_id
  )
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    jsonb_build_object(
      'before', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      'after', case when tg_op = 'DELETE' then null else to_jsonb(new) end
    ),
    actor_person_id,
    actor_account_id,
    actor_kind_value,
    coalesce(
      nullif(current_setting('app.source_channel_event_id', true), '')::uuid,
      nullif(source_row ->> 'source_channel_event_id', '')::uuid
    ),
    coalesce(
      nullif(current_setting('app.source_proposed_action_id', true), '')::uuid,
      nullif(source_row ->> 'source_proposed_action_id', '')::uuid
    )
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger assignments_audit on public.assignments;
create trigger assignments_audit
after insert or update or delete on public.assignments
for each row execute function public.record_labour_flow_audit();

create trigger labour_requests_audit
after insert or update or delete on public.labour_requests
for each row execute function public.record_labour_flow_audit();

create trigger labour_requests_typed_provenance
before insert or update on public.labour_requests
for each row execute function public.validate_typed_provenance();

revoke insert, update, delete on public.labour_requests,
  public.labour_requirements, public.assignments from anon, authenticated;