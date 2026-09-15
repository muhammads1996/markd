-- FLO-106 / FLO-107: onboarding, controlled graph edits, search, and safe projections.

create type public.record_status as enum ('draft', 'active', 'inactive');

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  locality text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  unique (name, locality)
);

alter table public.worker_profiles
  add column record_status public.record_status not null default 'active',
  add column base_area_id uuid references public.areas(id),
  add column created_by_operator_id uuid references public.operator_accounts(user_id);
alter table public.organisations
  add column record_status public.record_status not null default 'active';

create table public.worker_participation_preferences (
  worker_id uuid primary key references public.worker_profiles(person_id),
  read_aloud_enabled boolean not null default false,
  app_participation text not null default 'unknown'
    check (app_participation in ('unknown', 'whatsapp_only', 'interested', 'using')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create table public.worker_area_preferences (
  worker_id uuid not null references public.worker_profiles(person_id),
  area_id uuid not null references public.areas(id),
  is_familiar boolean not null default true,
  willing_to_travel boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  primary key (worker_id, area_id),
  check (is_familiar or willing_to_travel)
);
create table public.worker_primary_skills (
  worker_id uuid not null references public.worker_profiles(person_id),
  skill_id uuid not null references public.skills(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  primary key (worker_id, skill_id)
);
create table public.organisation_operating_areas (
  organisation_id uuid not null references public.organisations(id),
  area_id uuid not null references public.areas(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  primary key (organisation_id, area_id)
);
create table public.organisation_typical_skills (
  organisation_id uuid not null references public.organisations(id),
  skill_id uuid not null references public.skills(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  primary key (organisation_id, skill_id)
);
create unique index worker_media_assets_one_active_portrait_per_worker_key
  on public.worker_media_assets(worker_id) where archived_at is null and media_kind = 'portrait';
create index worker_profiles_active_base_area_idx on public.worker_profiles(base_area_id)
  where archived_at is null and record_status = 'active';
create index worker_area_preferences_active_area_idx on public.worker_area_preferences(area_id) where archived_at is null;
create index worker_primary_skills_active_skill_idx on public.worker_primary_skills(skill_id) where archived_at is null;
create index organisation_operating_areas_active_area_idx on public.organisation_operating_areas(area_id) where archived_at is null;
create index organisation_typical_skills_active_skill_idx on public.organisation_typical_skills(skill_id) where archived_at is null;

create trigger areas_updated_at before update on public.areas for each row execute function public.set_updated_at();
create trigger worker_participation_preferences_updated_at before update on public.worker_participation_preferences for each row execute function public.set_updated_at();
create trigger worker_area_preferences_updated_at before update on public.worker_area_preferences for each row execute function public.set_updated_at();
create trigger worker_primary_skills_updated_at before update on public.worker_primary_skills for each row execute function public.set_updated_at();
create trigger organisation_operating_areas_updated_at before update on public.organisation_operating_areas for each row execute function public.set_updated_at();
create trigger organisation_typical_skills_updated_at before update on public.organisation_typical_skills for each row execute function public.set_updated_at();

-- Drafts/inactive records are not cards and must not enter ordinary discovery.
drop view public.operator_work_cards;
create view public.operator_work_cards with (security_invoker = true) as
select worker.person_id as worker_id, person.display_name, worker.preferred_name,
  portrait.object_path as portrait_object_path,
  count(distinct workmark.id) filter (where workmark.lifecycle = 'confirmed' and workmark.archived_at is null)::integer as confirmed_workmark_count,
  max(workmark.work_ended_on) filter (where workmark.lifecycle = 'confirmed' and workmark.archived_at is null) as last_confirmed_worked_on
from public.worker_profiles worker
join public.people person on person.id = worker.person_id
left join public.worker_media_assets portrait on portrait.worker_id = worker.person_id and portrait.bucket_id = 'worker-portraits' and portrait.archived_at is null
left join public.workmarks workmark on workmark.worker_id = worker.person_id
where worker.archived_at is null and worker.record_status = 'active' and person.archived_at is null
group by worker.person_id, person.display_name, worker.preferred_name, portrait.object_path;

alter table public.areas enable row level security;
alter table public.worker_participation_preferences enable row level security;
alter table public.worker_area_preferences enable row level security;
alter table public.worker_primary_skills enable row level security;
alter table public.organisation_operating_areas enable row level security;
alter table public.organisation_typical_skills enable row level security;
revoke all on table public.areas, public.worker_participation_preferences, public.worker_area_preferences, public.worker_primary_skills,
  public.organisation_operating_areas, public.organisation_typical_skills from anon, authenticated;
grant select on table public.areas, public.worker_participation_preferences, public.worker_area_preferences, public.worker_primary_skills,
  public.organisation_operating_areas, public.organisation_typical_skills to authenticated;
create policy areas_operator_read on public.areas for select to authenticated using ((select public.is_active_operator()));
grant insert, update on table public.areas to authenticated;
create policy areas_admin_insert on public.areas for insert to authenticated with check ((select public.is_ops_admin()));
create policy areas_admin_update on public.areas for update to authenticated using ((select public.is_ops_admin())) with check ((select public.is_ops_admin()));
create policy worker_participation_preferences_operator_read on public.worker_participation_preferences for select to authenticated using ((select public.is_active_operator()));
create policy worker_area_preferences_operator_read on public.worker_area_preferences for select to authenticated using ((select public.is_active_operator()));
create policy worker_primary_skills_operator_read on public.worker_primary_skills for select to authenticated using ((select public.is_active_operator()));
create policy organisation_operating_areas_operator_read on public.organisation_operating_areas for select to authenticated using ((select public.is_active_operator()));
create policy organisation_typical_skills_operator_read on public.organisation_typical_skills for select to authenticated using ((select public.is_active_operator()));

create function public.begin_worker_onboarding(requested_worker_id uuid, payload jsonb)
returns table(worker_id uuid, portrait_asset_id uuid, bucket_id text, object_path text)
language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare
  selected_worker_id uuid := coalesce(requested_worker_id, gen_random_uuid());
  selected_asset_id uuid;
  selected_path text;
  selected_language_id uuid;
  selected_skill_id uuid;
  selected_area_id uuid;
  familiar_area_ids uuid[] := '{}'::uuid[];
  willing_to_travel_area_ids uuid[] := '{}'::uuid[];
  candidate_phone text := nullif(trim(payload ->> 'phone_number'), '');
  candidate_area_id uuid := nullif(payload ->> 'base_area_id', '')::uuid;
  candidate_language_id uuid := nullif(payload ->> 'preferred_language_id', '')::uuid;
  candidate_mode text := coalesce(nullif(payload ->> 'preferred_communication_mode', ''), 'call');
  candidate_app text := coalesce(nullif(payload ->> 'app_participation', ''), 'unknown');
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to onboard a worker'; end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'worker onboarding payload must be an object'; end if;
  if candidate_phone is null or candidate_phone !~ '^\+[1-9][0-9]{1,14}$' then raise exception 'worker onboarding requires a normalised E.164 phone number'; end if;
  if candidate_mode not in ('text', 'voice', 'call') then raise exception 'preferred communication mode is invalid'; end if;
  if candidate_app not in ('unknown', 'whatsapp_only', 'interested', 'using') then raise exception 'app participation is invalid'; end if;
  if candidate_area_id is not null and not exists (select 1 from public.areas a where a.id = candidate_area_id and a.archived_at is null) then raise exception 'base area must be active'; end if;
  if candidate_language_id is not null and not exists (select 1 from public.languages l where l.id = candidate_language_id and l.archived_at is null) then raise exception 'preferred language must be active'; end if;
  if jsonb_typeof(coalesce(payload -> 'language_ids', '[]')) <> 'array' or jsonb_typeof(coalesce(payload -> 'skill_ids', '[]')) <> 'array' or jsonb_typeof(coalesce(payload -> 'familiar_area_ids', '[]')) <> 'array' or jsonb_typeof(coalesce(payload -> 'willing_to_travel_area_ids', '[]')) <> 'array' then raise exception 'worker language, skill, and area selections must be arrays'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'language_ids', '[]')) s(value) left join public.languages l on l.id = s.value::uuid and l.archived_at is null where l.id is null) then raise exception 'all selected languages must be active'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'skill_ids', '[]')) s(value) left join public.skills s2 on s2.id = s.value::uuid and s2.archived_at is null where s2.id is null) then raise exception 'all selected skills must be active'; end if;
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into familiar_area_ids from jsonb_array_elements_text(coalesce(payload -> 'familiar_area_ids', '[]'));
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into willing_to_travel_area_ids from jsonb_array_elements_text(coalesce(payload -> 'willing_to_travel_area_ids', '[]'));
  if exists (select 1 from unnest(familiar_area_ids || willing_to_travel_area_ids) s(id) left join public.areas a on a.id = s.id and a.archived_at is null where a.id is null) then raise exception 'all worker area preferences must reference active areas'; end if;
  if exists (select 1 from public.person_phone_numbers p where p.phone_number = candidate_phone and p.archived_at is null and p.person_id <> selected_worker_id) then raise exception 'phone number is already linked to another active person'; end if;
  if exists (select 1 from public.worker_profiles w where w.person_id = selected_worker_id) then
    if not exists (select 1 from public.worker_profiles w where w.person_id = selected_worker_id and w.record_status = 'draft' and w.archived_at is null) then raise exception 'worker onboarding can only resume a live draft'; end if;
  else
    insert into public.people(id, display_name, given_name, family_name, preferred_language_id, preferred_communication_mode)
    values (selected_worker_id, coalesce(nullif(trim(payload ->> 'display_name'), ''), 'Draft worker'), nullif(trim(payload ->> 'given_name'), ''), nullif(trim(payload ->> 'family_name'), ''), candidate_language_id, candidate_mode);
    insert into public.worker_profiles(person_id, preferred_name, base_area_id, record_status, created_by_operator_id)
    values (selected_worker_id, nullif(trim(payload ->> 'preferred_name'), ''), candidate_area_id, 'draft', auth.uid());
  end if;
  update public.people p set display_name = coalesce(nullif(trim(payload ->> 'display_name'), ''), p.display_name),
    preferred_language_id = coalesce(candidate_language_id, p.preferred_language_id), preferred_communication_mode = candidate_mode where p.id = selected_worker_id;
  update public.worker_profiles w set preferred_name = coalesce(nullif(trim(payload ->> 'preferred_name'), ''), w.preferred_name), base_area_id = coalesce(candidate_area_id, w.base_area_id) where w.person_id = selected_worker_id;
  update public.person_phone_numbers p set is_primary = false where p.person_id = selected_worker_id and p.archived_at is null and p.phone_number <> candidate_phone;
  insert into public.person_phone_numbers(person_id, phone_number, is_primary) values (selected_worker_id, candidate_phone, true)
  on conflict (phone_number) where archived_at is null do update set is_primary = true;
  for selected_language_id in select value::uuid from jsonb_array_elements_text(coalesce(payload -> 'language_ids', '[]')) loop
    insert into public.person_languages(person_id, language_id) values (selected_worker_id, selected_language_id) on conflict (person_id, language_id) do update set archived_at = null;
  end loop;
  if candidate_language_id is not null then insert into public.person_languages(person_id, language_id) values (selected_worker_id, candidate_language_id) on conflict (person_id, language_id) do update set archived_at = null; end if;
  for selected_skill_id in select value::uuid from jsonb_array_elements_text(coalesce(payload -> 'skill_ids', '[]')) loop
    insert into public.worker_primary_skills(worker_id, skill_id) values (selected_worker_id, selected_skill_id)
    on conflict (worker_id, skill_id) do update set archived_at = null;
    insert into public.worker_skill_evidence(worker_id, skill_id, source)
    select selected_worker_id, selected_skill_id, 'operator_onboarding'
    where not exists (select 1 from public.worker_skill_evidence e where e.worker_id = selected_worker_id and e.skill_id = selected_skill_id and e.source = 'operator_onboarding');
  end loop;
  update public.worker_primary_skills s set archived_at = timezone('utc', now())
  where s.worker_id = selected_worker_id and s.archived_at is null
    and not exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'skill_ids', '[]')) selected(value) where selected.value::uuid = s.skill_id);
  insert into public.worker_participation_preferences(worker_id, read_aloud_enabled, app_participation)
  values (selected_worker_id, coalesce((payload ->> 'read_aloud_enabled')::boolean, false), candidate_app)
  on conflict (worker_id) do update set read_aloud_enabled = excluded.read_aloud_enabled, app_participation = excluded.app_participation;
  for selected_area_id in select area_id from (select unnest(familiar_area_ids) as area_id union select unnest(willing_to_travel_area_ids)) areas loop
    insert into public.worker_area_preferences(worker_id, area_id, is_familiar, willing_to_travel)
    values (selected_worker_id, selected_area_id, selected_area_id = any(familiar_area_ids), selected_area_id = any(willing_to_travel_area_ids))
    on conflict (worker_id, area_id) do update set is_familiar = excluded.is_familiar, willing_to_travel = excluded.willing_to_travel, archived_at = null;
  end loop;
  select a.id, a.object_path into selected_asset_id, selected_path from public.worker_media_assets a
  where a.worker_id = selected_worker_id and a.media_kind = 'portrait' and a.archived_at is null;
  if selected_asset_id is null then
    selected_asset_id := gen_random_uuid(); selected_path := format('workers/%s/portrait-%s.jpg', selected_worker_id, selected_asset_id);
    insert into public.worker_media_assets(id, worker_id, bucket_id, object_path, media_kind) values (selected_asset_id, selected_worker_id, 'worker-portraits', selected_path, 'portrait');
  end if;
  return query select selected_worker_id, selected_asset_id, 'worker-portraits'::text, selected_path;
end;
$$;

create function public.complete_worker_onboarding(worker_id uuid, portrait_asset_id uuid, object_path text, target_status text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to complete worker onboarding'; end if;
  if target_status not in ('active', 'inactive') then raise exception 'worker target status must be active or inactive'; end if;
  if not exists (select 1 from public.worker_profiles w where w.person_id = $1 and w.record_status = 'draft' and w.archived_at is null) then raise exception 'only a live draft worker can be completed'; end if;
  if target_status = 'active' and (
    not exists (select 1 from public.people p where p.id = $1 and length(trim(p.display_name)) > 0 and p.preferred_language_id is not null)
    or not exists (select 1 from public.person_phone_numbers p where p.person_id = $1 and p.is_primary and p.archived_at is null)
    or not exists (select 1 from public.person_languages l where l.person_id = $1 and l.archived_at is null)
    or not exists (select 1 from public.worker_profiles w join public.areas a on a.id = w.base_area_id where w.person_id = $1 and a.archived_at is null)
    or not exists (select 1 from public.worker_skill_evidence e where e.worker_id = $1 and e.source = 'operator_onboarding')
    or not exists (select 1 from public.worker_media_assets a join storage.objects o on o.bucket_id = a.bucket_id and o.name = a.object_path where a.id = $2 and a.worker_id = $1 and a.media_kind = 'portrait' and a.object_path = $3 and a.archived_at is null)
  ) then raise exception 'active worker onboarding requires name, phone, language, base area, onboarding skill, and uploaded portrait'; end if;
  update public.worker_profiles set record_status = $4::public.record_status where person_id = $1;
  return $1;
end;
$$;

create function public.cancel_worker_onboarding(worker_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to cancel worker onboarding'; end if;
  if not exists (select 1 from public.worker_profiles w where w.person_id = $1 and w.record_status = 'draft' and w.archived_at is null) then raise exception 'only a live draft worker can be cancelled'; end if;
  update public.worker_profiles set archived_at = timezone('utc', now()) where person_id = $1;
  update public.people set archived_at = timezone('utc', now()) where id = $1;
  update public.person_phone_numbers set archived_at = timezone('utc', now()) where person_id = $1 and archived_at is null;
  update public.person_languages set archived_at = timezone('utc', now()) where person_id = $1 and archived_at is null;
  update public.worker_media_assets set archived_at = timezone('utc', now()) where worker_id = $1 and archived_at is null;
  return $1;
end;
$$;

create function public.onboard_organisation(legal_name text, display_name text, contact_display_name text, contact_phone_number text default null, contact_role_name text default null, operating_area_ids uuid[] default '{}'::uuid[], typical_skill_ids uuid[] default '{}'::uuid[], record_status text default 'active')
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare organisation_id uuid; contact_person_id uuid; area_id uuid; skill_id uuid; candidate_phone text := nullif(trim(contact_phone_number), '');
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to onboard an organisation'; end if;
  if legal_name is null or length(trim(legal_name)) = 0 or display_name is null or length(trim(display_name)) = 0 or contact_display_name is null or length(trim(contact_display_name)) = 0 then raise exception 'organisation and primary contact names are required'; end if;
  if candidate_phone is not null and candidate_phone !~ '^\+[1-9][0-9]{1,14}$' then raise exception 'phone number must be normalised E.164'; end if;
  if $8 not in ('draft', 'active', 'inactive') then raise exception 'record status must be draft, active, or inactive'; end if;
  if exists (select 1 from unnest(coalesce(operating_area_ids, '{}'::uuid[])) s(id) left join public.areas a on a.id = s.id and a.archived_at is null where a.id is null) then raise exception 'all operating areas must be active'; end if;
  if exists (select 1 from unnest(coalesce(typical_skill_ids, '{}'::uuid[])) s(id) left join public.skills k on k.id = s.id and k.archived_at is null where k.id is null) then raise exception 'all typical skills must be active'; end if;
  if candidate_phone is not null and exists (select 1 from public.person_phone_numbers p where p.phone_number = candidate_phone and p.archived_at is null) then raise exception 'phone number is already linked to another active person'; end if;
  insert into public.organisations(legal_name, display_name, record_status) values (trim(legal_name), trim(display_name), $8::public.record_status) returning id into organisation_id;
  insert into public.people(display_name) values (trim(contact_display_name)) returning id into contact_person_id;
  insert into public.organisation_contacts(organisation_id, person_id, role_name, is_primary) values (organisation_id, contact_person_id, nullif(trim(contact_role_name), ''), true);
  if candidate_phone is not null then insert into public.person_phone_numbers(person_id, phone_number, is_primary) values (contact_person_id, candidate_phone, true); end if;
  foreach area_id in array coalesce(operating_area_ids, '{}'::uuid[]) loop insert into public.organisation_operating_areas(organisation_id, area_id) values (organisation_id, area_id) on conflict (organisation_id, area_id) do update set archived_at = null; end loop;
  foreach skill_id in array coalesce(typical_skill_ids, '{}'::uuid[]) loop insert into public.organisation_typical_skills(organisation_id, skill_id) values (organisation_id, skill_id) on conflict (organisation_id, skill_id) do update set archived_at = null; end loop;
  return organisation_id;
end;
$$;

-- The edit commands validate all references and duplicate phones before their
-- first write. Skill evidence remains additive; it is provenance, not a
-- replaceable profile tag.
create function public.update_worker_record(worker_id uuid, payload jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare candidate_phone text; candidate_area_id uuid; candidate_language_id uuid; candidate_mode text; candidate_status text; candidate_app text; selected_id uuid; selected_area_id uuid; preference jsonb; familiar_area_ids uuid[]; willing_to_travel_area_ids uuid[];
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to edit a worker'; end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'worker update payload must be an object'; end if;
  if not exists (select 1 from public.worker_profiles w where w.person_id = $1 and w.archived_at is null) then raise exception 'worker record was not found'; end if;
  candidate_phone := case when payload ? 'phone_number' then nullif(trim(payload ->> 'phone_number'), '') end;
  candidate_area_id := case when payload ? 'base_area_id' then nullif(payload ->> 'base_area_id', '')::uuid end;
  candidate_language_id := case when payload ? 'preferred_language_id' then nullif(payload ->> 'preferred_language_id', '')::uuid end;
  candidate_mode := case when payload ? 'preferred_communication_mode' then nullif(payload ->> 'preferred_communication_mode', '') end;
  candidate_status := case when payload ? 'record_status' then nullif(payload ->> 'record_status', '') end;
  candidate_app := case when payload ? 'app_participation' then nullif(payload ->> 'app_participation', '') end;
  if payload ? 'display_name' and length(trim(coalesce(payload ->> 'display_name', ''))) = 0 then raise exception 'display name cannot be empty'; end if;
  if payload ? 'phone_number' and candidate_phone is null then raise exception 'worker phone number cannot be empty'; end if;
  if candidate_phone is not null and candidate_phone !~ '^\+[1-9][0-9]{1,14}$' then raise exception 'phone number must be normalised E.164'; end if;
  if candidate_mode is not null and candidate_mode not in ('text', 'voice', 'call') then raise exception 'preferred communication mode is invalid'; end if;
  if candidate_status is not null and candidate_status not in ('draft', 'active', 'inactive') then raise exception 'record status is invalid'; end if;
  if candidate_app is not null and candidate_app not in ('unknown', 'whatsapp_only', 'interested', 'using') then raise exception 'app participation is invalid'; end if;
  if candidate_status = 'active' and exists (select 1 from public.worker_profiles w where w.person_id = $1 and w.record_status = 'draft') then raise exception 'complete draft onboarding before activating a worker'; end if;
  if candidate_area_id is not null and not exists (select 1 from public.areas a where a.id = candidate_area_id and a.archived_at is null) then raise exception 'base area must be active'; end if;
  if candidate_language_id is not null and not exists (select 1 from public.languages l where l.id = candidate_language_id and l.archived_at is null) then raise exception 'preferred language must be active'; end if;
  if jsonb_typeof(coalesce(payload -> 'language_ids', '[]')) <> 'array' or jsonb_typeof(coalesce(payload -> 'skill_ids', '[]')) <> 'array' or (payload ? 'familiar_area_ids' and jsonb_typeof(payload -> 'familiar_area_ids') <> 'array') or (payload ? 'willing_to_travel_area_ids' and jsonb_typeof(payload -> 'willing_to_travel_area_ids') <> 'array') then raise exception 'worker selections must be arrays'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'language_ids', '[]')) s(value) left join public.languages l on l.id = s.value::uuid and l.archived_at is null where l.id is null) then raise exception 'all selected languages must be active'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'skill_ids', '[]')) s(value) left join public.skills k on k.id = s.value::uuid and k.archived_at is null where k.id is null) then raise exception 'all selected skills must be active'; end if;
  if payload ? 'familiar_area_ids' then select coalesce(array_agg(value::uuid), '{}'::uuid[]) into familiar_area_ids from jsonb_array_elements_text(payload -> 'familiar_area_ids'); end if;
  if payload ? 'willing_to_travel_area_ids' then select coalesce(array_agg(value::uuid), '{}'::uuid[]) into willing_to_travel_area_ids from jsonb_array_elements_text(payload -> 'willing_to_travel_area_ids'); end if;
  if exists (select 1 from unnest(coalesce(familiar_area_ids, '{}'::uuid[]) || coalesce(willing_to_travel_area_ids, '{}'::uuid[])) s(id) left join public.areas a on a.id = s.id and a.archived_at is null where a.id is null) then raise exception 'all worker area preferences must reference active areas'; end if;
  if candidate_phone is not null and exists (select 1 from public.person_phone_numbers p where p.phone_number = candidate_phone and p.archived_at is null and p.person_id <> $1) then raise exception 'phone number is already linked to another active person'; end if;
  update public.people p set display_name = case when payload ? 'display_name' then trim(payload ->> 'display_name') else p.display_name end,
    preferred_language_id = coalesce(candidate_language_id, p.preferred_language_id), preferred_communication_mode = coalesce(candidate_mode, p.preferred_communication_mode) where p.id = $1;
  update public.worker_profiles w set preferred_name = case when payload ? 'preferred_name' then nullif(trim(payload ->> 'preferred_name'), '') else w.preferred_name end,
    base_area_id = coalesce(candidate_area_id, w.base_area_id), record_status = coalesce(candidate_status::public.record_status, w.record_status) where w.person_id = $1;
  if candidate_phone is not null then update public.person_phone_numbers p set is_primary = false where p.person_id = $1 and p.archived_at is null and p.phone_number <> candidate_phone;
    insert into public.person_phone_numbers(person_id, phone_number, is_primary) values ($1, candidate_phone, true) on conflict (phone_number) where archived_at is null do update set is_primary = true; end if;
  if payload ? 'language_ids' then
    update public.person_languages l set archived_at = timezone('utc', now()) where l.person_id = $1 and l.archived_at is null and not exists (select 1 from jsonb_array_elements_text(payload -> 'language_ids') s(value) where s.value::uuid = l.language_id);
    for selected_id in select value::uuid from jsonb_array_elements_text(payload -> 'language_ids') loop insert into public.person_languages(person_id, language_id) values ($1, selected_id) on conflict (person_id, language_id) do update set archived_at = null; end loop;
  end if;
  if candidate_language_id is not null then insert into public.person_languages(person_id, language_id) values ($1, candidate_language_id) on conflict (person_id, language_id) do update set archived_at = null; end if;
  if payload ? 'skill_ids' then
    update public.worker_primary_skills s set archived_at = timezone('utc', now()) where s.worker_id = $1 and s.archived_at is null and not exists (select 1 from jsonb_array_elements_text(payload -> 'skill_ids') selected(value) where selected.value::uuid = s.skill_id);
    for selected_id in select value::uuid from jsonb_array_elements_text(payload -> 'skill_ids') loop
      insert into public.worker_primary_skills(worker_id, skill_id) values ($1, selected_id) on conflict (worker_id, skill_id) do update set archived_at = null;
      insert into public.worker_skill_evidence(worker_id, skill_id, source) select $1, selected_id, 'operator_onboarding' where not exists (select 1 from public.worker_skill_evidence e where e.worker_id = $1 and e.skill_id = selected_id and e.source = 'operator_onboarding');
    end loop;
  end if;
  if payload ? 'familiar_area_ids' or payload ? 'willing_to_travel_area_ids' then
    update public.worker_area_preferences p set archived_at = timezone('utc', now())
    where p.worker_id = $1 and p.archived_at is null
      and (not (case when payload ? 'familiar_area_ids' then p.area_id = any(coalesce(familiar_area_ids, '{}'::uuid[])) else p.is_familiar end)
        and not (case when payload ? 'willing_to_travel_area_ids' then p.area_id = any(coalesce(willing_to_travel_area_ids, '{}'::uuid[])) else p.willing_to_travel end));
    update public.worker_area_preferences p set
      is_familiar = case when payload ? 'familiar_area_ids' then p.area_id = any(coalesce(familiar_area_ids, '{}'::uuid[])) else p.is_familiar end,
      willing_to_travel = case when payload ? 'willing_to_travel_area_ids' then p.area_id = any(coalesce(willing_to_travel_area_ids, '{}'::uuid[])) else p.willing_to_travel end
    where p.worker_id = $1 and p.archived_at is null;
    for selected_area_id in select area_id from (select unnest(coalesce(familiar_area_ids, '{}'::uuid[])) as area_id union select unnest(coalesce(willing_to_travel_area_ids, '{}'::uuid[]))) areas loop
      insert into public.worker_area_preferences(worker_id, area_id, is_familiar, willing_to_travel)
      values ($1, selected_area_id, case when payload ? 'familiar_area_ids' then selected_area_id = any(coalesce(familiar_area_ids, '{}'::uuid[])) else true end, case when payload ? 'willing_to_travel_area_ids' then selected_area_id = any(coalesce(willing_to_travel_area_ids, '{}'::uuid[])) else true end)
      on conflict (worker_id, area_id) do update set is_familiar = excluded.is_familiar, willing_to_travel = excluded.willing_to_travel, archived_at = null;
    end loop;
  end if;
  if payload ? 'read_aloud_enabled' or candidate_app is not null then insert into public.worker_participation_preferences(worker_id, read_aloud_enabled, app_participation)
    values ($1, coalesce((payload ->> 'read_aloud_enabled')::boolean, false), coalesce(candidate_app, 'unknown'))
    on conflict (worker_id) do update set read_aloud_enabled = case when payload ? 'read_aloud_enabled' then excluded.read_aloud_enabled else worker_participation_preferences.read_aloud_enabled end, app_participation = coalesce(candidate_app, worker_participation_preferences.app_participation); end if;
  return $1;
end;
$$;

create function public.update_organisation_record(organisation_id uuid, payload jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare contact_id uuid; contact_person_id uuid; candidate_phone text; candidate_status text; area_ids uuid[] := '{}'::uuid[]; skill_ids uuid[] := '{}'::uuid[]; selected_id uuid;
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to edit an organisation'; end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'organisation update payload must be an object'; end if;
  if not exists (select 1 from public.organisations o where o.id = $1 and o.archived_at is null) then raise exception 'organisation record was not found'; end if;
  candidate_phone := case when payload ? 'contact_phone_number' then nullif(trim(payload ->> 'contact_phone_number'), '') end;
  candidate_status := case when payload ? 'record_status' then nullif(payload ->> 'record_status', '') end;
  if payload ? 'legal_name' and length(trim(coalesce(payload ->> 'legal_name', ''))) = 0 then raise exception 'legal name cannot be empty'; end if;
  if payload ? 'display_name' and length(trim(coalesce(payload ->> 'display_name', ''))) = 0 then raise exception 'display name cannot be empty'; end if;
  if candidate_phone is not null and candidate_phone !~ '^\+[1-9][0-9]{1,14}$' then raise exception 'phone number must be normalised E.164'; end if;
  if candidate_status is not null and candidate_status not in ('draft', 'active', 'inactive') then raise exception 'record status is invalid'; end if;
  if jsonb_typeof(coalesce(payload -> 'operating_area_ids', '[]')) <> 'array' or jsonb_typeof(coalesce(payload -> 'typical_skill_ids', '[]')) <> 'array' then raise exception 'organisation selections must be arrays'; end if;
  if payload ? 'operating_area_ids' then select coalesce(array_agg(value::uuid), '{}'::uuid[]) into area_ids from jsonb_array_elements_text(payload -> 'operating_area_ids'); if exists (select 1 from unnest(area_ids) s(id) left join public.areas a on a.id=s.id and a.archived_at is null where a.id is null) then raise exception 'all operating areas must be active'; end if; end if;
  if payload ? 'typical_skill_ids' then select coalesce(array_agg(value::uuid), '{}'::uuid[]) into skill_ids from jsonb_array_elements_text(payload -> 'typical_skill_ids'); if exists (select 1 from unnest(skill_ids) s(id) left join public.skills k on k.id=s.id and k.archived_at is null where k.id is null) then raise exception 'all typical skills must be active'; end if; end if;
  select c.id, c.person_id into contact_id, contact_person_id from public.organisation_contacts c where c.organisation_id = $1 and c.is_primary and c.archived_at is null;
  if contact_id is null then raise exception 'organisation has no live primary contact'; end if;
  if candidate_phone is not null and exists (select 1 from public.person_phone_numbers p where p.phone_number=candidate_phone and p.archived_at is null and p.person_id<>contact_person_id) then raise exception 'phone number is already linked to another active person'; end if;
  update public.organisations o set legal_name = case when payload ? 'legal_name' then trim(payload ->> 'legal_name') else o.legal_name end, display_name = case when payload ? 'display_name' then trim(payload ->> 'display_name') else o.display_name end, record_status = coalesce(candidate_status::public.record_status, o.record_status) where o.id=$1;
  if payload ? 'contact_display_name' then update public.people set display_name=trim(payload ->> 'contact_display_name') where id=contact_person_id; end if;
  if payload ? 'contact_role_name' then update public.organisation_contacts set role_name=nullif(trim(payload ->> 'contact_role_name'),'') where id=contact_id; end if;
  if candidate_phone is not null then update public.person_phone_numbers p set is_primary=false where p.person_id=contact_person_id and p.archived_at is null and p.phone_number<>candidate_phone; insert into public.person_phone_numbers(person_id,phone_number,is_primary) values(contact_person_id,candidate_phone,true) on conflict(phone_number) where archived_at is null do update set is_primary=true; end if;
  if payload ? 'operating_area_ids' then update public.organisation_operating_areas a set archived_at=timezone('utc',now()) where a.organisation_id=$1 and a.archived_at is null and not(a.area_id=any(area_ids)); foreach selected_id in array area_ids loop insert into public.organisation_operating_areas(organisation_id,area_id) values($1,selected_id) on conflict(organisation_id,area_id) do update set archived_at=null; end loop; end if;
  if payload ? 'typical_skill_ids' then update public.organisation_typical_skills k set archived_at=timezone('utc',now()) where k.organisation_id=$1 and k.archived_at is null and not(k.skill_id=any(skill_ids)); foreach selected_id in array skill_ids loop insert into public.organisation_typical_skills(organisation_id,skill_id) values($1,selected_id) on conflict(organisation_id,skill_id) do update set archived_at=null; end loop; end if;
  return $1;
end;
$$;

create function public.search_work_graph(search_term text, max_results integer default 24)
returns table(result_kind text, result_id uuid, title text, detail text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare term text := trim(coalesce(search_term, '')); digits text := regexp_replace(coalesce(search_term, ''), '[^0-9]', '', 'g');
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to search the Work Graph'; end if;
  if max_results is null or max_results < 1 or max_results > 100 then raise exception 'max results must be between 1 and 100'; end if;
  if term = '' then return; end if;
  return query with results as (
    select 'worker'::text, w.person_id, coalesce(w.preferred_name,p.display_name), concat_ws(' - ','Worker',a.name,a.locality)
    from public.worker_profiles w join public.people p on p.id=w.person_id and p.archived_at is null left join public.areas a on a.id=w.base_area_id and a.archived_at is null
    where w.archived_at is null and w.record_status='active' and (p.display_name ilike '%'||term||'%' or coalesce(w.preferred_name,'') ilike '%'||term||'%' or coalesce(a.name,'') ilike '%'||term||'%' or coalesce(a.locality,'') ilike '%'||term||'%' or exists(select 1 from public.person_phone_numbers ph where ph.person_id=w.person_id and ph.archived_at is null and digits<>'' and regexp_replace(ph.phone_number,'[^0-9]','','g')=digits) or exists(select 1 from public.worker_primary_skills ps join public.skills k on k.id=ps.skill_id where ps.worker_id=w.person_id and ps.archived_at is null and k.archived_at is null and k.name ilike '%'||term||'%') or exists(select 1 from public.workmarks m join public.workmark_skills ms on ms.workmark_id=m.id join public.skills k on k.id=ms.skill_id where m.worker_id=w.person_id and m.lifecycle='confirmed' and m.archived_at is null and k.archived_at is null and k.name ilike '%'||term||'%'))
    union
    select 'contractor'::text,o.id,o.display_name,concat_ws(' - ','Contractor',p.display_name)
    from public.organisations o left join public.organisation_contacts c on c.organisation_id=o.id and c.is_primary and c.archived_at is null left join public.people p on p.id=c.person_id and p.archived_at is null
    where o.archived_at is null and o.record_status='active' and (o.display_name ilike '%'||term||'%' or o.legal_name ilike '%'||term||'%' or coalesce(p.display_name,'') ilike '%'||term||'%' or exists(select 1 from public.person_phone_numbers ph where ph.person_id=c.person_id and ph.archived_at is null and digits<>'' and regexp_replace(ph.phone_number,'[^0-9]','','g')=digits) or exists(select 1 from public.organisation_operating_areas oa join public.areas a on a.id=oa.area_id where oa.organisation_id=o.id and oa.archived_at is null and a.archived_at is null and (a.name ilike '%'||term||'%' or coalesce(a.locality,'') ilike '%'||term||'%')) or exists(select 1 from public.organisation_typical_skills os join public.skills k on k.id=os.skill_id where os.organisation_id=o.id and os.archived_at is null and k.archived_at is null and k.name ilike '%'||term||'%'))
    union
    select 'site'::text,s.id,s.name,concat_ws(' - ','Site',s.locality,o.display_name) from public.sites s join public.organisations o on o.id=s.organisation_id and o.archived_at is null and o.record_status='active' where s.archived_at is null and (s.name ilike '%'||term||'%' or coalesce(s.locality,'') ilike '%'||term||'%')
    union select 'skill'::text,k.id,k.name,'Skill'::text from public.skills k where k.archived_at is null and k.name ilike '%'||term||'%'
  ) select * from results order by 1,3 limit max_results;
end;
$$;

-- Safe future participant projections: no phones, notes, DOB, object paths,
-- rates/payment, source_reference, or unresolved exceptions/disputes.
create view public.participant_worker_home with (security_invoker = true) as
select w.person_id worker_id,p.display_name,w.preferred_name,l.code preferred_language_code,p.preferred_communication_mode,a.name base_area_name,a.locality base_area_locality,x.read_aloud_enabled,x.app_participation
from public.worker_profiles w join public.people p on p.id=w.person_id left join public.languages l on l.id=p.preferred_language_id left join public.areas a on a.id=w.base_area_id and a.archived_at is null left join public.worker_participation_preferences x on x.worker_id=w.person_id
where w.archived_at is null and w.record_status='active' and p.archived_at is null;
create view public.participant_worker_profile_preferences with (security_invoker = true) as
select w.person_id worker_id, l.code preferred_language_code, p.preferred_communication_mode,
  coalesce(x.read_aloud_enabled, false) read_aloud_enabled, coalesce(x.app_participation, 'unknown') app_participation,
  availability.status availability_status, availability.available_from, availability.available_to,
  coalesce((select array_agg(area.area_id order by area.area_id) from public.worker_area_preferences area where area.worker_id=w.person_id and area.archived_at is null and area.is_familiar), '{}'::uuid[]) familiar_area_ids,
  coalesce((select array_agg(area.area_id order by area.area_id) from public.worker_area_preferences area where area.worker_id=w.person_id and area.archived_at is null and area.willing_to_travel), '{}'::uuid[]) willing_to_travel_area_ids
from public.worker_profiles w join public.people p on p.id=w.person_id left join public.languages l on l.id=p.preferred_language_id left join public.worker_participation_preferences x on x.worker_id=w.person_id
left join lateral (select a.status, a.available_from, a.available_to from public.availability_signals a where a.worker_id=w.person_id and a.archived_at is null and (a.available_to is null or a.available_to >= current_date) order by a.created_at desc, a.id desc limit 1) availability on true
where w.archived_at is null and w.record_status='active' and p.archived_at is null;
create view public.participant_worker_work with (security_invoker = true) as
select m.id workmark_id,m.worker_id,m.organisation_id,o.display_name organisation_name,m.site_id,s.name site_name,s.locality site_locality,m.work_started_on,m.work_ended_on,m.origin,(m.assignment_id is not null) is_markd_arranged
from public.workmarks m
join public.worker_profiles w on w.person_id=m.worker_id and w.archived_at is null and w.record_status='active'
join public.people p on p.id=w.person_id and p.archived_at is null
join public.organisations o on o.id=m.organisation_id and o.archived_at is null and o.record_status='active'
left join public.sites s on s.id=m.site_id and s.archived_at is null
where m.lifecycle='confirmed' and m.archived_at is null;
create view public.participant_worker_card with (security_invoker = true) as
select w.person_id worker_id,p.display_name,w.preferred_name,a.name base_area_name,count(distinct m.id) filter(where m.lifecycle='confirmed' and m.archived_at is null)::integer confirmed_workmark_count,max(m.work_ended_on) filter(where m.lifecycle='confirmed' and m.archived_at is null) last_confirmed_worked_on
from public.worker_profiles w join public.people p on p.id=w.person_id left join public.areas a on a.id=w.base_area_id and a.archived_at is null left join public.workmarks m on m.worker_id=w.person_id where w.archived_at is null and w.record_status='active' and p.archived_at is null group by w.person_id,p.display_name,w.preferred_name,a.name;
create view public.participant_contractor_labour_book with (security_invoker = true) as
select r.organisation_id,r.worker_id,coalesce(w.preferred_name,p.display_name) worker_name,r.confirmed_workmark_count,r.is_repeat_relationship,r.first_worked_on,r.last_worked_on from public.worker_organisation_relationships r join public.worker_profiles w on w.person_id=r.worker_id join public.people p on p.id=w.person_id join public.organisations o on o.id=r.organisation_id where w.archived_at is null and w.record_status='active' and p.archived_at is null and o.archived_at is null and o.record_status='active';
create view public.participant_candidate_summary with (security_invoker = true) as
select w.person_id worker_id,p.display_name,w.preferred_name,k.id skill_id,k.name skill_name,count(distinct m.id)::integer confirmed_workmark_count,max(m.work_ended_on) last_confirmed_worked_on from public.worker_profiles w join public.people p on p.id=w.person_id join public.workmarks m on m.worker_id=w.person_id and m.lifecycle='confirmed' and m.archived_at is null join public.workmark_skills ws on ws.workmark_id=m.id join public.skills k on k.id=ws.skill_id and k.archived_at is null where w.archived_at is null and w.record_status='active' and p.archived_at is null group by w.person_id,p.display_name,w.preferred_name,k.id,k.name;

revoke all on table public.operator_work_cards,public.participant_worker_home,public.participant_worker_profile_preferences,public.participant_worker_work,public.participant_worker_card,public.participant_contractor_labour_book,public.participant_candidate_summary from anon,authenticated;
grant select on table public.operator_work_cards,public.participant_worker_home,public.participant_worker_profile_preferences,public.participant_worker_work,public.participant_worker_card,public.participant_contractor_labour_book,public.participant_candidate_summary to authenticated;
revoke all on function public.begin_worker_onboarding(uuid,jsonb),public.complete_worker_onboarding(uuid,uuid,text,text),public.cancel_worker_onboarding(uuid),public.onboard_organisation(text,text,text,text,text,uuid[],uuid[],text),public.update_worker_record(uuid,jsonb),public.update_organisation_record(uuid,jsonb),public.search_work_graph(text,integer) from public;
grant execute on function public.begin_worker_onboarding(uuid,jsonb),public.complete_worker_onboarding(uuid,uuid,text,text),public.cancel_worker_onboarding(uuid),public.onboard_organisation(text,text,text,text,text,uuid[],uuid[],text),public.update_worker_record(uuid,jsonb),public.update_organisation_record(uuid,jsonb),public.search_work_graph(text,integer) to authenticated;
