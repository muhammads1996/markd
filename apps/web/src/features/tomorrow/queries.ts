import { createMarkdApiClient } from "../../lib/markd-api";

export type TomorrowAssignment = {
  id: string;
  worker_name: string | null;
  lifecycle: string;
  worker_response: string;
  contractor_confirmation: string;
  travel_authorised_at: string | null;
  version: number;
  reporting_mode: string | null;
  reporting_place_text: string | null;
  reporting_at: string | null;
  reporting_time: string | null;
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
  failed_deliveries: Array<{
    id: string;
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
    semantic_mode: string | null;
    provider: string | null;
    model: string | null;
  }>;
};

export type TomorrowRequest = {
  labour_request_id: string;
  hirer_name: string;
  site_area: string | null;
  site_text: string | null;
  needed_at: string | null;
  rate_cents: number | null;
  currency: string | null;
  terms: string | null;
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
    travel_ready: number;
    waiting_worker_response: number;
    waiting_hirer_confirmation: number;
    logistics_gap: number;
    open_exceptions: number;
    communication_failures: number;
    review_required: number;
  };
  requests: TomorrowRequest[];
};

export async function loadTomorrow(date?: string): Promise<TomorrowReadModel> {
  const api = await createMarkdApiClient();
  return api.json<TomorrowReadModel>(
    `/api/v1/operator/tomorrow${date ? `?date=${encodeURIComponent(date)}` : ""}`,
  );
}
