-- FLO-130: worker-facing assignment projection. The projection is invoker
-- secured so its source-table RLS and column privileges remain effective.

revoke select on table public.assignments, public.labour_requests,
  public.labour_requirements, public.organisations, public.sites from authenticated;

grant select (
  id, version, worker_id, lifecycle, worker_response, contractor_confirmation,
  offered_at, travel_authorised_at, reporting_mode, reporting_place_text,
  reporting_at, organisation_id, site_id, labour_request_id,
  labour_requirement_id, agreed_rate_cents, currency, starts_on
) on table public.assignments to authenticated;
grant select (
  id, needed_from, rate_cents, currency, rate_basis
) on table public.labour_requests to authenticated;
grant select (id, labour_request_id, work_type)
  on table public.labour_requirements to authenticated;
grant select (id, display_name) on table public.organisations to authenticated;
grant select (id, locality, name) on table public.sites to authenticated;

create policy participant_worker_assignments_source_read
on public.assignments
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
      and account.person_id = assignments.worker_id
      and scope.scope_kind = 'worker'
  )
);

create policy participant_worker_labour_requests_source_read
on public.labour_requests
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.person_id = assignment.worker_id
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    where assignment.labour_request_id = labour_requests.id
      and assignment.archived_at is null
      and account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and scope.scope_kind = 'worker'
  )
);

create policy participant_worker_labour_requirements_source_read
on public.labour_requirements
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.person_id = assignment.worker_id
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    where assignment.labour_requirement_id = labour_requirements.id
      and assignment.archived_at is null
      and account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and scope.scope_kind = 'worker'
  )
);

create policy participant_worker_organisations_source_read
on public.organisations
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.person_id = assignment.worker_id
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    where assignment.organisation_id = organisations.id
      and assignment.archived_at is null
      and account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and scope.scope_kind = 'worker'
  )
);

create policy participant_worker_sites_source_read
on public.sites
for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.assignments as assignment
    join public.participant_accounts as account
      on account.person_id = assignment.worker_id
    join public.participant_account_scopes as scope
      on scope.auth_user_id = account.auth_user_id
    where assignment.site_id = sites.id
      and assignment.archived_at is null
      and account.auth_user_id = (select auth.uid())
      and account.status = 'active'
      and scope.scope_kind = 'worker'
  )
);

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
  assignment.agreed_rate_cents as assignment_rate_cents,
  assignment.currency as assignment_currency,
  labour_request.rate_cents as request_rate_cents,
  labour_request.currency as request_currency,
  labour_request.rate_basis,
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