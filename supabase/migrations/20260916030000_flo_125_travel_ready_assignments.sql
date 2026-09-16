-- FLO-125: reporting logistics and travel-ready assignment coordination.

alter table public.assignments
  add column reporting_mode text,
  add column reporting_place_text text,
  add column reporting_at timestamptz,
  add column pickup_point_id uuid,
  add column location_pin jsonb,
  add column landmark text,
  add column instructions text,
  add column contact jsonb,
  add constraint assignments_reporting_mode_check
    check (reporting_mode is null or reporting_mode in ('site', 'pickup')),
  add constraint assignments_location_pin_check
    check (
      location_pin is null
      or (
        jsonb_typeof(location_pin) = 'object'
        and jsonb_typeof(location_pin -> 'lat') = 'number'
        and jsonb_typeof(location_pin -> 'lng') = 'number'
        and (location_pin ->> 'lat')::numeric between -90 and 90
        and (location_pin ->> 'lng')::numeric between -180 and 180
      )
    ),
  add constraint assignments_contact_check
    check (contact is null or jsonb_typeof(contact) = 'object');

create table public.assignment_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id),
  kind text not null check (kind in ('on_my_way')),
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  unique (assignment_id, kind)
);

alter table public.assignment_acknowledgements enable row level security;
revoke all on table public.assignment_acknowledgements from anon, authenticated;

create index assignment_acknowledgements_assignment_idx
  on public.assignment_acknowledgements(assignment_id, created_at);