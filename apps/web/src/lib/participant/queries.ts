import type { WorkerAssignmentCardModel } from "./types";

export interface ParticipantWorkerAssignment {
  assignmentId: string;
  assignmentVersion: number;
  workerId: string;
  lifecycle: "active" | "completed" | "cancelled" | "no_show";
  workerResponse: "pending" | "call_me" | "accepted" | "declined";
  contractorConfirmation: "pending" | "confirmed" | "rejected";
  offeredAt: string | null;
  travelAuthorisedAt: string | null;
  reportingMode: "site" | "pickup" | null;
  reportingPlace: string | null;
  reportingAt: string | null;
  organisationDisplayName: string | null;
  siteLocality: string | null;
  siteName: string | null;
  workDate: string;
  assignmentRateCents: number | null;
  assignmentCurrency: string | null;
  requestRateCents: number | null;
  requestCurrency: string | null;
  rateBasis: string | null;
  workType: string;
}

export type ParticipantWorkerAssignmentRow = {
  assignment_id: string;
  assignment_version: number;
  worker_id: string;
  lifecycle: ParticipantWorkerAssignment["lifecycle"];
  worker_response: ParticipantWorkerAssignment["workerResponse"];
  contractor_confirmation: ParticipantWorkerAssignment["contractorConfirmation"];
  offered_at: string | null;
  travel_authorised_at: string | null;
  reporting_mode: ParticipantWorkerAssignment["reportingMode"];
  reporting_place: string | null;
  reporting_at: string | null;
  organisation_display_name: string | null;
  site_locality: string | null;
  site_name: string | null;
  work_date: string;
  assignment_rate_cents: number | null;
  assignment_currency: string | null;
  request_rate_cents: number | null;
  request_currency: string | null;
  rate_basis: string | null;
  work_type: string;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "full" }).format(
    new Date(`${value}T00:00:00`),
  );
}

function formatTime(value: string | null): string {
  if (!value) return "To be confirmed";
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRate(assignment: ParticipantWorkerAssignment): string {
  const amount = assignment.assignmentRateCents ?? assignment.requestRateCents;
  const currency = assignment.assignmentCurrency ?? assignment.requestCurrency;
  if (amount === null || currency === null) return "Rate to be confirmed";
  const basis = assignment.rateBasis ? ` per ${assignment.rateBasis}` : "";
  return `${currency} ${(amount / 100).toFixed(2)}${basis}`;
}

export function toParticipantWorkerAssignment(
  row: ParticipantWorkerAssignmentRow,
): ParticipantWorkerAssignment {
  return {
    assignmentId: row.assignment_id,
    assignmentVersion: row.assignment_version,
    workerId: row.worker_id,
    lifecycle: row.lifecycle,
    workerResponse: row.worker_response,
    contractorConfirmation: row.contractor_confirmation,
    offeredAt: row.offered_at,
    travelAuthorisedAt: row.travel_authorised_at,
    reportingMode: row.reporting_mode,
    reportingPlace: row.reporting_place,
    reportingAt: row.reporting_at,
    organisationDisplayName: row.organisation_display_name,
    siteLocality: row.site_locality,
    siteName: row.site_name,
    workDate: row.work_date,
    assignmentRateCents: row.assignment_rate_cents,
    assignmentCurrency: row.assignment_currency,
    requestRateCents: row.request_rate_cents,
    requestCurrency: row.request_currency,
    rateBasis: row.rate_basis,
    workType: row.work_type,
  };
}

export function toWorkerAssignmentCardModel(
  assignment: ParticipantWorkerAssignment,
): WorkerAssignmentCardModel | null {
  const facts = {
    workType: assignment.workType,
    contractorName: assignment.organisationDisplayName ?? "MARKD contractor",
    dateLabel: formatDate(assignment.workDate),
    startTimeLabel: formatTime(assignment.reportingAt),
    rateLabel: formatRate(assignment),
    areaLabel:
      [assignment.siteName, assignment.siteLocality]
        .filter(Boolean)
        .join(", ") || "Site to be confirmed",
    reportingPoint: assignment.reportingPlace ?? "To be confirmed",
    travelDetail: assignment.travelAuthorisedAt
      ? "Travel authorised"
      : "Do not travel until MARKD confirms arrangements",
    contactLabel: "MARKD",
  };

  if (assignment.lifecycle === "cancelled") {
    return {
      state: "cancelled",
      assignmentId: assignment.assignmentId,
      status: "cancelled",
      travelState: "do_not_travel",
      cancellationLabel: "This work is no longer active.",
      facts,
    };
  }
  if (
    assignment.lifecycle === "active" &&
    assignment.workerResponse === "accepted" &&
    assignment.contractorConfirmation === "confirmed" &&
    assignment.travelAuthorisedAt
  ) {
    return {
      state: "travel_ready",
      assignmentId: assignment.assignmentId,
      status: "confirmed_travel_ready",
      travelState: "travel_ready",
      acknowledgementState: "pending",
      directionsUrl: null,
      facts,
    };
  }
  if (
    assignment.lifecycle === "active" &&
    assignment.workerResponse === "accepted"
  ) {
    return {
      state: "accepted_waiting",
      assignmentId: assignment.assignmentId,
      status: "accepted_waiting",
      travelState: "do_not_travel",
      responseState: "accepted",
      facts,
    };
  }
  if (assignment.lifecycle === "active") {
    return {
      state: "offer",
      assignmentId: assignment.assignmentId,
      status: "offer",
      travelState: "do_not_travel",
      responseState: "awaiting_response",
      facts,
    };
  }
  return null;
}
