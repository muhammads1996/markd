export type AssignmentStatus =
  "offer" | "accepted_waiting" | "confirmed_travel_ready" | "cancelled";

export type AssignmentStatusTone =
  "neutral" | "warning" | "confirmed" | "danger";

export const assignmentStatusToneByStatus = {
  offer: "neutral",
  accepted_waiting: "warning",
  confirmed_travel_ready: "confirmed",
  cancelled: "danger",
} as const satisfies Record<AssignmentStatus, AssignmentStatusTone>;

export function getAssignmentStatusTone(
  status: AssignmentStatus,
): AssignmentStatusTone {
  return assignmentStatusToneByStatus[status];
}

export interface AssignmentFacts {
  workType: string;
  contractorName: string;
  dateLabel: string;
  startTimeLabel: string;
  rateLabel: string;
  areaLabel: string;
  reportingPoint: string;
  travelDetail: string;
  contactLabel: string;
}

interface AssignmentViewModelBase {
  assignmentId: string;
  facts: AssignmentFacts;
}

export interface OfferAssignmentViewModel extends AssignmentViewModelBase {
  status: "offer";
  travelState: "do_not_travel";
  responseState: "awaiting_response";
}

export interface AcceptedWaitingAssignmentViewModel extends AssignmentViewModelBase {
  status: "accepted_waiting";
  travelState: "do_not_travel";
  responseState: "accepted";
}

export interface ConfirmedAssignmentViewModel extends AssignmentViewModelBase {
  status: "confirmed_travel_ready";
  travelState: "travel_ready";
  acknowledgementState: "pending" | "on_my_way";
  directionsUrl: string | null;
}

export interface CancelledAssignmentViewModel extends AssignmentViewModelBase {
  status: "cancelled";
  travelState: "do_not_travel";
  cancellationLabel: string;
}

export type AssignmentViewModel =
  | OfferAssignmentViewModel
  | AcceptedWaitingAssignmentViewModel
  | ConfirmedAssignmentViewModel
  | CancelledAssignmentViewModel;

export type WorkerAssignmentCardModel =
  | (OfferAssignmentViewModel & { state: "offer" })
  | (AcceptedWaitingAssignmentViewModel & { state: "accepted_waiting" })
  | (ConfirmedAssignmentViewModel & { state: "travel_ready" })
  | (CancelledAssignmentViewModel & { state: "cancelled" });

export interface WorkCardSkillPresentation {
  label: string;
  evidence: "confirmed_workmark" | "worker_stated";
}

export interface WorkCardPresentationModel {
  workerId: string;
  displayName: string;
  portraitUrl: string | null;
  primaryWorkCategory: string;
  confirmedWorkmarkCount: number;
  repeatContractorCount: number;
  recentActivityLabel: string;
  skills: readonly WorkCardSkillPresentation[];
  verificationLabels: readonly string[];
}

export interface ContractorWorkerPresentationModel {
  workerId: string;
  displayName: string;
  primaryWorkCategory: string;
  confirmedWorkmarkCount: number;
  relationship: "repeat" | "known" | "new";
  lastWorkedLabel: string | null;
}

export interface ContractorPresentationModel {
  contractorId: string;
  displayName: string;
  crew: {
    siteLabel: string;
    dateLabel: string;
    requiredWorkerCount: number;
    confirmedWorkerCount: number;
  };
  workers: readonly ContractorWorkerPresentationModel[];
}
