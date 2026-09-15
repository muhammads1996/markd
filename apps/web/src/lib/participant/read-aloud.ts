import {
  getParticipantDictionary,
  type ParticipantLocale,
  type ParticipantMessageKey,
} from "@markd/i18n";

import type { AssignmentStatus, AssignmentViewModel } from "./types";

const travelMessageKeyByStatus = {
  offer: "travel.doNotTravelYet",
  accepted_waiting: "travel.doNotTravelYet",
  confirmed_travel_ready: "travel.travelReady",
  cancelled: "travel.doNotTravel",
} as const satisfies Record<AssignmentStatus, ParticipantMessageKey>;

export function formatAssignmentReadAloud(
  assignment: AssignmentViewModel,
  locale: ParticipantLocale,
): string {
  const dictionary = getParticipantDictionary(locale);
  const facts = assignment.facts;
  const travelMessage = dictionary[travelMessageKeyByStatus[assignment.status]];
  const factSegments = [
    ["fact.workType", facts.workType],
    ["fact.contractor", facts.contractorName],
    ["fact.date", facts.dateLabel],
    ["fact.startTime", facts.startTimeLabel],
    ["fact.rate", facts.rateLabel],
    ["fact.area", facts.areaLabel],
    ["fact.reportingPoint", facts.reportingPoint],
    ["fact.travel", facts.travelDetail],
    ["fact.contact", facts.contactLabel],
  ] as const satisfies readonly (readonly [ParticipantMessageKey, string])[];

  return `${travelMessage} ${factSegments
    .map(([key, value]) => `${dictionary[key]}: ${value}`)
    .join("; ")}.`;
}

export const formatAssignmentForSpeech = formatAssignmentReadAloud;
