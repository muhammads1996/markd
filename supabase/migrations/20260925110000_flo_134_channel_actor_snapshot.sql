-- Capture phone ownership at verified ChannelEvent insertion, before a queued
-- message can be processed after a phone number changes hands. Older events
-- intentionally have no snapshot and cannot acquire a channel principal.
create table private.channel_actor_evidence (
  channel_event_id uuid primary key references public.channel_events(id),
  resolution text not null check (resolution in ('worker', 'hirer', 'ambiguous', 'unresolved')),
  person_id uuid references public.people(id),
  organisation_contact_id uuid references public.organisation_contacts(id),
  organisation_id uuid references public.organisations(id),
  captured_at timestamptz not null default timezone('utc', now()),
  check (
    (resolution = 'worker' and person_id is not null
      and organisation_contact_id is null and organisation_id is null)
    or (resolution = 'hirer' and person_id is not null
      and organisation_contact_id is not null and organisation_id is not null)
    or (resolution in ('ambiguous', 'unresolved') and person_id is null
      and organisation_contact_id is null and organisation_id is null)
  )
);
revoke all on private.channel_actor_evidence from public, anon, authenticated;
create trigger channel_actor_evidence_immutable
  before update or delete on private.channel_actor_evidence
  for each row execute function public.prevent_evidence_mutation();

create function private.capture_channel_actor_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner_count integer;
  owner_id uuid;
  is_worker boolean;
  contact_count integer;
  contact_id uuid;
  organisation_id uuid;
  outcome text;
begin
  if new.channel <> 'whatsapp' or new.event_type <> 'message'
     or new.provider_message_id is null then
    return new;
  end if;

  select count(*), min(phone.person_id::text)::uuid
  into owner_count, owner_id
  from public.person_phone_numbers as phone
  join public.people as person
    on person.id = phone.person_id and person.archived_at is null
  where phone.phone_number = new.sender_phone_number
    and phone.archived_at is null;

  if owner_count <> 1 then
    outcome := case when owner_count = 0 then 'unresolved' else 'ambiguous' end;
  else
    select exists(
      select 1 from public.worker_profiles as worker
      where worker.person_id = owner_id and worker.archived_at is null
        and worker.record_status = 'active'
    ) into is_worker;
    select count(*), min(contact.id::text)::uuid,
           min(organisation.id::text)::uuid
    into contact_count, contact_id, organisation_id
    from public.organisation_contacts as contact
    join public.organisations as organisation
      on organisation.id = contact.organisation_id
      and organisation.archived_at is null
      and organisation.record_status = 'active'
    where contact.person_id = owner_id and contact.archived_at is null;
    if is_worker and contact_count = 0 then
      outcome := 'worker';
    elsif not is_worker and contact_count = 1 then
      outcome := 'hirer';
    elsif not is_worker and contact_count = 0 then
      outcome := 'unresolved';
    else
      outcome := 'ambiguous';
    end if;
  end if;

  insert into private.channel_actor_evidence (
    channel_event_id, resolution, person_id,
    organisation_contact_id, organisation_id
  ) values (
    new.id, outcome,
    case when outcome in ('worker', 'hirer') then owner_id end,
    case when outcome = 'hirer' then contact_id end,
    case when outcome = 'hirer' then organisation_id end
  );
  return new;
end;
$$;

create trigger channel_events_bind_actor
  after insert on public.channel_events
  for each row execute function private.capture_channel_actor_evidence();
