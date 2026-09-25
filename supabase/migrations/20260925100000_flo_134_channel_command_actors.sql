-- A verified inbound channel event can be a command principal without an
-- auth.users/browser account.  The person/contact are resolved at intake;
-- the event, not a mutable phone number, scopes replay and audit identity.
alter table private.command_executions
  alter column actor_user_id drop not null,
  add column actor_person_id uuid references public.people(id),
  add column actor_organisation_contact_id uuid references public.organisation_contacts(id),
  add column source_channel_event_id uuid references public.channel_events(id),
  add constraint command_executions_actor_boundary check (
    (actor_user_id is not null and source_channel_event_id is null
      and actor_person_id is null and actor_organisation_contact_id is null)
    or
    (actor_user_id is null and source_channel_event_id is not null
      and actor_person_id is not null)
  );

create unique index command_executions_channel_replay_key
  on private.command_executions(source_channel_event_id, idempotency_key)
  where source_channel_event_id is not null;

alter table private.domain_events
  add column actor_person_id uuid references public.people(id),
  add column actor_organisation_contact_id uuid references public.organisation_contacts(id);
