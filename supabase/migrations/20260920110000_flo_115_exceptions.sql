-- FLO-115: bilateral, provenance-aware assignment exceptions.
-- Exception cases extend the FLO-104 table; claims are append-only evidence and
-- never become a Workmark or a replacement for one.

alter table public.exception_cases add column flo115_legacy_state text;
update public.exception_cases set flo115_legacy_state = state::text;

alter type public.exception_state rename to exception_state_legacy;
create type public.exception_state as enum ('open', 'under_review', 'resolved');

alter table public.exception_cases
  alter column state drop default,
  alter column state type public.exception_state using (
    case flo115_legacy_state when 'investigating' then 'under_review'
      when 'dismissed' then 'resolved'
      when 'resolved' then 'resolved'
      else state::text end
  )::public.exception_state,
  alter column state set default 'open';
drop type public.exception_state_legacy;

alter table public.exception_cases
  drop constraint if exists exception_cases_check,
  drop constraint if exists exception_cases_category_check,
  add column summary text,
  add column recorded_by_user_id uuid references auth.users(id),
  add column opened_at timestamptz default timezone('utc', now()),
  add column recorded_at timestamptz default timezone('utc', now()),
  add column version integer not null default 1 check (version > 0),
  add column interpretation jsonb,
  add column resolution_outcome text,
  add column resolution_reason text,
  add column resolution_actor_kind text,
  add column resolved_by_user_id uuid references auth.users(id),
  add column resolved_at timestamptz,
  add column resolution_evidence jsonb,
  add column workmark_correction_id uuid references public.workmark_corrections(id);

-- A legacy case could point at a historical Workmark that was not arranged by
-- MARKD and therefore has no Assignment. Keep that evidence intact in an
-- explicit migration archive before the canonical table becomes assignment-
-- scoped. The archive is not a second source of truth for active cases.
create table public.exception_case_migration_archive (
  original_exception_case_id uuid primary key,
  reason text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  archived_at timestamptz not null default timezone('utc', now())
);

update public.exception_cases case_row
set assignment_id = workmark.assignment_id
from public.workmarks workmark
where case_row.assignment_id is null
  and case_row.workmark_id = workmark.id
  and workmark.assignment_id is not null;

insert into public.exception_case_migration_archive(
  original_exception_case_id, reason, snapshot
)
select id, 'legacy_workmark_without_assignment', to_jsonb(exception_case)
from public.exception_cases exception_case
where assignment_id is null;

delete from public.exception_cases
where assignment_id is null;

alter table public.exception_cases alter column assignment_id set not null;

update public.exception_cases exception_case
set category = case lower(trim(exception_case.category))
      when 'unpaid' then 'payment_dispute'
      when 'payment' then 'payment_dispute'
      when 'disputed' then 'completion_dispute'
      when 'no_show' then 'no_show_concern'
      when 'contractor_cancelled' then case
        when assignment_row.cancelled_after_travel_authorised
          or assignment_row.travel_authorised_at is not null
          or assignment_row.travel_revoked_at is not null
        then 'cancelled_after_travel_authorisation'
        else 'cancelled_after_commitment'
      end
      when 'completion_dispute' then 'completion_dispute'
      when 'verification_concern' then 'verification_trust_concern'
      when 'other' then 'verification_trust_concern'
      when 'payment_dispute' then 'payment_dispute'
      when 'attendance_dispute' then 'attendance_dispute'
      when 'no_show_concern' then 'no_show_concern'
      when 'cancelled_after_commitment' then case
        when assignment_row.cancelled_after_travel_authorised
          or assignment_row.travel_authorised_at is not null
          or assignment_row.travel_revoked_at is not null
        then 'cancelled_after_travel_authorisation'
        else 'cancelled_after_commitment'
      end
      when 'cancelled_after_travel_authorisation' then 'cancelled_after_travel_authorisation'
      when 'ambiguous_completion' then 'ambiguous_completion'
      when 'verification_trust_concern' then 'verification_trust_concern'
      else 'verification_trust_concern' end,
    summary = coalesce(nullif(trim(exception_case.summary), ''), exception_case.category),
    opened_at = coalesce(exception_case.opened_at, exception_case.created_at),
    recorded_at = coalesce(exception_case.recorded_at, exception_case.created_at)
from public.assignments assignment_row
where assignment_row.id = exception_case.assignment_id;

do $$
begin
  if exists (
    select 1
    from public.exception_cases exception_case
    join public.assignments assignment on assignment.id = exception_case.assignment_id
    where exception_case.category = 'cancelled_after_commitment'
      and (
        assignment.cancelled_after_travel_authorised
        or assignment.travel_authorised_at is not null
        or assignment.travel_revoked_at is not null
      )
  ) then
    raise exception 'legacy cancellation migration lost travel authorisation distinction';
  end if;
end;
$$;

update public.exception_cases
set resolution_outcome = case flo115_legacy_state
      when 'dismissed' then 'legacy_dismissed'
      else 'legacy_resolved' end,
    resolution_reason = 'Migrated from the legacy exception state; original claims remain evidence.',
    resolution_actor_kind = 'unknown',
    resolved_at = coalesce(updated_at, created_at)
where flo115_legacy_state in ('resolved', 'dismissed');

-- Category normalisation can collapse legacy names such as `unpaid` and
-- `payment`. Keep the oldest row as the active canonical case and resolve later
-- collisions as deterministic historical duplicates, preserving every row's
-- claims, provenance and audit trail.
with ranked as (
  select id,
         row_number() over (
           partition by assignment_id, category
           order by created_at, id
         ) as row_number
  from public.exception_cases
  where state <> 'resolved' and archived_at is null
)
update public.exception_cases exception_case
set state = 'resolved',
    resolution_outcome = 'legacy_duplicate_merged',
    resolution_reason = 'Legacy exception categories collapsed to one active assignment/category case.',
    resolution_actor_kind = 'unknown',
    resolved_at = coalesce(exception_case.updated_at, exception_case.created_at),
    version = version + 1
from ranked
where ranked.id = exception_case.id and ranked.row_number > 1;

alter table public.exception_cases drop column flo115_legacy_state;

alter table public.exception_cases
  alter column summary set not null,
  alter column opened_at set not null,
  alter column recorded_at set not null,
  add constraint exception_cases_category_check check (category in (
    'payment_dispute', 'attendance_dispute', 'completion_dispute',
    'no_show_concern', 'cancelled_after_commitment',
    'cancelled_after_travel_authorisation', 'ambiguous_completion',
    'verification_trust_concern'
  )),
  add constraint exception_cases_resolution_check check (
    (state <> 'resolved' and resolution_outcome is null and resolution_reason is null
      and resolution_actor_kind is null and resolved_by_user_id is null and resolved_at is null)
    or (state = 'resolved' and resolution_outcome is not null
      and resolution_reason is not null and resolution_actor_kind in ('operator', 'unknown')
      and ((resolution_actor_kind = 'operator' and resolved_by_user_id is not null)
        or (resolution_actor_kind = 'unknown' and resolved_by_user_id is null))
      and resolved_at is not null)
  ),
  add constraint exception_cases_interpretation_object_check check (
    interpretation is null or jsonb_typeof(interpretation) = 'object'
  ),
  add constraint exception_cases_resolution_evidence_object_check check (
    resolution_evidence is null or jsonb_typeof(resolution_evidence) = 'object'
  );

alter table public.exception_cases
  drop constraint if exists exception_cases_workmark_id_fkey;
alter table public.exception_cases
  add constraint exception_cases_workmark_id_fkey
    foreign key (workmark_id) references public.workmarks(id);

create unique index exception_cases_one_unresolved_assignment_category
  on public.exception_cases(assignment_id, category)
  where state <> 'resolved' and archived_at is null;

create index exception_cases_queue_idx
  on public.exception_cases(state, updated_at desc)
  where archived_at is null;

create table public.exception_claims (
  id uuid primary key default gen_random_uuid(),
  exception_case_id uuid not null references public.exception_cases(id),
  asserted_by_person_id uuid references public.people(id),
  recorded_by_user_id uuid not null references auth.users(id),
  asserted_role text not null check (asserted_role in ('worker', 'hirer', 'operator')),
  category text not null check (category in (
    'payment_dispute', 'attendance_dispute', 'completion_dispute',
    'no_show_concern', 'cancelled_after_commitment',
    'cancelled_after_travel_authorisation', 'ambiguous_completion',
    'verification_trust_concern'
  )),
  assertion jsonb not null check (jsonb_typeof(assertion) = 'object'),
  statement text not null check (length(trim(statement)) > 0),
  source text not null check (length(trim(source)) > 0),
  source_reference text,
  evidence_refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_refs) = 'array'),
  source_channel_event_id uuid references public.channel_events(id),
  source_proposed_action_id uuid references public.proposed_actions(id),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (asserted_role = 'operator' and asserted_by_person_id is null)
    or (asserted_role in ('worker', 'hirer') and asserted_by_person_id is not null)
  )
);

create index exception_claims_case_created_idx
  on public.exception_claims(exception_case_id, created_at, id);

create or replace function public.validate_exception_context()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  assignment_worker uuid;
  assignment_hirer uuid;
  assignment_organisation uuid;
  case_assignment_id uuid;
  case_category text;
  workmark_assignment uuid;
  correction_workmark uuid;
  has_travel boolean;
begin
  if tg_table_name = 'exception_claims' then
    select assignment_id, category into case_assignment_id, case_category
    from public.exception_cases where id = new.exception_case_id;
  else
    case_assignment_id := new.assignment_id;
    case_category := new.category;
    if tg_op = 'INSERT' and new.recorded_by_user_id is null
       and current_setting('app.actor_kind', true) is distinct from 'system' then
      raise exception 'new exception cases require a recording actor';
    end if;
    if new.source_proposed_action_id is not null and not exists (
      select 1 from public.proposed_actions action
      where action.id = new.source_proposed_action_id
        and action.channel_event_id = new.source_channel_event_id
    ) then
      raise exception 'source proposed action and channel event must agree';
    end if;
  end if;
  select worker_id, hirer_person_id, organisation_id,
         (cancelled_after_travel_authorised or travel_authorised_at is not null
          or travel_revoked_at is not null)
    into assignment_worker, assignment_hirer, assignment_organisation, has_travel
  from public.assignments where id = case_assignment_id;
  if assignment_worker is null then
    raise exception 'exception assignment was not found';
  end if;
  if case_category = 'cancelled_after_travel_authorisation' and not has_travel then
    raise exception 'travel-authorisation cancellation requires travel evidence';
  end if;
  if case_category = 'cancelled_after_commitment' and has_travel then
    raise exception 'assignments with travel evidence require post-travel cancellation category';
  end if;
  if tg_table_name = 'exception_claims' then
    if new.asserted_role = 'worker' and new.asserted_by_person_id is distinct from assignment_worker then
      raise exception 'worker exception claim must be asserted by the assigned worker';
    end if;
    if new.asserted_role = 'hirer' and not (
      new.asserted_by_person_id is not distinct from assignment_hirer
      or (assignment_organisation is not null and exists (
        select 1 from public.organisation_contacts contact
        where contact.organisation_id = assignment_organisation
          and contact.person_id = new.asserted_by_person_id
          and contact.archived_at is null
      ))
    ) then
      raise exception 'hirer exception claim must be asserted by the assignment hirer or an active organisation contact';
    end if;
    if new.source_proposed_action_id is not null and not exists (
      select 1 from public.proposed_actions action
      where action.id = new.source_proposed_action_id
        and action.channel_event_id = new.source_channel_event_id
    ) then
      raise exception 'source proposed action and channel event must agree';
    end if;
  else
    if new.workmark_id is not null then
      select assignment_id into workmark_assignment
      from public.workmarks where id = new.workmark_id;
      if workmark_assignment is distinct from new.assignment_id then
        raise exception 'exception workmark must belong to its assignment';
      end if;
    end if;
    if new.workmark_correction_id is not null then
      select correction.workmark_id, workmark.assignment_id
        into correction_workmark, workmark_assignment
      from public.workmark_corrections correction
      join public.workmarks workmark on workmark.id = correction.workmark_id
      where correction.id = new.workmark_correction_id;
      if correction_workmark is null
        or (new.workmark_id is not null
          and correction_workmark is distinct from new.workmark_id)
        or (new.workmark_id is null
          and workmark_assignment is distinct from new.assignment_id) then
        raise exception 'resolution correction must reference a workmark for the case assignment';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger exception_cases_context
before insert or update on public.exception_cases
for each row execute function public.validate_exception_context();
create trigger exception_claims_context
before insert on public.exception_claims
for each row execute function public.validate_exception_context();

create or replace function public.prevent_exception_claim_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'exception_claims are append-only and immutable';
end;
$$;
create trigger exception_claims_immutable
before update or delete on public.exception_claims
for each row execute function public.prevent_exception_claim_mutation();

create or replace function public.validate_exception_case_transition()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.assignment_id is distinct from old.assignment_id
     or new.category is distinct from old.category
     or new.workmark_id is distinct from old.workmark_id
     or new.summary is distinct from old.summary
     or new.opened_by_person_id is distinct from old.opened_by_person_id
     or new.recorded_by_user_id is distinct from old.recorded_by_user_id
     or new.source is distinct from old.source
     or new.source_channel_event_id is distinct from old.source_channel_event_id
     or new.source_proposed_action_id is distinct from old.source_proposed_action_id
     or new.opened_at is distinct from old.opened_at
     or new.recorded_at is distinct from old.recorded_at
     or new.interpretation is distinct from old.interpretation then
    raise exception 'exception case history and provenance are immutable';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'exception case version must increase by one';
  end if;
  if old.state = 'open' and new.state not in ('open', 'under_review') then
    raise exception 'exception case may only move open to under_review';
  end if;
  if old.state = 'under_review' and new.state not in ('under_review', 'resolved') then
    raise exception 'exception case may only move under_review to resolved';
  end if;
  if old.state = 'resolved' and new.state <> 'resolved' then
    raise exception 'resolved exception cases cannot be reopened';
  end if;
  if old.state = 'resolved' and (
       new.resolution_outcome is distinct from old.resolution_outcome
       or new.resolution_reason is distinct from old.resolution_reason
       or new.resolution_actor_kind is distinct from old.resolution_actor_kind
       or new.resolved_by_user_id is distinct from old.resolved_by_user_id
       or new.resolved_at is distinct from old.resolved_at
       or new.resolution_evidence is distinct from old.resolution_evidence
       or new.workmark_correction_id is distinct from old.workmark_correction_id
     ) then
    raise exception 'resolved exception resolution history is immutable';
  end if;
  if old.state <> 'resolved' and new.state <> 'resolved'
     and (new.resolution_outcome is not null or new.resolution_reason is not null
       or new.resolution_actor_kind is not null
       or new.resolved_by_user_id is not null or new.resolved_at is not null
       or new.resolution_evidence is not null or new.workmark_correction_id is not null) then
    raise exception 'resolution fields require a resolved exception case';
  end if;
  return new;
end;
$$;
create trigger exception_cases_transition
before update on public.exception_cases
for each row execute function public.validate_exception_case_transition();

create or replace function public.prevent_exception_case_delete()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'exception cases are immutable history and cannot be deleted';
end;
$$;
create trigger exception_cases_delete_immutable
before delete on public.exception_cases
for each row execute function public.prevent_exception_case_delete();

-- Exception audit is intentionally allowlisted.  Claims contain statements,
-- assertions, evidence references and source text which are sensitive and must
-- not be copied into the generic audit payload.  Keep only identifiers,
-- category/state, actor identity, provenance IDs and times.
create or replace function public.record_exception_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_account_id uuid;
  actor_person_id uuid;
  actor_kind_value text;
  old_value jsonb;
  new_value jsonb;
begin
  actor_account_id := auth.uid();
  if actor_account_id is not null and exists (
    select 1 from public.operator_accounts
    where user_id = actor_account_id and archived_at is null
  ) then
    select person_id into actor_person_id
    from public.operator_accounts
    where user_id = actor_account_id and archived_at is null;
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
    actor_person_id := null;
    actor_kind_value := case
      when current_setting('app.actor_kind', true) = 'system' then 'system'
      else 'unknown'
    end;
  end if;

  if tg_table_name = 'exception_cases' then
    old_value := case when tg_op = 'INSERT' then null else jsonb_build_object(
      'id', old.id, 'assignment_id', old.assignment_id,
      'workmark_id', old.workmark_id, 'category', old.category,
      'state', old.state, 'version', old.version,
      'source_channel_event_id', old.source_channel_event_id,
      'source_proposed_action_id', old.source_proposed_action_id,
      'opened_at', old.opened_at, 'recorded_at', old.recorded_at,
      'updated_at', old.updated_at, 'resolved_at', old.resolved_at
    ) end;
    new_value := case when tg_op = 'DELETE' then null else jsonb_build_object(
      'id', new.id, 'assignment_id', new.assignment_id,
      'workmark_id', new.workmark_id, 'category', new.category,
      'state', new.state, 'version', new.version,
      'source_channel_event_id', new.source_channel_event_id,
      'source_proposed_action_id', new.source_proposed_action_id,
      'opened_at', new.opened_at, 'recorded_at', new.recorded_at,
      'updated_at', new.updated_at, 'resolved_at', new.resolved_at
    ) end;
  else
    old_value := null;
    new_value := jsonb_build_object(
      'id', new.id, 'exception_case_id', new.exception_case_id,
      'asserted_by_person_id', new.asserted_by_person_id,
      'recorded_by_user_id', new.recorded_by_user_id,
      'asserted_role', new.asserted_role, 'category', new.category,
      'source_channel_event_id', new.source_channel_event_id,
      'source_proposed_action_id', new.source_proposed_action_id,
      'occurred_at', new.occurred_at, 'created_at', new.created_at
    );
  end if;

  insert into public.audit_events(
    table_name, record_id, action, changes, actor_id, operator_account_id,
    actor_kind, source_channel_event_id, source_proposed_action_id, occurred_at
  ) values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    jsonb_build_object('before', old_value, 'after', new_value),
    actor_person_id,
    actor_account_id,
    actor_kind_value,
    coalesce(
      nullif(current_setting('app.source_channel_event_id', true), '')::uuid,
      case when tg_op = 'DELETE' then old.source_channel_event_id
           else new.source_channel_event_id end
    ),
    coalesce(
      nullif(current_setting('app.source_proposed_action_id', true), '')::uuid,
      case when tg_op = 'DELETE' then old.source_proposed_action_id
           else new.source_proposed_action_id end
    ),
    timezone('utc', now())
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.record_exception_audit() from public;
drop trigger if exists exception_cases_audit on public.exception_cases;
create trigger exception_cases_audit
after insert or update on public.exception_cases
for each row execute function public.record_exception_audit();
drop trigger if exists exception_claims_audit on public.exception_claims;
create trigger exception_claims_audit
after insert on public.exception_claims
for each row execute function public.record_exception_audit();

create or replace view public.operator_exception_queue
with (security_invoker = false, security_barrier = true) as
select
  exception_case.id as exception_id,
  exception_case.assignment_id,
  coalesce(exception_case.workmark_id, assignment_workmark.id) as workmark_id,
  exception_case.state,
  exception_case.category,
  exception_case.summary,
  exception_case.version,
  exception_case.opened_at,
  exception_case.updated_at,
  exception_case.opened_by_person_id,
  exception_case.recorded_by_user_id,
  assignment.worker_id,
  worker_person.display_name as worker_name,
  assignment.organisation_id,
  organisation.display_name as organisation_name,
  assignment.hirer_person_id,
  coalesce(assignment.hirer_person_id, primary_contact.person_id) as hirer_claimant_id,
  coalesce(hirer_person.display_name, primary_contact_person.display_name) as hirer_claimant_name,
  coalesce(hirer_person.display_name, primary_contact_person.display_name) as hirer_name,
  assignment.starts_on,
  assignment.ends_on,
  site.name as site_name,
  coalesce(requirement.work_type, 'General labour') as work_type,
  labour_request.needed_from as job_needed_from,
  labour_request.needed_to as job_needed_to,
  labour_request.needed_at as job_needed_at,
  labour_request.rate_cents as job_rate_cents,
  labour_request.currency as job_currency,
  labour_request.terms as job_terms,
  assignment.lifecycle as assignment_lifecycle,
  assignment.cancelled_after_travel_authorised,
  assignment.travel_authorised_at,
  coalesce(workmark.evidence_state, assignment_workmark.evidence_state) as workmark_evidence_state,
  (select count(*)::integer from public.exception_claims claim
   where claim.exception_case_id = exception_case.id) as claim_count,
  (select max(claim.created_at) from public.exception_claims claim
   where claim.exception_case_id = exception_case.id) as last_claim_at,
  latest_claim.id as latest_claim_id,
  latest_claim.asserted_by_person_id as latest_claim_asserted_by,
  latest_claim.asserted_role as latest_claim_role,
  latest_claim.category as latest_claim_category,
  latest_claim.statement as latest_claim_statement,
  latest_claim.assertion as latest_claim_assertion,
  latest_claim.source as latest_claim_source,
  latest_claim.evidence_refs as latest_claim_evidence_refs,
  latest_claim.occurred_at as latest_claim_occurred_at,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id', claim.id,
    'asserted_by', claim.asserted_by_person_id,
    'asserted_by_name', asserted_person.display_name,
    'recorded_by', claim.recorded_by_user_id,
    'role', claim.asserted_role,
    'category', claim.category,
    'assertion', claim.assertion,
    'statement', claim.statement,
    'source', claim.source,
    'source_reference', claim.source_reference,
    'source_channel_event_id', claim.source_channel_event_id,
    'source_proposed_action_id', claim.source_proposed_action_id,
    'evidence_refs', claim.evidence_refs,
    'occurred_at', claim.occurred_at,
    'created_at', claim.created_at
  ) order by claim.created_at, claim.id)
    from public.exception_claims claim
    left join public.people asserted_person on asserted_person.id = claim.asserted_by_person_id
    where claim.exception_case_id = exception_case.id), '[]'::jsonb) as claims,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id', stamp.id,
    'asserted_by', stamp.asserted_by_person_id,
    'asserted_role', stamp.asserted_role,
    'attendance', stamp.attendance,
    'completion', stamp.completion,
    'payment', stamp.payment,
    'reuse_preference', stamp.reuse_preference,
    'amount_cents', stamp.amount_cents,
    'currency', stamp.currency,
    'note', stamp.note,
    'source', stamp.source,
    'source_channel_event_id', stamp.source_channel_event_id,
    'source_proposed_action_id', stamp.source_proposed_action_id,
    'occurred_at', stamp.occurred_at,
    'created_at', stamp.created_at
  ) order by stamp.created_at, stamp.id)
    from public.assignment_stamps stamp
    where stamp.assignment_id = exception_case.assignment_id), '[]'::jsonb) as stamps,
  case when coalesce(workmark.id, assignment_workmark.id) is null then null else jsonb_build_object(
    'id', coalesce(workmark.id, assignment_workmark.id),
    'evidence_state', coalesce(workmark.evidence_state, assignment_workmark.evidence_state),
    'lifecycle', coalesce(workmark.lifecycle, assignment_workmark.lifecycle),
    'attendance', coalesce(workmark.attendance, assignment_workmark.attendance),
    'completion', coalesce(workmark.completion, assignment_workmark.completion),
    'payment', coalesce(workmark.payment, assignment_workmark.payment),
    'version', coalesce(workmark.version, assignment_workmark.version)
  ) end as workmark_evidence,
  exception_case.resolution_outcome,
  exception_case.resolution_reason,
  exception_case.resolution_actor_kind,
  exception_case.resolved_by_user_id,
  exception_case.resolved_at,
  exception_case.resolution_evidence,
  (select count(*)::integer from public.assignment_stamps stamp
   where stamp.assignment_id = exception_case.assignment_id) as stamp_count
from public.exception_cases exception_case
join public.assignments assignment on assignment.id = exception_case.assignment_id
left join public.workmarks workmark on workmark.id = exception_case.workmark_id
left join lateral (
  select fallback_workmark.*
  from public.workmarks fallback_workmark
  where fallback_workmark.assignment_id = exception_case.assignment_id
  order by fallback_workmark.created_at desc, fallback_workmark.id desc
  limit 1
) assignment_workmark on exception_case.workmark_id is null
left join public.people worker_person on worker_person.id = assignment.worker_id
left join public.organisations organisation on organisation.id = assignment.organisation_id
left join public.people hirer_person on hirer_person.id = assignment.hirer_person_id
left join public.organisation_contacts primary_contact
  on primary_contact.organisation_id = assignment.organisation_id
 and primary_contact.is_primary and primary_contact.archived_at is null
left join public.people primary_contact_person on primary_contact_person.id = primary_contact.person_id
left join public.labour_requests labour_request on labour_request.id = assignment.labour_request_id
left join public.labour_requirements requirement on requirement.id = assignment.labour_requirement_id
left join public.sites site on site.id = assignment.site_id
left join lateral (
  select claim.id, claim.asserted_by_person_id, claim.asserted_role,
         claim.category, claim.statement, claim.assertion, claim.source,
         claim.evidence_refs, claim.occurred_at
  from public.exception_claims claim
  where claim.exception_case_id = exception_case.id
  order by claim.created_at desc, claim.id desc
  limit 1
) latest_claim on true
where exception_case.archived_at is null
  and (select public.is_active_operator());

alter table public.exception_claims enable row level security;
alter table public.exception_case_migration_archive enable row level security;
revoke all on table public.exception_cases, public.exception_claims from anon, authenticated;
grant select on table public.exception_cases, public.exception_claims to authenticated;
revoke all on table public.exception_case_migration_archive from anon, authenticated;
grant select on table public.exception_case_migration_archive to authenticated;
create policy exception_case_migration_archive_operator_read
on public.exception_case_migration_archive
for select to authenticated using ((select public.is_active_operator()));
drop policy if exists exception_cases_operator_read on public.exception_cases;
create policy exception_cases_operator_read on public.exception_cases
for select to authenticated using ((select public.is_active_operator()));
create policy exception_claims_operator_read on public.exception_claims
for select to authenticated using ((select public.is_active_operator()));
revoke all on public.operator_exception_queue from anon, authenticated;
grant select on public.operator_exception_queue to authenticated;
drop policy if exists assignment_stamps_operator_read on public.assignment_stamps;
create policy assignment_stamps_operator_read on public.assignment_stamps
for select to authenticated using ((select public.is_active_operator()));

-- Keep browser writes impossible even if a future policy is added to the base
-- tables; all mutations go through the FastAPI command boundary.
revoke insert, update, delete on public.exception_cases, public.exception_claims
from anon, authenticated;
