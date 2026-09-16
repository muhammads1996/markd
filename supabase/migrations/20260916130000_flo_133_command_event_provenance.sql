-- FLO-133: retain command and source provenance alongside outbox events.

alter table private.domain_events
  add column actor_user_id uuid references auth.users(id),
  add column correlation_id text,
  add column source_channel text,
  add column source_channel_event_id uuid,
  add column source_proposed_action_id uuid,
  add column aggregate_version integer;