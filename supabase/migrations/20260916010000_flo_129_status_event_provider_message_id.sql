-- FLO-129: retain the actual Meta message ID on new status evidence. Message
-- deduplication belongs only to inbound messages; status evidence is deduped
-- by its provider event ID so sent/delivered/read/failed transitions coexist.
-- Existing ChannelEvents are append-only provenance and are deliberately not
-- rewritten; their raw provider payload remains available as evidence.

drop index if exists public.channel_events_provider_message_key;

create unique index channel_events_inbound_provider_message_key
  on public.channel_events(channel, provider_message_id)
  where event_type = 'message' and provider_message_id is not null;