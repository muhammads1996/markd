-- FLO-114: append-only Assignment closeout evidence and canonical Workmarks.

alter type public.completion_outcome add value if not exists 'partial';
alter type public.completion_outcome add value if not exists 'not_completed';
alter type public.payment_state add value if not exists 'pending';
alter type public.payment_state add value if not exists 'partial';
alter type public.workmark_origin add value if not exists 'assignment_closeout';

create type public.workmark_evidence_state as enum (
  'pending',
  'corroborated',
  'conflicted',
  'operator_resolved'
);

alter table public.workmarks
  alter column organisation_id drop not null,
  add column hirer_person_id uuid references public.people(id),
  add column evidence_state public.workmark_evidence_state not null default 'pending',
  add column version integer not null default 1 check (version > 0),
  add constraint workmarks_one_hirer_check
    check (num_nonnulls(organisation_id, hirer_person_id) = 1);

create unique index workmarks_one_assignment_key
  on public.workmarks(assignment_id)
  where assignment_id is not null;

create table public.assignment_stamps (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id),
  workmark_id uuid not null references public.workmarks(id),
  asserted_by_person_id uuid references public.people(id),
  recorded_by_user_id uuid not null references auth.users(id),
  asserted_role text not null check (asserted_role in ('worker', 'hirer', 'operator')),
  attendance public.attendance_outcome not null default 'unknown',
  completion public.completion_outcome not null default 'unknown',
  reuse_preference public.reuse_preference not null default 'unknown',
  payment public.payment_state not null default 'unknown',
  amount_cents integer check (amount_cents >= 0),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  payment_method text,
  note text,
  source text not null check (length(trim(source)) > 0),
  source_channel_event_id uuid references public.channel_events(id),
  source_proposed_action_id uuid references public.proposed_actions(id),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  check (asserted_role = 'operator' or asserted_by_person_id is not null)
);

create index assignment_stamps_workmark_created_idx
  on public.assignment_stamps(workmark_id, created_at);

create table public.workmark_corrections (
  id uuid primary key default gen_random_uuid(),
  workmark_id uuid not null references public.workmarks(id),
  reason text not null check (length(trim(reason)) > 0),
  changes jsonb not null check (
    jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb
  ),
  asserted_by_person_id uuid references public.people(id),
  recorded_by_user_id uuid not null references auth.users(id),
  source text not null check (length(trim(source)) > 0),
  source_channel_event_id uuid references public.channel_events(id),
  source_proposed_action_id uuid references public.proposed_actions(id),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index workmark_corrections_workmark_created_idx
  on public.workmark_corrections(workmark_id, created_at);

create or replace function public.validate_workmark_context()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  assignment_worker uuid;
  assignment_organisation uuid;
  assignment_hirer uuid;
  assignment_site uuid;
  contact_organisation uuid;
  site_organisation uuid;
begin
  if new.assignment_id is not null then
    select worker_id, organisation_id, hirer_person_id, site_id
    into assignment_worker, assignment_organisation, assignment_hirer, assignment_site
    from public.assignments where id = new.assignment_id;
    if new.worker_id is distinct from assignment_worker
      or new.organisation_id is distinct from assignment_organisation
      or new.hirer_person_id is distinct from assignment_hirer
      or (assignment_site is not null and new.site_id is distinct from assignment_site) then
      raise exception 'workmark must match its assignment worker, hirer, and site';
    end if;
  end if;
  if new.organisation_contact_id is not null then
    select organisation_id into contact_organisation
    from public.organisation_contacts where id = new.organisation_contact_id;
    if contact_organisation is distinct from new.organisation_id then
      raise exception 'workmark contact must belong to its organisation';
    end if;
  end if;
  if new.site_id is not null then
    select organisation_id into site_organisation from public.sites where id = new.site_id;
    if site_organisation is not null and site_organisation is distinct from new.organisation_id then
      raise exception 'workmark site must belong to its organisation';
    end if;
  end if;
  return new;
end;
$$;

create function public.prevent_workmark_hirer_identity_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.hirer_person_id is distinct from old.hirer_person_id then
    raise exception 'workmark relationship identity is immutable';
  end if;
  return new;
end;
$$;

create trigger workmarks_hirer_identity
before update on public.workmarks
for each row execute function public.prevent_workmark_hirer_identity_mutation();

create trigger assignment_stamps_immutable
before update or delete on public.assignment_stamps
for each row execute function public.prevent_evidence_mutation();

create trigger workmark_corrections_immutable
before update or delete on public.workmark_corrections
for each row execute function public.prevent_evidence_mutation();

create trigger assignment_stamps_audit
after insert on public.assignment_stamps
for each row execute function public.record_labour_flow_audit();

create trigger workmark_corrections_audit
after insert on public.workmark_corrections
for each row execute function public.record_labour_flow_audit();

alter table public.assignment_stamps enable row level security;
alter table public.workmark_corrections enable row level security;
revoke all on table public.assignment_stamps, public.workmark_corrections from anon, authenticated;