-- FLO-131: private FastAPI command execution infrastructure.
-- Supabase remains the canonical data platform; these tables record the
-- application boundary and durable follow-up work without becoming a second
-- domain store.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;

create table private.command_executions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  command_name text not null check (length(trim(command_name)) > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 255),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'running' check (state in ('running', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (actor_user_id, idempotency_key)
);

create table private.domain_events (
  id uuid primary key default gen_random_uuid(),
  command_execution_id uuid not null references private.command_executions(id),
  event_type text not null check (length(trim(event_type)) > 0),
  aggregate_type text not null check (length(trim(aggregate_type)) > 0),
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default timezone('utc', now()),
  unique (command_execution_id, event_type)
);

create table private.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  domain_event_id uuid not null unique references private.domain_events(id),
  state text not null default 'pending' check (state in ('pending', 'leased', 'published', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz
);

create table private.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (length(trim(job_type)) > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  state text not null default 'queued' check (state in ('queued', 'leased', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index command_executions_actor_created_idx
  on private.command_executions(actor_user_id, created_at desc);
create index domain_events_occurred_idx on private.domain_events(occurred_at);
create index outbox_messages_claim_idx
  on private.outbox_messages(state, available_at);
create index jobs_claim_idx on private.jobs(state, available_at);

-- These RPCs are called by the FastAPI database role after it establishes the
-- authenticated request subject transaction-locally. Browser clients retain
-- read access through RLS, but cannot execute consequential commands directly.
revoke execute on function public.begin_worker_onboarding(uuid, jsonb),
  public.complete_worker_onboarding(uuid, uuid, text, text),
  public.cancel_worker_onboarding(uuid),
  public.onboard_organisation(text, text, text, text, text, uuid[], uuid[], text),
  public.update_worker_record(uuid, jsonb),
  public.update_organisation_record(uuid, jsonb),
  public.approve_proposed_action(uuid, jsonb, boolean),
  public.reject_proposed_action(uuid, text)
from anon, authenticated;