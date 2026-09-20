-- FLO-114: keep Assignment closeout evidence attached to the relationship
-- it describes. A Stamp is append-only evidence, not a second work record.

create function public.validate_assignment_stamp_context()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  workmark_assignment_id uuid;
  assignment_worker_id uuid;
  assignment_organisation_id uuid;
  assignment_hirer_person_id uuid;
begin
  select
    workmark.assignment_id,
    assignment.worker_id,
    assignment.organisation_id,
    assignment.hirer_person_id
  into
    workmark_assignment_id,
    assignment_worker_id,
    assignment_organisation_id,
    assignment_hirer_person_id
  from public.workmarks as workmark
  join public.assignments as assignment on assignment.id = new.assignment_id
  where workmark.id = new.workmark_id;

  if not found or workmark_assignment_id is distinct from new.assignment_id then
    raise exception 'assignment stamp workmark must belong to its assignment';
  end if;

  if new.asserted_role = 'worker'
    and new.asserted_by_person_id is distinct from assignment_worker_id then
    raise exception 'worker stamp assertion must be made by the assigned worker';
  end if;

  if new.asserted_role = 'hirer' and not (
    new.asserted_by_person_id is not distinct from assignment_hirer_person_id
    or (
      assignment_organisation_id is not null
      and exists (
        select 1
        from public.organisation_contacts as contact
        where contact.organisation_id = assignment_organisation_id
          and contact.person_id = new.asserted_by_person_id
          and contact.archived_at is null
      )
    )
  ) then
    raise exception 'hirer stamp assertion must be made by the assignment hirer or an active organisation contact';
  end if;

  return new;
end;
$$;

create trigger assignment_stamps_context
before insert or update on public.assignment_stamps
for each row execute function public.validate_assignment_stamp_context();

create trigger assignment_stamps_typed_provenance
before insert or update on public.assignment_stamps
for each row execute function public.validate_typed_provenance();

create trigger workmark_corrections_typed_provenance
before insert or update on public.workmark_corrections
for each row execute function public.validate_typed_provenance();

-- A corrected Workmark remains durable Work Graph evidence. Draft and voided
-- records remain excluded, while corrected evidence stays in the same derived
-- read models as the original confirmed record.
create or replace view public.worker_organisation_relationships
with (security_invoker = true) as
select w.worker_id, w.organisation_id, count(*)::integer as confirmed_workmark_count,
       count(*) > 1 as is_repeat_relationship,
       count(*) filter (where w.assignment_id is not null)::integer as markd_arranged_workmark_count,
       (array_agg(w.worker_reuse_preference order by w.work_ended_on desc, w.created_at desc))[1] as latest_worker_reuse_preference,
       (array_agg(w.organisation_reuse_preference order by w.work_ended_on desc, w.created_at desc))[1] as latest_organisation_reuse_preference,
       min(w.work_started_on) as first_worked_on, max(w.work_ended_on) as last_worked_on
from public.workmarks w
where w.lifecycle in ('confirmed', 'corrected') and w.archived_at is null
group by w.worker_id, w.organisation_id;

create or replace view public.worker_organisation_skill_summary
with (security_invoker = true) as
select w.worker_id, w.organisation_id, ws.skill_id, count(*)::integer as confirmed_workmark_count,
       max(w.work_ended_on) as last_demonstrated_on
from public.workmarks w join public.workmark_skills ws on ws.workmark_id = w.id
where w.lifecycle in ('confirmed', 'corrected') and w.archived_at is null
group by w.worker_id, w.organisation_id, ws.skill_id;

create or replace view public.operator_work_cards
with (security_invoker = true) as
select worker.person_id as worker_id, person.display_name, worker.preferred_name,
  portrait.object_path as portrait_object_path,
  count(distinct workmark.id) filter (where workmark.lifecycle in ('confirmed', 'corrected') and workmark.archived_at is null)::integer as confirmed_workmark_count,
  max(workmark.work_ended_on) filter (where workmark.lifecycle in ('confirmed', 'corrected') and workmark.archived_at is null) as last_confirmed_worked_on
from public.worker_profiles worker
join public.people person on person.id = worker.person_id
left join public.worker_media_assets portrait on portrait.worker_id = worker.person_id and portrait.bucket_id = 'worker-portraits' and portrait.archived_at is null
left join public.workmarks workmark on workmark.worker_id = worker.person_id
where worker.archived_at is null and worker.record_status = 'active' and person.archived_at is null
group by worker.person_id, person.display_name, worker.preferred_name, portrait.object_path;

create or replace view public.participant_worker_work
with (security_invoker = true) as
select m.id workmark_id,m.worker_id,m.organisation_id,o.display_name organisation_name,m.site_id,s.name site_name,s.locality site_locality,m.work_started_on,m.work_ended_on,m.origin,(m.assignment_id is not null) is_markd_arranged
from public.workmarks m
join public.worker_profiles w on w.person_id=m.worker_id and w.archived_at is null and w.record_status='active'
join public.people p on p.id=w.person_id and p.archived_at is null
join public.organisations o on o.id=m.organisation_id and o.archived_at is null and o.record_status='active'
left join public.sites s on s.id=m.site_id and s.archived_at is null
where m.lifecycle in ('confirmed', 'corrected') and m.archived_at is null;

create or replace view public.participant_worker_card
with (security_invoker = true) as
select w.person_id worker_id,p.display_name,w.preferred_name,a.name base_area_name,count(distinct m.id) filter(where m.lifecycle in ('confirmed', 'corrected') and m.archived_at is null)::integer confirmed_workmark_count,max(m.work_ended_on) filter(where m.lifecycle in ('confirmed', 'corrected') and m.archived_at is null) last_confirmed_worked_on
from public.worker_profiles w join public.people p on p.id=w.person_id left join public.areas a on a.id=w.base_area_id and a.archived_at is null left join public.workmarks m on m.worker_id=w.person_id where w.archived_at is null and w.record_status='active' and p.archived_at is null group by w.person_id,p.display_name,w.preferred_name,a.name;

create or replace view public.participant_candidate_summary
with (security_invoker = true) as
select w.person_id worker_id,p.display_name,w.preferred_name,k.id skill_id,k.name skill_name,count(distinct m.id)::integer confirmed_workmark_count,max(m.work_ended_on) last_confirmed_worked_on from public.worker_profiles w join public.people p on p.id=w.person_id join public.workmarks m on m.worker_id=w.person_id and m.lifecycle in ('confirmed', 'corrected') and m.archived_at is null join public.workmark_skills ws on ws.workmark_id=m.id join public.skills k on k.id=ws.skill_id and k.archived_at is null where w.archived_at is null and w.record_status='active' and p.archived_at is null group by w.person_id,p.display_name,w.preferred_name,k.id,k.name;

create or replace function public.search_work_graph(
  search_term text,
  max_results integer default 24
)
returns table(result_kind text, result_id uuid, title text, detail text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  term text := trim(coalesce(search_term, ''));
  digits text := regexp_replace(coalesce(search_term, ''), '[^0-9]', '', 'g');
begin
  if not public.is_active_operator() then
    raise exception 'an active operator is required to search the Work Graph';
  end if;
  if max_results is null or max_results < 1 or max_results > 100 then
    raise exception 'max results must be between 1 and 100';
  end if;
  if term = '' then return; end if;
  return query
  with results as (
    select 'worker'::text, w.person_id,
           coalesce(w.preferred_name, p.display_name),
           concat_ws(' - ', 'Worker', a.name, a.locality)
    from public.worker_profiles w
    join public.people p on p.id = w.person_id and p.archived_at is null
    left join public.areas a
      on a.id = w.base_area_id and a.archived_at is null
    where w.archived_at is null and w.record_status = 'active' and (
      p.display_name ilike '%' || term || '%'
      or coalesce(w.preferred_name, '') ilike '%' || term || '%'
      or coalesce(a.name, '') ilike '%' || term || '%'
      or coalesce(a.locality, '') ilike '%' || term || '%'
      or exists (
        select 1 from public.person_phone_numbers ph
        where ph.person_id = w.person_id and ph.archived_at is null
          and digits <> ''
          and regexp_replace(ph.phone_number, '[^0-9]', '', 'g') = digits
      )
      or exists (
        select 1 from public.worker_primary_skills ps
        join public.skills k on k.id = ps.skill_id
        where ps.worker_id = w.person_id and ps.archived_at is null
          and k.archived_at is null and k.name ilike '%' || term || '%'
      )
      or exists (
        select 1 from public.workmarks m
        join public.workmark_skills ms on ms.workmark_id = m.id
        join public.skills k on k.id = ms.skill_id
        where m.worker_id = w.person_id
          and m.lifecycle in ('confirmed', 'corrected')
          and m.archived_at is null and k.archived_at is null
          and k.name ilike '%' || term || '%'
      )
    )
    union
    select 'contractor'::text, o.id, o.display_name,
           concat_ws(' - ', 'Contractor', p.display_name)
    from public.organisations o
    left join public.organisation_contacts c
      on c.organisation_id = o.id and c.is_primary and c.archived_at is null
    left join public.people p on p.id = c.person_id and p.archived_at is null
    where o.archived_at is null and o.record_status = 'active' and (
      o.display_name ilike '%' || term || '%'
      or o.legal_name ilike '%' || term || '%'
      or coalesce(p.display_name, '') ilike '%' || term || '%'
      or exists (
        select 1 from public.person_phone_numbers ph
        where ph.person_id = c.person_id and ph.archived_at is null
          and digits <> ''
          and regexp_replace(ph.phone_number, '[^0-9]', '', 'g') = digits
      )
      or exists (
        select 1 from public.organisation_operating_areas oa
        join public.areas a on a.id = oa.area_id
        where oa.organisation_id = o.id and oa.archived_at is null
          and a.archived_at is null
          and (a.name ilike '%' || term || '%'
               or coalesce(a.locality, '') ilike '%' || term || '%')
      )
      or exists (
        select 1 from public.organisation_typical_skills os
        join public.skills k on k.id = os.skill_id
        where os.organisation_id = o.id and os.archived_at is null
          and k.archived_at is null and k.name ilike '%' || term || '%'
      )
    )
    union
    select 'site'::text, s.id, s.name,
           concat_ws(' - ', 'Site', s.locality, o.display_name)
    from public.sites s
    join public.organisations o
      on o.id = s.organisation_id and o.archived_at is null
     and o.record_status = 'active'
    where s.archived_at is null and (
      s.name ilike '%' || term || '%'
      or coalesce(s.locality, '') ilike '%' || term || '%'
    )
    union
    select 'skill'::text, k.id, k.name, 'Skill'::text
    from public.skills k
    where k.archived_at is null and k.name ilike '%' || term || '%'
  )
  select * from results order by 1, 3 limit max_results;
end;
$$;
