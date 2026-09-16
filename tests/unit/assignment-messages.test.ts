import { describe, expect, it } from "vitest";

import {
  formatWorkerAssignmentMessage,
  getParticipantDictionary,
  parseWorkerAssignmentWhatsAppResponse,
  participantLocales,
} from "@markd/i18n";

const facts = {
  workType: "General labour",
  contractorName: "Ridgeway Build",
  dateLabel: "Friday, 18 September",
  startTimeLabel: "07:00",
  rateLabel: "R450 for the day",
  areaLabel: "Parow East",
  reportingPoint: "Taxi rank, bay 4",
  travelDetail: "Pickup at 06:15",
  contactLabel: "MARKD coordinator",
};

describe("worker assignment messages", () => {
  it("maps the supported WhatsApp replies to canonical assignment responses", () => {
    expect(parseWorkerAssignmentWhatsAppResponse("yes")).toBe("accepted");
    expect(parseWorkerAssignmentWhatsAppResponse("1")).toBe("accepted");
    expect(parseWorkerAssignmentWhatsAppResponse("JA")).toBe("accepted");
    expect(parseWorkerAssignmentWhatsAppResponse("EWE")).toBe("accepted");
    expect(parseWorkerAssignmentWhatsAppResponse("NO")).toBe("declined");
    expect(parseWorkerAssignmentWhatsAppResponse("2")).toBe("declined");
    expect(parseWorkerAssignmentWhatsAppResponse("NEE")).toBe("declined");
    expect(parseWorkerAssignmentWhatsAppResponse("HAYI")).toBe("declined");
    expect(parseWorkerAssignmentWhatsAppResponse("call me")).toBe("call_me");
    expect(parseWorkerAssignmentWhatsAppResponse("3")).toBe("call_me");
    expect(parseWorkerAssignmentWhatsAppResponse("maybe")).toBeNull();
  });

  it("provides an offer, waiting, confirmed, and cancellation template in every pilot language", () => {
    for (const locale of participantLocales) {
      const dictionary = getParticipantDictionary(locale);
      const offer = formatWorkerAssignmentMessage("offer", facts, locale);
      const waiting = formatWorkerAssignmentMessage(
        "accepted_waiting",
        facts,
        locale,
      );
      const confirmed = formatWorkerAssignmentMessage(
        "confirmed_travel_ready",
        facts,
        locale,
      );
      const cancelled = formatWorkerAssignmentMessage(
        "cancelled",
        { cancellationLabel: "The contractor cancelled this work." },
        locale,
      );

      expect(offer).toContain(dictionary["travel.doNotTravelYet"]);
      expect(waiting).toContain(dictionary["travel.doNotTravelYet"]);
      expect(confirmed).toContain("Taxi rank, bay 4");
      expect(confirmed).toContain(dictionary["travel.travelReady"]);
      expect(cancelled).toContain(
        dictionary["assignment.cancelled.doNotTravel"],
      );
      expect(offer).not.toContain(dictionary["travel.travelReady"]);
      expect(waiting).not.toContain(dictionary["travel.travelReady"]);
    }
  });

  it("never tells a worker to travel in an offer or waiting message", () => {
    expect(formatWorkerAssignmentMessage("offer", facts, "en-ZA")).toContain(
      "DO NOT TRAVEL YET",
    );
    expect(
      formatWorkerAssignmentMessage("accepted_waiting", facts, "en-ZA"),
    ).toContain("ACCEPTED - WAITING FOR CONFIRMATION - DO NOT TRAVEL YET");
    expect(
      formatWorkerAssignmentMessage("confirmed_travel_ready", facts, "en-ZA"),
    ).toContain("WORK CONFIRMED - GO");
  });
});
