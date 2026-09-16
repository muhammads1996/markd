import { describe, expect, it } from "vitest";
import {
  getParticipantDictionary,
  participantDictionaries,
  participantLanguageByLocale,
  participantLocaleByLanguage,
  participantMessageKeys,
} from "@markd/i18n";

describe("participant dictionaries", () => {
  const ticketKeys = [
    "assignment.offer.title",
    "assignment.offer.doNotTravel",
    "assignment.offer.takeJob",
    "assignment.offer.cantGo",
    "assignment.offer.callMe",
    "assignment.offer.listen",
    "assignment.offer.question",
    "assignment.offer.replyTake",
    "assignment.offer.replyDecline",
    "assignment.offer.replyCall",
    "assignment.offer.voiceNote",
    "assignment.offer.callRequested",
    "assignment.accepted.title",
    "assignment.accepted.waiting",
    "assignment.accepted.doNotTravel",
    "assignment.accepted.confirmation",
    "assignment.confirmed.title",
    "assignment.confirmed.travelReady",
    "assignment.confirmed.go",
    "assignment.confirmed.onMyWay",
    "assignment.confirmed.directions",
    "assignment.changed",
    "assignment.cancelled",
    "assignment.cancelled.doNotTravel",
    "workCard.workmarks",
    "workCard.repeatContractors",
    "workCard.demonstratedSkills",
    "workCard.verified",
    "contractor.crewReady",
    "contractor.openPositions",
    "contractor.hireAgain",
    "contractor.knownWorker",
    "profile.language",
    "profile.readAloud",
    "profile.whatsapp",
    "profile.travelPreferences",
    "common.loading",
    "common.offline",
    "common.tryAgain",
    "common.close",
  ] as const;

  it("keeps identical required key coverage in every language", () => {
    const requiredKeys = [...participantMessageKeys].sort();

    for (const dictionary of Object.values(participantDictionaries)) {
      expect(Object.keys(dictionary).sort()).toEqual(requiredKeys);
      for (const key of ticketKeys) expect(dictionary[key]).toBeTruthy();
    }
  });

  it("maps the pilot language codes to South African BCP-47 locales", () => {
    expect(participantLocaleByLanguage).toEqual({
      en: "en-ZA",
      af: "af-ZA",
      xh: "xh-ZA",
    });
    expect(participantLanguageByLocale).toEqual({
      "en-ZA": "en",
      "af-ZA": "af",
      "xh-ZA": "xh",
    });
    expect(getParticipantDictionary("xh-ZA")).toBe(participantDictionaries.xh);
  });
});
