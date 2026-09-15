-- FLO-129: live provider integration support. Provider traffic remains
-- evidence-only until an operator explicitly approves a ProposedAction.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media',
  'whatsapp-media',
  false,
  12582912,
  array[
    'audio/aac', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
    'image/jpeg', 'image/png', 'application/pdf', 'video/mp4'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.channel_media_assets
  add column transcription_provider text,
  add column transcription_model text,
  add column transcription_latency_ms integer check (transcription_latency_ms >= 0),
  add column transcription_metadata jsonb not null default '{}'::jsonb,
  add constraint channel_media_assets_transcription_metadata_object_check
    check (jsonb_typeof(transcription_metadata) = 'object');

create unique index proposed_actions_one_live_channel_event_key
  on public.proposed_actions(channel_event_id)
  where archived_at is null;

alter table public.channel_deliveries
  drop constraint channel_deliveries_recipient_phone_number_check;
alter table public.channel_deliveries
  add constraint channel_deliveries_recipient_phone_number_check
    check (recipient_phone_number ~ '^\+[1-9][0-9]{1,14}$');

alter type public.channel_delivery_state add value if not exists 'leased' after 'queued';

alter table public.channel_deliveries
  add column attempts integer not null default 0 check (attempts >= 0),
  add column available_at timestamptz not null default timezone('utc', now()),
  add column leased_until timestamptz,
  add column last_error text;
create index channel_deliveries_claim_idx
  on public.channel_deliveries(state, available_at);
create index channel_deliveries_lease_idx
  on public.channel_deliveries(state, leased_until);

create or replace function public.enqueue_channel_event_job()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.event_type = 'message' then
    insert into public.channel_processing_jobs(channel_event_id)
    values (new.id)
    on conflict (channel_event_id) do nothing;
  end if;
  return new;
end;
$$;

drop function if exists public.complete_channel_processing_job(uuid, boolean, text);
create function public.complete_channel_processing_job(
  job_id uuid,
  succeeded boolean,
  error_message text default null,
  retryable boolean default true
)
returns public.channel_processing_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.channel_processing_jobs;
begin
  update public.channel_processing_jobs
  set state = case
        when succeeded then 'completed'
        when not retryable or attempts >= 5 then 'failed'
        else 'queued'
      end,
      available_at = case
        when succeeded or not retryable or attempts >= 5 then available_at
        else timezone('utc', now()) + least(power(2, attempts - 1), 15) * interval '1 minute'
      end,
      leased_until = null,
      last_error = case when succeeded then null else nullif(trim(error_message), '') end,
      updated_at = timezone('utc', now())
  where id = job_id and state = 'leased'
  returning * into result;
  if not found then raise exception 'only a leased processing job can be completed'; end if;
  return result;
end;
$$;

create or replace function public.claim_channel_deliveries(batch_size integer default 10)
returns setof public.channel_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return query
  with claimed as (
    select id from public.channel_deliveries
    where state = 'queued' and available_at <= timezone('utc', now())
    order by available_at, created_at
    for update skip locked limit greatest(batch_size, 1)
  )
  update public.channel_deliveries delivery
  set state = 'leased',
      attempts = delivery.attempts + 1,
      leased_until = timezone('utc', now()) + interval '5 minutes'
  from claimed
  where delivery.id = claimed.id
  returning delivery.*;
end;
$$;

create or replace function public.complete_channel_delivery(
  delivery_id uuid,
  succeeded boolean,
  reported_provider_message_id text default null,
  error_message text default null,
  retryable boolean default true
)
returns public.channel_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.channel_deliveries;
begin
  update public.channel_deliveries
  set state = case
        when succeeded then 'sent'::public.channel_delivery_state
        when retryable and attempts < 5 then 'queued'::public.channel_delivery_state
        else 'failed'::public.channel_delivery_state
      end,
      provider_message_id = case
        when succeeded then nullif(trim(reported_provider_message_id), '')
        else channel_deliveries.provider_message_id
      end,
      sent_at = case when succeeded then timezone('utc', now()) else sent_at end,
      available_at = case
        when succeeded or not retryable or attempts >= 5 then available_at
        else timezone('utc', now()) + least(power(2, attempts - 1), 15) * interval '1 minute'
      end,
      leased_until = null,
      last_error = case when succeeded then null else nullif(trim(error_message), '') end,
      failure_reason = case
        when succeeded then null
        when retryable and attempts < 5 then null
        else nullif(trim(error_message), '')
      end
  where id = delivery_id and state = 'leased'
  returning * into result;
  if not found then
    raise exception 'only a leased channel delivery can be completed';
  end if;
  if succeeded and result.provider_message_id is null then
    raise exception 'a successful delivery requires a provider message ID';
  end if;
  return result;
end;
$$;

create or replace function public.requeue_expired_channel_deliveries()
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare recovered integer;
begin
  update public.channel_deliveries
  set state = case when attempts >= 5 then 'failed'::public.channel_delivery_state else 'queued'::public.channel_delivery_state end,
      available_at = case when attempts >= 5 then available_at else timezone('utc', now()) end,
      leased_until = null,
      last_error = coalesce(last_error, 'delivery lease expired'),
      failure_reason = case when attempts >= 5 then coalesce(failure_reason, 'delivery lease expired') else failure_reason end
  where state = 'leased' and leased_until < timezone('utc', now());
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

create or replace function public.record_channel_delivery_status(
  target_provider_message_id text,
  reported_state public.channel_delivery_state,
  reported_at timestamptz default timezone('utc', now()),
  reported_failure_reason text default null
)
returns public.channel_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.channel_deliveries;
begin
  if reported_state not in ('sent', 'delivered', 'failed') then
    raise exception 'delivery status must be sent, delivered, or failed';
  end if;
  update public.channel_deliveries
  set state = case
        when state = 'delivered' then 'delivered'::public.channel_delivery_state
        when reported_state = 'delivered' then 'delivered'::public.channel_delivery_state
        when reported_state = 'failed' then 'failed'::public.channel_delivery_state
        else 'sent'::public.channel_delivery_state
      end,
      delivered_at = case
        when state = 'delivered' or reported_state = 'delivered' then coalesce(delivered_at, reported_at)
        else delivered_at
      end,
      failure_reason = case
        when state = 'delivered' then failure_reason
        when reported_state = 'failed' then nullif(trim(reported_failure_reason), '')
        else failure_reason
      end
  where provider_message_id = target_provider_message_id
  returning * into result;
  return result;
end;
$$;

create function public.authorize_channel_media_read(
  requested_asset_id uuid,
  requested_expires_in integer
)
returns table(bucket_id text, object_path text)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_active_operator() then return; end if;
  if requested_expires_in < 1 or requested_expires_in > 300 then return; end if;
  return query
  select asset.storage_bucket, asset.storage_path
  from public.channel_media_assets asset
  where asset.id = requested_asset_id
    and asset.storage_bucket = 'whatsapp-media'
    and asset.storage_path is not null
    and asset.retrieval_state = 'retrieved';
end;
$$;

revoke all on function public.claim_channel_deliveries(integer),
  public.complete_channel_delivery(uuid, boolean, text, text, boolean),
  public.requeue_expired_channel_deliveries(),
  public.record_channel_delivery_status(text, public.channel_delivery_state, timestamptz, text),
  public.authorize_channel_media_read(uuid, integer)
from public;
grant execute on function public.authorize_channel_media_read(uuid, integer) to authenticated;