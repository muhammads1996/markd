-- FLO-130: participant availability and contractor job projections.

alter table public.availability_signals
  add column note text check (note is null or char_length(note) <= 2000);

revoke select on table public.availability_signals from authenticated;
grant select (
  id, worker_id, available_from, available_to, status, note, version,
  created_at, archived_at
) on table public.availability_signals to authenticated;

create policy participant_worker_availability_signals_read
on public.availability_signals
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.participant_accounts as account
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    where account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and account.person_id = availability_signals.worker_id
      and scope.scope_kind = 'worker'
  )
);

create view public.participant_worker_availability
with (security_invoker = true) as
select
  availability.worker_id,
  availability.available_from as work_date,
  availability.status,
  availability.note,
  availability.version
from public.availability_signals as availability
where availability.archived_at is null
  and availability.available_to = availability.available_from;

revoke all on table public.participant_worker_availability from anon, authenticated;
grant select on table public.participant_worker_availability to authenticated;

revoke select (agreed_rate_cents, currency) on table public.assignments
  from authenticated;
revoke select (rate_cents, currency, rate_basis) on table public.labour_requests
  from authenticated;

drop view public.participant_worker_assignments;
create view public.participant_worker_assignments
with (security_invoker = true) as
select
  assignment.id as assignment_id,
  assignment.version as assignment_version,
  assignment.worker_id,
  assignment.lifecycle,
  assignment.worker_response,
  assignment.contractor_confirmation,
  assignment.offered_at,
  assignment.travel_authorised_at,
  assignment.reporting_mode,
  assignment.reporting_place_text as reporting_place,
  assignment.reporting_at,
  organisation.display_name as organisation_display_name,
  site.locality as site_locality,
  site.name as site_name,
  assignment.starts_on as work_date,
  coalesce(requirement.work_type, 'General labour') as work_type
from public.assignments as assignment
join public.labour_requests as labour_request
  on labour_request.id = assignment.labour_request_id
left join public.labour_requirements as requirement
  on requirement.id = assignment.labour_requirement_id
left join public.organisations as organisation
  on organisation.id = assignment.organisation_id
left join public.sites as site
  on site.id = assignment.site_id;

revoke all on table public.participant_worker_assignments from anon, authenticated;
grant select on table public.participant_worker_assignments to authenticated;

revoke select on table public.assignments, public.labour_requests,
  public.labour_requirements, public.organisations, public.sites,
  public.people, public.organisation_contacts from authenticated;

grant select (
  id, version, worker_id, lifecycle, worker_response, contractor_confirmation,
  offered_at, travel_authorised_at, reporting_mode, reporting_place_text,
  reporting_at, starts_on, labour_request_id, labour_requirement_id,
  organisation_id, site_id, archived_at
) on table public.assignments to authenticated;
grant select (id, needed_from, archived_at)
  on table public.labour_requests to authenticated;
grant select (id, labour_request_id, work_type, archived_at)
  on table public.labour_requirements to authenticated;
grant select (id, display_name, record_status, archived_at)
  on table public.organisations to authenticated;
grant select (id, organisation_id, name, locality, archived_at)
  on table public.sites to authenticated;
grant select (
  id, display_name, preferred_language_id, preferred_communication_mode, archived_at
) on table public.people to authenticated;
grant select (id, organisation_id, person_id, archived_at)
  on table public.organisation_contacts to authenticated;

create policy participant_contractor_contacts_source_read
on public.organisation_contacts
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.participant_accounts as account
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    where account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and scope.organisation_contact_id = organisation_contacts.id
      and account.person_id = organisation_contacts.person_id
  )
);

create policy participant_contractor_assignments_source_read
on public.assignments
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.participant_accounts as account
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    join public.organisation_contacts as contact
      on contact.id = scope.organisation_contact_id
    where account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and contact.archived_at is null
      and contact.person_id = account.person_id
      and contact.organisation_id = assignments.organisation_id
  )
);

create policy participant_contractor_labour_requests_source_read
on public.labour_requests
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.auth_user_id = (select auth.uid())
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    join public.organisation_contacts as contact
      on contact.id = scope.organisation_contact_id
    where assignment.labour_request_id = labour_requests.id
      and assignment.archived_at is null
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and contact.archived_at is null
      and contact.person_id = account.person_id
      and contact.organisation_id = assignment.organisation_id
  )
);

create policy participant_contractor_labour_requirements_source_read
on public.labour_requirements
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.auth_user_id = (select auth.uid())
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    join public.organisation_contacts as contact
      on contact.id = scope.organisation_contact_id
    where assignment.labour_requirement_id = labour_requirements.id
      and assignment.archived_at is null
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and contact.archived_at is null
      and contact.person_id = account.person_id
      and contact.organisation_id = assignment.organisation_id
  )
);

create policy participant_contractor_organisations_source_read
on public.organisations
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.auth_user_id = (select auth.uid())
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    join public.organisation_contacts as contact
      on contact.id = scope.organisation_contact_id
    where assignment.organisation_id = organisations.id
      and assignment.archived_at is null
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and contact.archived_at is null
      and contact.person_id = account.person_id
      and contact.organisation_id = assignment.organisation_id
  )
);

create policy participant_contractor_sites_source_read
on public.sites
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.auth_user_id = (select auth.uid())
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    join public.organisation_contacts as contact
      on contact.id = scope.organisation_contact_id
    where assignment.site_id = sites.id
      and assignment.archived_at is null
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and contact.archived_at is null
      and contact.person_id = account.person_id
      and contact.organisation_id = assignment.organisation_id
  )
);

create policy participant_contractor_workers_source_read
on public.people
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.auth_user_id = (select auth.uid())
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    join public.organisation_contacts as contact
      on contact.id = scope.organisation_contact_id
    where assignment.worker_id = people.id
      and assignment.archived_at is null
      and account.status = 'active'
      and scope.scope_kind = 'contractor'
      and contact.archived_at is null
      and contact.person_id = account.person_id
      and contact.organisation_id = assignment.organisation_id
  )
);

create view public.participant_contractor_assignments
with (security_invoker = true) as
select
  assignment.id as assignment_id,
  assignment.version,
  assignment.worker_id,
  worker.display_name as worker_display_name,
  assignment.lifecycle,
  assignment.worker_response,
  assignment.contractor_confirmation,
  assignment.offered_at,
  assignment.travel_authorised_at,
  assignment.reporting_mode,
  assignment.reporting_place_text as reporting_place,
  assignment.reporting_at,
  assignment.starts_on as work_date,
  coalesce(requirement.work_type, 'General labour') as work_type
from public.assignments as assignment
join public.labour_requests as labour_request
  on labour_request.id = assignment.labour_request_id
left join public.labour_requirements as requirement
  on requirement.id = assignment.labour_requirement_id
join public.people as worker
  on worker.id = assignment.worker_id;

revoke all on table public.participant_contractor_assignments from anon, authenticated;
grant select on table public.participant_contractor_assignments to authenticated;