import { assertParticipantFixturesAllowed } from "./fixture-guard";
import type { ParticipantFixtureEnvironment } from "./fixture-guard";
import type {
  ContractorPresentationModel,
  WorkerAssignmentCardModel,
  WorkCardPresentationModel,
} from "./types";

export interface ParticipantFixtures {
  kind: "synthetic";
  workerCard: WorkCardPresentationModel;
  contractor: ContractorPresentationModel;
  assignments: readonly WorkerAssignmentCardModel[];
}

const participantFixtures: ParticipantFixtures = {
  kind: "synthetic",
  workerCard: {
    workerId: "00000000-0000-4000-8000-000000000126",
    displayName: "Anele Sample",
    portraitUrl: null,
    primaryWorkCategory: "General labour",
    confirmedWorkmarkCount: 8,
    repeatContractorCount: 3,
    recentActivityLabel: "Worked in 2 recent months",
    skills: [
      { label: "General labour", evidence: "confirmed_workmark" },
      { label: "Site preparation", evidence: "confirmed_workmark" },
      { label: "Team work", evidence: "worker_stated" },
    ],
    verificationLabels: ["Identity checked", "Confirmed work history"],
  },
  contractor: {
    contractorId: "00000000-0000-4000-8000-000000000127",
    displayName: "Cape Build Demo",
    crew: {
      siteLabel: "Bellville South demo site",
      dateLabel: "Thursday, 17 September 2026",
      requiredWorkerCount: 10,
      confirmedWorkerCount: 8,
    },
    workers: [
      {
        workerId: "00000000-0000-4000-8000-000000000126",
        displayName: "Anele Sample",
        primaryWorkCategory: "General labour",
        confirmedWorkmarkCount: 8,
        relationship: "repeat",
        lastWorkedLabel: "2 weeks ago",
      },
      {
        workerId: "00000000-0000-4000-8000-000000000128",
        displayName: "Thando Sample",
        primaryWorkCategory: "Site preparation",
        confirmedWorkmarkCount: 5,
        relationship: "known",
        lastWorkedLabel: "1 month ago",
      },
    ],
  },
  assignments: [
    {
      state: "offer",
      assignmentId: "00000000-0000-4000-8000-000000000129",
      status: "offer",
      travelState: "do_not_travel",
      responseState: "awaiting_response",
      facts: {
        workType: "General labour",
        contractorName: "Ridgeway Build Demo",
        dateLabel: "Friday, 18 September 2026",
        startTimeLabel: "07:00",
        rateLabel: "R450 for the day",
        areaLabel: "Parow East, Cape Town",
        reportingPoint: "Parow taxi rank information kiosk",
        travelDetail: "Pickup details follow after contractor confirmation",
        contactLabel: "MARKD demo coordinator",
      },
    },
    {
      state: "accepted_waiting",
      assignmentId: "00000000-0000-4000-8000-000000000130",
      status: "accepted_waiting",
      travelState: "do_not_travel",
      responseState: "accepted",
      facts: {
        workType: "Site preparation",
        contractorName: "Table Bay Projects Demo",
        dateLabel: "Saturday, 19 September 2026",
        startTimeLabel: "06:45",
        rateLabel: "R500 for the day",
        areaLabel: "Maitland, Cape Town",
        reportingPoint: "Maitland station main entrance",
        travelDetail: "Wait for confirmed pickup details",
        contactLabel: "MARKD demo coordinator",
      },
    },
    {
      state: "travel_ready",
      assignmentId: "00000000-0000-4000-8000-000000000131",
      status: "confirmed_travel_ready",
      travelState: "travel_ready",
      acknowledgementState: "pending",
      directionsUrl: null,
      facts: {
        workType: "General labour",
        contractorName: "Cape Build Demo",
        dateLabel: "Thursday, 17 September 2026",
        startTimeLabel: "06:30",
        rateLabel: "R480 for the day",
        areaLabel: "Bellville South, Cape Town",
        reportingPoint: "Bellville taxi rank, bay 4",
        travelDetail: "Pickup at 05:45 from bay 4",
        contactLabel: "Sipho Demo, MARKD coordinator",
      },
    },
  ],
};

export function getParticipantFixtures(
  environment: ParticipantFixtureEnvironment = process.env,
): ParticipantFixtures {
  assertParticipantFixturesAllowed(environment);
  return participantFixtures;
}
