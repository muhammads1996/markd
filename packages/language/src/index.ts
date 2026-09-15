export const supportedLanguageCodes = ["en", "af", "xh"] as const;
export type SupportedLanguageCode = (typeof supportedLanguageCodes)[number];

export const assignmentMessageKeys = [
  "assignment.offer",
  "assignment.confirmed",
  "assignment.cancelled",
] as const;
export type AssignmentMessageKey = (typeof assignmentMessageKeys)[number];

export interface AssignmentCopyVariables {
  rateLabel: string;
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
}

type CopyTemplate = (variables: AssignmentCopyVariables) => string;

const assignmentCopyTemplates: Record<
  AssignmentMessageKey,
  Record<SupportedLanguageCode, CopyTemplate>
> = {
  "assignment.offer": {
    en: (v) =>
      `Work offer: ${v.rateLabel} on ${v.dateLabel} at ${v.timeLabel}, ${v.locationLabel}. Reply YES to accept.`,
    af: (v) =>
      `Werkaanbod: ${v.rateLabel} op ${v.dateLabel} om ${v.timeLabel}, ${v.locationLabel}. Antwoord JA om te aanvaar.`,
    xh: (v) =>
      `Isicelo somsebenzi: ${v.rateLabel} nge ${v.dateLabel} nge ${v.timeLabel}, ${v.locationLabel}. Phendula EWE ukuvuma.`,
  },
  "assignment.confirmed": {
    en: (v) =>
      `Confirmed job: ${v.rateLabel} on ${v.dateLabel} at ${v.timeLabel}, ${v.locationLabel}.`,
    af: (v) =>
      `Bevestigde werk: ${v.rateLabel} op ${v.dateLabel} om ${v.timeLabel}, ${v.locationLabel}.`,
    xh: (v) =>
      `Umsebenzi oqinisekisiweyo: ${v.rateLabel} nge ${v.dateLabel} nge ${v.timeLabel}, ${v.locationLabel}.`,
  },
  "assignment.cancelled": {
    en: (v) =>
      `Cancelled: the job on ${v.dateLabel} at ${v.locationLabel} will not go ahead.`,
    af: (v) =>
      `Gekanselleer: die werk op ${v.dateLabel} by ${v.locationLabel} gaan nie voort nie.`,
    xh: (v) =>
      `Kurhoxisiwe: umsebenzi nge ${v.dateLabel} ku ${v.locationLabel} awuyi kuqhubeka.`,
  },
};

export function renderAssignmentCopy(
  key: AssignmentMessageKey,
  languageCode: SupportedLanguageCode,
  variables: AssignmentCopyVariables,
): string {
  return assignmentCopyTemplates[key][languageCode](variables);
}

export interface ParticipantCopyPreference {
  languageCode: SupportedLanguageCode;
  readAloudEnabled: boolean;
}

export function resolveParticipantCopy(
  key: AssignmentMessageKey,
  preference: ParticipantCopyPreference,
  variables: AssignmentCopyVariables,
): { text: string; readAloud: boolean } {
  return {
    text: renderAssignmentCopy(key, preference.languageCode, variables),
    readAloud: preference.readAloudEnabled,
  };
}
