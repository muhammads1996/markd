import { describe, expect, it } from "vitest";
import {
  buildLanguageEvidence,
  extractIntent,
  HeuristicLanguageDetectionProvider,
  renderAssignmentCopy,
  resolveParticipantCopy,
  UnavailableTranscriptionProvider,
} from "@markd/language";

const variables = {
  rateLabel: "R450",
  dateLabel: "12 Sep",
  timeLabel: "07:00",
  locationLabel: "Site A",
};

describe("language detection", () => {
  it("detects English from keyword overlap", async () => {
    const result = await new HeuristicLanguageDetectionProvider().detect(
      "I am available to work tomorrow",
    );
    expect(result?.languageCode).toBe("en");
  });

  it("detects Afrikaans from keyword overlap", async () => {
    const result = await new HeuristicLanguageDetectionProvider().detect(
      "Ek is beskikbaar om môre te werk",
    );
    expect(result?.languageCode).toBe("af");
  });

  it("detects isiXhosa from keyword overlap", async () => {
    const result = await new HeuristicLanguageDetectionProvider().detect(
      "Ndiyakwazi ukusebenza ngomso",
    );
    expect(result?.languageCode).toBe("xh");
  });

  it("returns null rather than guessing when nothing matches", async () => {
    const result = await new HeuristicLanguageDetectionProvider().detect("xyz");
    expect(result).toBeNull();
  });
});

describe("transcription provider abstraction", () => {
  it("signals no vendor is configured rather than fabricating a transcript", async () => {
    const result = await new UnavailableTranscriptionProvider().transcribe({
      mediaUrl: "media-1",
      mimeType: "audio/ogg",
    });
    expect(result).toBeNull();
  });
});

describe("extractIntent", () => {
  it("extracts a clear worker_availability intent in English", () => {
    const intent = extractIntent("I am available tomorrow", "en");
    expect(intent).toMatchObject({
      actionType: "worker_availability",
      fields: { availability: "tomorrow" },
      ambiguity: "clear",
    });
  });

  it("extracts a clear worker_availability intent in Afrikaans", () => {
    const intent = extractIntent("Ek is beskikbaar vandag", "af");
    expect(intent).toMatchObject({
      fields: { availability: "today" },
      ambiguity: "clear",
    });
  });

  it("extracts a clear worker_availability intent in isiXhosa", () => {
    const intent = extractIntent("Ndiyakwazi ngomso", "xh");
    expect(intent).toMatchObject({
      fields: { availability: "tomorrow" },
      ambiguity: "clear",
    });
  });

  it("marks a labour_request ambiguous when headcount is missing", () => {
    const intent = extractIntent("We need workers next week", "en");
    expect(intent).toMatchObject({
      actionType: "labour_request",
      fields: { headcount: null },
      ambiguity: "ambiguous",
    });
  });

  it("extracts a clear labour_request intent with a headcount", () => {
    const intent = extractIntent("We need 4 workers", "en");
    expect(intent).toMatchObject({
      actionType: "labour_request",
      fields: { headcount: 4 },
      ambiguity: "clear",
    });
  });

  it("returns null when no rule matches", () => {
    expect(extractIntent("hello there", "en")).toBeNull();
  });
});

describe("shared language-neutral copy", () => {
  it("renders deterministic offer copy per language using the same variables", () => {
    expect(renderAssignmentCopy("assignment.offer", "en", variables)).toBe(
      "Work offer: R450 on 12 Sep at 07:00, Site A. Reply YES to accept.",
    );
    expect(renderAssignmentCopy("assignment.offer", "af", variables)).toContain(
      "R450",
    );
    expect(renderAssignmentCopy("assignment.offer", "xh", variables)).toContain(
      "Site A",
    );
  });

  it("uses the same deterministic text for on-screen display and read-aloud", () => {
    const preference = { languageCode: "en" as const, readAloudEnabled: true };
    const resolved = resolveParticipantCopy(
      "assignment.confirmed",
      preference,
      variables,
    );
    expect(resolved.text).toBe(
      renderAssignmentCopy("assignment.confirmed", "en", variables),
    );
    expect(resolved.readAloud).toBe(true);
  });
});

describe("buildLanguageEvidence", () => {
  it("preserves original text, transcript and confidence separately", () => {
    const evidence = buildLanguageEvidence({
      originalText: "hello",
      transcript: null,
      transcriptConfidence: null,
      detection: { languageCode: "en", confidence: 0.7 },
    });
    expect(evidence).toEqual({
      originalText: "hello",
      transcript: null,
      transcriptConfidence: null,
      detectedLanguageCode: "en",
      detectionConfidence: 0.7,
    });
  });
});
