-- FLO-108/FLO-109: WhatsApp transport evidence and safe proposed actions.
-- Channel input is evidence; only an approved application command may mutate
-- the canonical Work Graph.

create type public.channel_event_state as enum ('received', 'queued', 'processing', 'processed', 'failed');
create type public.proposed_action_risk_tier as enum ('informational', 'operational', 'trust', 'economic');
create type public.proposed_action_ambiguity_state as enum ('clear', 'ambiguous', 'unresolved');
create type public.channel_delivery_state as enum ('queued', 'sent', 'delivered', 'failed');

alter table public.channel_events
  add column event_type text not null default 'message',
  add column provider_message_id text,
  add column occurred_at timestamptz,
  add column media jsonb not null default '[]'::jsonb,
  add column state public.channel_event_state not null default 'received',
  add column failure_reason text;
create unique index channel_events_provider_message_key
  on public.channel_events(channel, provider_message_id)
  where provider_message_id is not null;
alter table public.channel_events
  add constraint channel_events_event_type_check check (event_type in ('message', 'status', 'unsupported')),
  add constraint channel_events_media_array_check check (jsonb_typeof(media) = 'array');

alter table public.proposed_actions
  add column confidence numeric(3, 2),
  add column ambiguity public.proposed_action_ambiguity_state not null default 'unresolved',
  add column entity_resolution jsonb not null default '{}'::jsonb,
  add column interpretation jsonb not null default '{}'::jsonb,
  add column model_provider text,
  add column model_name text,
  add column confirmed_by_operator_id uuid references public.operator_accounts(user_id),
  add column confirmed_at timestamptz,
  add column rejection_reason text,
  add constraint proposed_actions_confidence_check check (confidence between 0 and 1),
  add constraint proposed_actions_entity_resolution_object_check check (jsonb_typeof(entity_resolution) = 'object'),
  add constraint proposed_actions_interpretation_object_check check (jsonb_typeof(interpretation) = 'object');
alter table public.proposed_actions drop constraint proposed_actions_risk_tier_check;
alter table public.proposed_actions alter column risk_tier drop default;
alter table public.proposed_actions
  alter column risk_tier type public.proposed_action_risk_tier
  using case risk_tier when 0 then 'informational'::public.proposed_action_risk_tier when 1 then 'operational'::public.proposed_action_risk_tier when 2 then 'trust'::public.proposed_action_risk_tier else 'economic'::public.proposed_action_risk_tier end;

create table public.channel_media_assets (
  id uuid primary key default gen_random_uuid(),
  channel_event_id uuid not null references public.channel_events(id),
  provider_media_id text not null,
  media_type text not null check (media_type in ('image', 'audio', 'video', 'document', 'sticker', 'unknown')),
  mime_type text,
  provider_url text,
  storage_bucket text,
  storage_path text,
  retrieval_state text not null default 'pending' check (retrieval_state in ('pending', 'retrieved', 'failed')),
  failure_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (channel_event_id, provider_media_id)
);

create table public.channel_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  channel_event_id uuid not null unique references public.channel_events(id),
  state text not null default 'queued' check (state in ('queued', 'leased', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index channel_processing_jobs_claim_idx on public.channel_processing_jobs(state, available_at);
create index channel_processing_jobs_lease_idx on public.channel_processing_jobs(state, leased_until);

create table public.channel_deliveries (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  recipient_phone_number text not null check (recipient_phone_number ~ '^\\+[1-9][0-9]{1,14}$'),
  message_kind text not null check (length(trim(message_kind)) > 0),
  body text not null check (length(trim(body)) > 0),
  source_table text,
  source_record_id uuid,
  idempotency_key text not null unique,
  provider_message_id text,
  state public.channel_delivery_state not null default 'queued',
  failure_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  delivered_at timestamptz
);
alter table public.channel_deliveries
  add column source_channel_event_id uuid,
  add column source_proposed_action_id uuid,
  add constraint channel_deliveries_source_event_fkey
    foreign key (source_channel_event_id) references public.channel_events(id),
  add constraint channel_deliveries_source_action_fkey
    foreign key (source_proposed_action_id) references public.proposed_actions(id),
  add constraint channel_deliveries_source_pair_check
    check (source_proposed_action_id is null or source_channel_event_id is not null);

create or replace function public.enqueue_channel_event_job()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.channel_processing_jobs(channel_event_id)
  values (new.id)
  on conflict (channel_event_id) do nothing;
  return new;
end;
$$;
create trigger channel_events_enqueue_job after insert on public.channel_events
for each row execute function public.enqueue_channel_event_job();

create or replace function public.claim_channel_processing_jobs(batch_size integer default 10)
returns setof public.channel_processing_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return query
  with claimed as (
    select id from public.channel_processing_jobs
    where state = 'queued' and available_at <= timezone('utc', now())
    order by available_at, created_at
    for update skip locked limit greatest(batch_size, 1)
  )
  update public.channel_processing_jobs job
  set state = 'leased', attempts = job.attempts + 1,
      leased_until = timezone('utc', now()) + interval '5 minutes',
      updated_at = timezone('utc', now())
  from claimed where job.id = claimed.id returning job.*;
end;
$$;

create or replace function public.complete_channel_processing_job(
  job_id uuid,
  succeeded boolean,
  error_message text default null
)
returns public.channel_processing_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.channel_processing_jobs;
begin
  update public.channel_processing_jobs
  set state = case
        when succeeded then 'completed'
        when attempts >= 5 then 'failed'
        else 'queued'
      end,
      available_at = case when succeeded or attempts >= 5 then available_at else timezone('utc', now()) + interval '1 minute' end,
      leased_until = null,
      last_error = case when succeeded then null else nullif(trim(error_message), '') end,
      updated_at = timezone('utc', now())
  where id = job_id and state = 'leased'
  returning * into result;
  if not found then raise exception 'only a leased processing job can be completed'; end if;
  return result;
end;
$$;

create or replace function public.requeue_expired_channel_processing_jobs()
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare recovered integer;
begin
  update public.channel_processing_jobs
  set state = case when attempts >= 5 then 'failed' else 'queued' end,
      available_at = case when attempts >= 5 then available_at else timezone('utc', now()) end,
      leased_until = null,
      last_error = coalesce(last_error, 'processing lease expired'),
      updated_at = timezone('utc', now())
  where state = 'leased' and leased_until < timezone('utc', now());
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

create or replace function public.approve_proposed_action(action_id uuid, edited_payload jsonb default null)
returns public.proposed_actions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.proposed_actions;
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to approve a proposed action'; end if;
  update public.proposed_actions
  set payload = coalesce(edited_payload, payload), state = 'approved',
      confirmed_by_operator_id = auth.uid(), confirmed_at = timezone('utc', now())
  where id = action_id and state = 'pending' and ambiguity = 'clear';
  if not found then raise exception 'only a clear pending proposed action can be approved'; end if;
  select * into result from public.proposed_actions where id = action_id;
  return result;
end;
$$;

create or replace function public.reject_proposed_action(action_id uuid, reason text)
returns public.proposed_actions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.proposed_actions;
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to reject a proposed action'; end if;
  if reason is null or length(trim(reason)) = 0 then raise exception 'a rejection reason is required'; end if;
  update public.proposed_actions set state = 'rejected', rejection_reason = trim(reason)
  where id = action_id and state = 'pending';
  if not found then raise exception 'only a pending proposed action can be rejected'; end if;
  select * into result from public.proposed_actions where id = action_id;
  return result;
end;
$$;

alter table public.channel_events enable row level security;
alter table public.channel_media_assets enable row level security;
alter table public.channel_processing_jobs enable row level security;
alter table public.channel_deliveries enable row level security;
revoke all on table public.channel_events, public.channel_media_assets, public.channel_processing_jobs, public.channel_deliveries from anon, authenticated;
grant select on table public.channel_events, public.channel_media_assets, public.channel_deliveries to authenticated;
drop policy if exists channel_events_operator_read on public.channel_events;
drop policy if exists channel_media_assets_operator_read on public.channel_media_assets;
drop policy if exists channel_deliveries_operator_read on public.channel_deliveries;
create policy channel_events_operator_read on public.channel_events for select to authenticated using ((select public.is_active_operator()));
create policy channel_media_assets_operator_read on public.channel_media_assets for select to authenticated using ((select public.is_active_operator()));
create policy channel_deliveries_operator_read on public.channel_deliveries for select to authenticated using ((select public.is_active_operator()));
grant execute on function public.approve_proposed_action(uuid, jsonb) to authenticated;
grant execute on function public.reject_proposed_action(uuid, text) to authenticated;

create trigger channel_media_assets_updated_at before update on public.channel_media_assets
for each row execute function public.set_updated_at();