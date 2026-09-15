-- FLO-110/FLO-111: language evidence for channel messages/media, and the
-- proposed_actions read access the Ops Inbox needs.
--
-- Transcript and detected-language fields are stored alongside, not instead
-- of, the original media/text already captured by FLO-108. Interpretation
-- remains language-neutral in proposed_actions.interpretation (FLO-109).

alter table public.channel_events
  add column detected_language_code text check (detected_language_code ~ '^[a-z]{2,3}$'),
  add column detected_language_confidence numeric(3, 2) check (detected_language_confidence between 0 and 1);

alter table public.channel_media_assets
  add column transcript text,
  add column transcript_confidence numeric(3, 2) check (transcript_confidence between 0 and 1),
  add column detected_language_code text check (detected_language_code ~ '^[a-z]{2,3}$');

-- proposed_actions was altered by FLO-108/109 but never granted operator read
-- access; the Ops Inbox is the first consumer that needs to select it.
alter table public.proposed_actions enable row level security;
revoke all on table public.proposed_actions from anon, authenticated;
grant select on table public.proposed_actions to authenticated;
drop policy if exists proposed_actions_operator_read on public.proposed_actions;
create policy proposed_actions_operator_read on public.proposed_actions
  for select to authenticated using ((select public.is_active_operator()));

-- channel_processing_jobs was likewise never granted operator read access;
-- the Ops Inbox needs it for queue/processing visibility alongside drafts.
grant select on table public.channel_processing_jobs to authenticated;
drop policy if exists channel_processing_jobs_operator_read on public.channel_processing_jobs;
create policy channel_processing_jobs_operator_read on public.channel_processing_jobs
  for select to authenticated using ((select public.is_active_operator()));

-- FLO-111: an operator editing an ambiguous draft's fields in the Ops Inbox is
-- itself the ambiguity resolution; it must happen atomically with approval so
-- a proposed action is never left half-edited. This replaces the FLO-109
-- function rather than adding a parallel command, keeping one approval path.
drop function if exists public.approve_proposed_action(uuid, jsonb);
create function public.approve_proposed_action(
  action_id uuid,
  edited_payload jsonb default null,
  resolve_ambiguity boolean default false
)
returns public.proposed_actions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.proposed_actions;
begin
  if not public.is_active_operator() then raise exception 'an active operator is required to approve a proposed action'; end if;
  update public.proposed_actions
  set payload = coalesce(edited_payload, payload), state = 'approved',
      ambiguity = case
        when resolve_ambiguity and edited_payload is not null then 'clear'::public.proposed_action_ambiguity_state
        else ambiguity
      end,
      confirmed_by_operator_id = auth.uid(), confirmed_at = timezone('utc', now())
  where id = action_id and state = 'pending'
    and (ambiguity = 'clear' or (resolve_ambiguity and edited_payload is not null));
  if not found then raise exception 'only a clear pending proposed action (or an ambiguous one being edited and resolved) can be approved'; end if;
  select * into result from public.proposed_actions where id = action_id;
  return result;
end;
$$;
grant execute on function public.approve_proposed_action(uuid, jsonb, boolean) to authenticated;
