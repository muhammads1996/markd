"use client";

import { createSupabaseBrowserClient } from "../supabase/browser";

type HttpMethod = "GET" | "POST" | "PUT";

export interface ParticipantApiRequest {
  path: `/api/v1/${string}`;
  method: HttpMethod;
  body?: object;
  idempotencyKey?: string;
}

export interface ParticipantIdentity {
  authUserId: string;
  personId: string | null;
  actorKind: "operator" | "worker";
  participantScopes: string[];
  organisationContacts: Array<{
    organisationContactId: string;
    organisationId: string;
  }>;
  role?: string;
}

interface ApiErrorBody {
  detail?: string;
  title?: string;
}

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_MARKD_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

export function apiUrl(path: `/api/v1/${string}`): string {
  return `${apiBaseUrl}${path}`;
}

export function createParticipantApiRequest(
  request: ParticipantApiRequest,
  accessToken: string,
  correlationId: string,
): RequestInit {
  return {
    method: request.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": request.idempotencyKey ?? crypto.randomUUID(),
      "X-Correlation-Id": correlationId,
    },
    ...(request.body === undefined
      ? {}
      : { body: JSON.stringify(request.body) }),
  };
}

async function accessToken(): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error)
    throw new Error(`Could not read your MARKD session: ${error.message}`);
  if (!data.session?.access_token) {
    throw new Error("Sign in again before sending this request.");
  }
  return data.session.access_token;
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const detail = body as ApiErrorBody;
    if (typeof detail.detail === "string") return detail.detail;
    if (typeof detail.title === "string") return detail.title;
  }
  return `MARKD could not complete this request (HTTP ${status}).`;
}

export async function sendParticipantApiRequest<T>(
  request: ParticipantApiRequest,
): Promise<T> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(
      apiUrl(request.path),
      createParticipantApiRequest(request, token, crypto.randomUUID()),
    );
  } catch {
    throw new Error(
      "MARKD could not reach the service. Check your connection and try again.",
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as T;
}

export function respondToAssignment(
  assignmentId: string,
  response: "accepted" | "declined" | "call_me",
  expectedVersion?: number,
) {
  return sendParticipantApiRequest({
    path: `/api/v1/assignments/${assignmentId}/respond`,
    method: "POST",
    body: { response, expected_version: expectedVersion },
    idempotencyKey: `assignment-response-${assignmentId}-${crypto.randomUUID()}`,
  });
}

export function cancelAssignment(
  assignmentId: string,
  expectedVersion?: number,
) {
  return sendParticipantApiRequest({
    path: `/api/v1/assignments/${assignmentId}/cancel`,
    method: "POST",
    body: {
      reason_code: "worker_withdrew",
      expected_version: expectedVersion,
    },
    idempotencyKey: `assignment-withdraw-${assignmentId}-${crypto.randomUUID()}`,
  });
}

export function acknowledgeOnMyWay(assignmentId: string) {
  return sendParticipantApiRequest({
    path: `/api/v1/assignments/${assignmentId}/acknowledgements`,
    method: "POST",
    body: { kind: "on_my_way" },
    idempotencyKey: `assignment-on-my-way-${assignmentId}-${crypto.randomUUID()}`,
  });
}

export function submitStamp(
  assignmentId: string,
  input: {
    attendance: "attended" | "no_show" | "unknown";
    completion: "completed" | "partial" | "not_completed" | "unknown";
    expectedVersion?: number;
  },
) {
  return sendParticipantApiRequest({
    path: `/api/v1/assignments/${assignmentId}/stamps`,
    method: "POST",
    body: input,
    idempotencyKey: `assignment-stamp-${assignmentId}-${crypto.randomUUID()}`,
  });
}

export function setWorkerAvailability(
  workerId: string,
  workDate: string,
  status: "available" | "unavailable" | "unknown",
  expectedVersion?: number,
) {
  return sendParticipantApiRequest({
    path: `/api/v1/workers/${workerId}/availability/${workDate}`,
    method: "PUT",
    body: { status, expected_version: expectedVersion },
    idempotencyKey: `worker-availability-${workerId}-${workDate}-${crypto.randomUUID()}`,
  });
}

export function createLabourRequest(input: {
  contractor_organisation_id: string;
  contractor_contact_id: string;
  work_date: string;
  timezone: string;
  site_area: string;
  pay: {
    amount_minor: number;
    currency: string;
    basis: "daily" | "hourly" | "fixed" | "other";
  };
  requirements: Array<{ work_type: string; headcount: number }>;
}) {
  return sendParticipantApiRequest({
    path: "/api/v1/labour-requests",
    method: "POST",
    body: input,
    idempotencyKey: `labour-request-${crypto.randomUUID()}`,
  });
}

export async function getParticipantIdentity(): Promise<ParticipantIdentity> {
  const response = await sendParticipantApiRequest<{
    auth_user_id: string;
    person_id: string | null;
    actor_kind: "operator" | "worker";
    participant_scopes: string[];
    organisation_contacts: Array<{
      organisation_contact_id: string;
      organisation_id: string;
    }>;
    role?: string;
  }>({ path: "/api/v1/me", method: "GET" });
  return {
    authUserId: response.auth_user_id,
    personId: response.person_id,
    actorKind: response.actor_kind,
    participantScopes: response.participant_scopes,
    organisationContacts: response.organisation_contacts.map((contact) => ({
      organisationContactId: contact.organisation_contact_id,
      organisationId: contact.organisation_id,
    })),
    ...(response.role === undefined ? {} : { role: response.role }),
  };
}
