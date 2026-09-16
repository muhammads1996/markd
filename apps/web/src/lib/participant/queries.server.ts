import { createSupabaseServerClient } from "../supabase/server";
import {
  toParticipantContractorAssignment,
  toParticipantWorkerAssignment,
  type ParticipantContractorAssignment,
  type ParticipantContractorAssignmentRow,
  type ParticipantWorkerAssignment,
  type ParticipantWorkerAssignmentRow,
} from "./queries";

export async function loadParticipantWorkerAssignments(
  workerId: string,
): Promise<ParticipantWorkerAssignment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("participant_worker_assignments")
    .select(
      "assignment_id, assignment_version, worker_id, lifecycle, worker_response, contractor_confirmation, offered_at, travel_authorised_at, reporting_mode, reporting_place, reporting_at, organisation_display_name, site_locality, site_name, work_date, work_type",
    )
    .eq("worker_id", workerId)
    .order("work_date", { ascending: false });
  if (error) throw new Error(`Could not load assigned work: ${error.message}`);
  return ((data ?? []) as ParticipantWorkerAssignmentRow[]).map(
    toParticipantWorkerAssignment,
  );
}

export async function loadParticipantContractorAssignments(): Promise<
  ParticipantContractorAssignment[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("participant_contractor_assignments")
    .select(
      "assignment_id, version, worker_id, worker_display_name, lifecycle, worker_response, contractor_confirmation, offered_at, travel_authorised_at, reporting_mode, reporting_place, reporting_at, work_date, work_type",
    )
    .order("work_date", { ascending: false });
  if (error)
    throw new Error(`Could not load contractor jobs: ${error.message}`);
  return ((data ?? []) as ParticipantContractorAssignmentRow[]).map(
    toParticipantContractorAssignment,
  );
}
