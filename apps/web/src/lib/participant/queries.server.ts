import { createSupabaseServerClient } from "../supabase/server";
import {
  toParticipantWorkerAssignment,
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
      "assignment_id, assignment_version, worker_id, lifecycle, worker_response, contractor_confirmation, offered_at, travel_authorised_at, reporting_mode, reporting_place, reporting_at, organisation_display_name, site_locality, site_name, work_date, assignment_rate_cents, assignment_currency, request_rate_cents, request_currency, rate_basis, work_type",
    )
    .eq("worker_id", workerId)
    .order("work_date", { ascending: false });
  if (error) throw new Error(`Could not load assigned work: ${error.message}`);
  return ((data ?? []) as ParticipantWorkerAssignmentRow[]).map(
    toParticipantWorkerAssignment,
  );
}
