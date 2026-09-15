import { describe, expect, it } from "vitest";

import { getParticipantFixtures } from "../../apps/web/src/lib/participant/fixtures";
import { formatAssignmentReadAloud } from "../../apps/web/src/lib/participant/read-aloud";

describe("participant assignment read-aloud", () => {
  it("places travel state first and includes every critical assignment fact", () => {
    const assignment = getParticipantFixtures({
      NODE_ENV: "test",
      MARKD_PARTICIPANT_FIXTURES: "1",
    }).assignments.find(({ status }) => status === "confirmed_travel_ready");
    if (!assignment) throw new Error("Confirmed fixture is required.");

    const speech = formatAssignmentReadAloud(assignment, "en-ZA");

    expect(speech.startsWith("YOU CAN TRAVEL. THIS JOB IS CONFIRMED.")).toBe(
      true,
    );
    for (const fact of Object.values(assignment.facts)) {
      expect(speech).toContain(fact);
    }
  });

  it("uses the selected locale without changing assignment facts", () => {
    const assignment = getParticipantFixtures({
      NODE_ENV: "test",
      MARKD_PARTICIPANT_FIXTURES: "1",
    }).assignments.find(({ status }) => status === "offer");
    if (!assignment) throw new Error("Offer fixture is required.");

    const speech = formatAssignmentReadAloud(assignment, "xh-ZA");

    expect(speech.startsWith("MUSA UKUHAMBA OKWANGOKU")).toBe(true);
    expect(speech).toContain(assignment.facts.rateLabel);
    expect(speech).toContain(assignment.facts.reportingPoint);
  });
});
