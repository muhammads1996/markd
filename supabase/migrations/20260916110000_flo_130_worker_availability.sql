-- FLO-130: append-only, provenance-aware daily worker availability signals.

alter table public.availability_signals
  add column version integer not null default 1 check (version > 0),
  add column recorded_by_user_id uuid references auth.users(id),
  add column source_channel_event_id uuid references public.channel_events(id),
  add column source_proposed_action_id uuid references public.proposed_actions(id);

create unique index availability_signals_one_live_daily_signal_key
  on public.availability_signals(worker_id, available_from)
  where available_to = available_from and archived_at is null;