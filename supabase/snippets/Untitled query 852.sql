select
    ce.occurred_at,
    ce.sender_phone_number,
    ce.provider_message_id,
    cma.provider_media_id,
    cma.media_type,
    cma.mime_type
from public.channel_media_assets cma
join public.channel_events ce
    on ce.id = cma.channel_event_id
where ce.channel = 'whatsapp'
order by ce.occurred_at desc
limit 20;