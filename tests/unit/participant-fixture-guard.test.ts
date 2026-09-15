import { describe, expect, it } from "vitest";

import { assertParticipantFixturesAllowed } from "../../apps/web/src/lib/participant/fixture-guard";

describe("participant fixture guard", () => {
  it("rejects fixtures in production even when the fixture flag is set", () => {
    expect(() =>
      assertParticipantFixturesAllowed({
        NODE_ENV: "production",
        MARKD_PARTICIPANT_FIXTURES: "1",
      }),
    ).toThrow("Participant fixtures are disabled in production.");
  });

  it("requires an explicit flag outside production", () => {
    expect(() =>
      assertParticipantFixturesAllowed({ NODE_ENV: "test" }),
    ).toThrow("Set MARKD_PARTICIPANT_FIXTURES=1");
    expect(() =>
      assertParticipantFixturesAllowed({
        NODE_ENV: "test",
        MARKD_PARTICIPANT_FIXTURES: "1",
      }),
    ).not.toThrow();
  });
});
