import { createMarkdApiClient } from "../../lib/markd-api";

export type TomorrowAssignment = {
  id: string;
  labour_requirement_id: string | null;
  worker_name: string | null;
  availability_status: string | null;
  availability_conflict: boolean;
  worker_on_my_way: boolean;
  lifecycle: string;
  offered_at: string | null;
  worker_response: string;
  contractor_confirmation: string;
  travel_authorised_at: string | null;
  agreed_rate_cents: number | null;
  currency: string | null;
  version: number;
  reporting_mode: string | null;
  reporting_place_text: string | null;
  reporting_at: string | null;
  reporting_time: string | null;
  communication_evidence: Array<{
    id: string;
    state: string;
    message_kind: string;
    failure_reason: string | null;
  }>;
  landmark: string | null;
  instructions: string | null;
  bucket:
    | "awaiting_worker_response"
    | "accepted_waiting"
    | "travel_ready"
    | "cancelled"
    | "informational";
  travel_ready: boolean;
  blockers: string[];
  has_open_exception: boolean;
  open_exceptions: Array<{
    id: string;
    category: string;
    state: string;
    created_at: string;
  }>;
  failed_deliveries: Array<{
    id: string;
    state: string;
    message_kind: string;
    failure_reason: string | null;
  }>;
  review_evidence: Array<{
    id: string;
    action_type: string;
    original_text: string | null;
    interpretation: unknown;
    confidence: number | null;
    policy_reason: string | null;
    policy_outcome: string | null;
    semantic_mode: string | null;
    provider: string | null;
    model: string | null;
    decision_provider: string | null;
    model_version: string | null;
    semantic_status: string | null;
  }>;
};

export type TomorrowRequest = {
  labour_request_id: string;
  lifecycle: "active" | "cancelled";
  hirer_name: string;
  site_area: string | null;
  site_text: string | null;
  needed_at: string | null;
  rate_cents: number | null;
  currency: string | null;
  terms: string | null;
  timezone: string;
  requirements: Array<{
    id: string;
    work_type: string;
    required_headcount: number;
    covered_headcount: number;
    remaining_gap: number;
  }>;
  assignments: TomorrowAssignment[];
};

export type TomorrowReadModel = {
  date: string | null;
  summary: {
    labour_requests: number;
    positions_required: number;
    covered_positions: number;
    open_positions: number;
    travel_ready: number;
    waiting_worker_response: number;
    waiting_hirer_confirmation: number;
    logistics_gap: number;
    open_exceptions: number;
    communication_failures: number;
    review_required: number;
    availability_conflicts: number;
  };
  requests: TomorrowRequest[];
};

export async function loadTomorrow(date?: string): Promise<TomorrowReadModel> {
  const api = await createMarkdApiClient();
  return api.json<TomorrowReadModel>(
    `/api/v1/operator/tomorrow${date ? `?date=${encodeURIComponent(date)}` : ""}`,
  );
}
