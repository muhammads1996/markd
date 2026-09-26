-- FLO-135: durable provider-neutral outbound payload and conservative send lease.
alter table public.channel_deliveries
  add column message_payload jsonb,
  add column send_started_at timestamptz,
  add column provider_send_type text check (provider_send_type in ('session_text', 'approved_template')),
  add column provider_template_name text,
  add column provider_template_locale text,
  add constraint channel_deliveries_template_evidence_check check (
    (provider_send_type = 'approved_template'
      and provider_template_name is not null
      and provider_template_locale is not null)
    or (provider_send_type = 'session_text'
      and provider_template_name is null
      and provider_template_locale is null)
    or (provider_send_type is null
      and provider_template_name is null
      and provider_template_locale is null)
  );

update public.channel_deliveries
set message_payload = jsonb_build_object('type', 'session_text', 'body', body);

-- Old queued assignment text cannot safely be dispatched outside a known
-- customer-service window. Preserve the row as Ops communication evidence.
update public.channel_deliveries
set state = 'failed', leased_until = null,
    failure_reason = 'legacy assignment text requires approved template',
    last_error = 'legacy assignment text requires approved template'
where state in ('queued', 'leased') and message_kind = 'assignment_update';

alter table public.channel_deliveries
  alter column message_payload set not null,
  alter column body drop not null,
  drop constraint channel_deliveries_body_check,
  add constraint channel_deliveries_payload_check check (
    jsonb_typeof(message_payload) = 'object'
    and (
      (message_payload ->> 'type' = 'session_text'
       and body is not null and length(trim(body)) > 0
       and message_payload ->> 'body' = body)
      or
      (message_payload ->> 'type' = 'approved_template'
       and body is null
       and jsonb_typeof(message_payload -> 'key') = 'string'
       and jsonb_typeof(message_payload -> 'locale') = 'string'
       and jsonb_typeof(message_payload -> 'variables') = 'object')
    )
  );

create function public.mark_channel_delivery_send_started(delivery_id uuid)
returns public.channel_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.channel_deliveries;
begin
  update public.channel_deliveries
  set send_started_at = timezone('utc', now())
  where id = delivery_id and state = 'leased' and send_started_at is null
  returning * into result;
  if not found then
    raise exception 'only an unsent leased channel delivery can start sending';
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
  set state = case
        when send_started_at is not null or attempts >= 5
          then 'failed'::public.channel_delivery_state
        else 'queued'::public.channel_delivery_state
      end,
      available_at = case
        when send_started_at is not null or attempts >= 5 then available_at
        else timezone('utc', now())
      end,
      leased_until = null,
      last_error = coalesce(last_error, 'delivery lease expired'),
      failure_reason = case
        when send_started_at is not null
          then 'send outcome unknown; reconcile with provider before retry'
        when attempts >= 5
          then coalesce(failure_reason, 'delivery lease expired')
        else failure_reason
      end
  where state = 'leased' and leased_until < timezone('utc', now());
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

revoke all on function public.mark_channel_delivery_send_started(uuid) from public;
