-- FLO-133: provider-neutral semantic decision evidence.
-- This table records non-authoritative routing/draft evidence only. It must not
-- be used as a source for Workmark, payment, attendance, or travel truth.

create type public.semantic_decision_mode as enum ('shadow', 'active');
create type public.semantic_decision_status as enum ('succeeded', 'failed');

create table public.semantic_decisions (
  id uuid primary key default gen_random_uuid(),
  channel_event_id uuid not null references public.channel_events(id),
  decision_provider text not null check (length(trim(decision_provider)) > 0),
  model_version text,
  bundle_name text not null check (length(trim(bundle_name)) > 0),
  bundle_version text not null check (length(trim(bundle_version)) > 0),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  language_code text,
  mode public.semantic_decision_mode not null,
  answers jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  duration_ms integer check (duration_ms >= 0),
  policy_outcome text not null check (policy_outcome in ('baseline', 'confirmation_or_ops', 'ops')),
  policy_reason text not null check (length(trim(policy_reason)) > 0),
  status public.semantic_decision_status not null,
  handling_outcome text not null default 'pending' check (handling_outcome in ('pending', 'confirmed', 'corrected', 'escalated')),
  proposed_action_id uuid references public.proposed_actions(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint semantic_decisions_answers_object_check check (jsonb_typeof(answers) = 'object'),
  constraint semantic_decisions_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index semantic_decisions_channel_event_created_idx
  on public.semantic_decisions(channel_event_id, created_at desc);
create index semantic_decisions_analysis_idx
  on public.semantic_decisions(bundle_name, bundle_version, mode, status, created_at desc);

alter table public.semantic_decisions enable row level security;
revoke all on table public.semantic_decisions from anon, authenticated;
grant select on table public.semantic_decisions to authenticated;
create policy semantic_decisions_operator_read on public.semantic_decisions
  for select to authenticated using ((select public.is_active_operator()));

create trigger semantic_decisions_updated_at before update on public.semantic_decisions
for each row execute function public.set_updated_at();
