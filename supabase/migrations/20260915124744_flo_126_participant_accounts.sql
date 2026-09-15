-- FLO-126: narrow auth mappings for participant entry and scope resolution.
-- Participant access to Work Graph records remains deferred; these tables only
-- answer which participant identity and scope an authenticated user owns.

create type public.participant_account_status as enum ('active', 'disabled');
create type public.participant_scope_kind as enum ('worker', 'contractor');

create table public.participant_accounts (
	auth_user_id uuid primary key references auth.users(id) on delete restrict,
	person_id uuid not null unique references public.people(id) on delete restrict,
	status public.participant_account_status not null default 'active',
	created_at timestamptz not null default timezone('utc', now()),
	updated_at timestamptz not null default timezone('utc', now())
);

create trigger participant_accounts_updated_at
before update on public.participant_accounts
for each row execute function public.set_updated_at();

create table public.participant_account_scopes (
	id uuid primary key default gen_random_uuid(),
	auth_user_id uuid not null references public.participant_accounts(auth_user_id) on delete cascade,
	scope_kind public.participant_scope_kind not null,
	organisation_contact_id uuid references public.organisation_contacts(id) on delete restrict,
	created_at timestamptz not null default timezone('utc', now()),
	constraint participant_account_scopes_kind_contact_check check (
		(scope_kind = 'worker' and organisation_contact_id is null)
		or (scope_kind = 'contractor' and organisation_contact_id is not null)
	)
);

create unique index participant_account_scopes_one_worker_key
on public.participant_account_scopes(auth_user_id)
where scope_kind = 'worker';

create unique index participant_account_scopes_contractor_contact_key
on public.participant_account_scopes(auth_user_id, organisation_contact_id)
where scope_kind = 'contractor';

create index participant_account_scopes_auth_user_id_idx
on public.participant_account_scopes(auth_user_id);

create index participant_account_scopes_organisation_contact_id_idx
on public.participant_account_scopes(organisation_contact_id)
where organisation_contact_id is not null;

create function public.validate_participant_account_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
	mapped_person_id uuid;
begin
	select account.person_id
	into mapped_person_id
	from public.participant_accounts as account
	where account.auth_user_id = new.auth_user_id;

	if mapped_person_id is null then
		raise exception 'participant scope requires an account mapping';
	end if;

	if new.scope_kind = 'worker' then
		if not exists (
			select 1
			from public.worker_profiles as worker
			where worker.person_id = mapped_person_id
				and worker.archived_at is null
		) then
			raise exception 'worker scope requires an active worker profile';
		end if;
	elsif not exists (
		select 1
		from public.organisation_contacts as contact
		where contact.id = new.organisation_contact_id
			and contact.person_id = mapped_person_id
			and contact.archived_at is null
	) then
		raise exception 'contractor scope requires an active organisation contact for the mapped person';
	end if;

	return new;
end;
$$;

revoke all on function public.validate_participant_account_scope() from public;

create trigger participant_account_scopes_validate
before insert or update on public.participant_account_scopes
for each row execute function public.validate_participant_account_scope();

alter table public.participant_accounts enable row level security;
alter table public.participant_account_scopes enable row level security;

revoke all on table public.participant_accounts from anon, authenticated;
revoke all on table public.participant_account_scopes from anon, authenticated;
grant select on table public.participant_accounts to authenticated;
grant select on table public.participant_account_scopes to authenticated;

create policy participant_accounts_owner_read
on public.participant_accounts
for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy participant_account_scopes_owner_read
on public.participant_account_scopes
for select to authenticated
using (auth_user_id = (select auth.uid()));
