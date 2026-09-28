-- FLO-136: activation, audit and revocation policy.
alter table public.participant_accounts
  add column activation_requested_at timestamptz;

create table public.participant_account_events (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.participant_accounts(auth_user_id),
  person_id uuid not null references public.people(id),
  event_kind text not null check (event_kind in (
    'provisioned', 'activated', 'disabled', 'scope_added'
  )),
  scope_kind public.participant_scope_kind,
  organisation_contact_id uuid references public.organisation_contacts(id),
  actor_auth_user_id uuid references auth.users(id),
  occurred_at timestamptz not null default timezone('utc', now())
);

create index participant_account_events_account_time_idx
  on public.participant_account_events(auth_user_id, occurred_at desc);

create function public.record_participant_account_event()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare mapped_person_id uuid;
begin
  if tg_table_name = 'participant_accounts' then
    if tg_op = 'INSERT' then
      insert into public.participant_account_events(
        auth_user_id, person_id, event_kind, actor_auth_user_id
      ) values (
        new.auth_user_id, new.person_id, 'provisioned', auth.uid()
      );
    elsif new.status is distinct from old.status then
      insert into public.participant_account_events(
        auth_user_id, person_id, event_kind, actor_auth_user_id
      ) values (
        new.auth_user_id, new.person_id,
        case when new.status = 'disabled' then 'disabled' else 'activated' end,
        auth.uid()
      );
    end if;
  elsif tg_op = 'INSERT' then
    select person_id into mapped_person_id from public.participant_accounts
      where auth_user_id = new.auth_user_id;
    insert into public.participant_account_events(
      auth_user_id, person_id, event_kind, scope_kind,
      organisation_contact_id, actor_auth_user_id
    ) values (
      new.auth_user_id, mapped_person_id, 'scope_added', new.scope_kind,
      new.organisation_contact_id, auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_participant_account_event() from public;

create trigger participant_account_event
after insert or update of status on public.participant_accounts
for each row execute function public.record_participant_account_event();

create trigger participant_scope_event
after insert on public.participant_account_scopes
for each row execute function public.record_participant_account_event();

create function public.activate_participant_account()
returns boolean language plpgsql security definer
set search_path = pg_catalog, public as $$
declare account public.participant_accounts;
begin
  select * into account from public.participant_accounts
    where auth_user_id = auth.uid() for update;
  if not found or account.status = 'disabled'
      or account.activation_requested_at is null then
    return false;
  end if;
  if not exists (
    select 1 from auth.users as auth_user
    join public.person_phone_numbers as phone
      on phone.person_id = account.person_id
     and ltrim(phone.phone_number, '+') = ltrim(auth_user.phone, '+')
     and phone.is_primary
     and phone.archived_at is null
    where auth_user.id = account.auth_user_id
      and auth_user.phone_confirmed_at is not null
      and auth_user.last_sign_in_at >= account.activation_requested_at
  ) then
    return false;
  end if;
  if account.status = 'pending' then
    update public.participant_accounts set status = 'active'
      where auth_user_id = account.auth_user_id;
  end if;
  return true;
end;
$$;

revoke all on function public.activate_participant_account() from public;
grant execute on function public.activate_participant_account() to authenticated;

-- A changed or retired canonical number revokes the bound PWA credential.
-- WhatsApp participation and the Person/Work Graph record are untouched.
create function public.disable_participant_account_on_phone_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' or new.phone_number is distinct from old.phone_number
      or (old.is_primary and not new.is_primary)
      or (old.archived_at is null and new.archived_at is not null) then
    update public.participant_accounts as account
      set status = 'disabled'
      from auth.users as auth_user
      where account.person_id = old.person_id
        and account.auth_user_id = auth_user.id
        and ltrim(auth_user.phone, '+') = ltrim(old.phone_number, '+')
        and account.status <> 'disabled';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.disable_participant_account_on_phone_change() from public;

create trigger participant_account_phone_change
after update of phone_number, is_primary, archived_at or delete on public.person_phone_numbers
for each row execute function public.disable_participant_account_on_phone_change();

alter table public.participant_account_events enable row level security;
revoke all on public.participant_account_events from anon, authenticated;
grant select on public.participant_account_events to authenticated;
create policy participant_account_events_admin_read
  on public.participant_account_events for select to authenticated
  using ((select public.is_ops_admin()));
