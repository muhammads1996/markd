export type ParticipantFixtureEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function assertParticipantFixturesAllowed(
  environment: ParticipantFixtureEnvironment = process.env,
): void {
  if (environment.NODE_ENV === "production") {
    throw new Error("Participant fixtures are disabled in production.");
  }

  if (environment.MARKD_PARTICIPANT_FIXTURES !== "1") {
    throw new Error(
      "Set MARKD_PARTICIPANT_FIXTURES=1 to load participant fixtures.",
    );
  }
}
