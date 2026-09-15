// FLO-110: provider-abstracted multilingual text/voice processing.
//
// Language and transcription providers are interfaces so a real detection or
// speech-to-text vendor can be plugged in later without changing callers.
// Nothing here mutates the Work Graph; callers turn the language-neutral
// output into a ProposedActionDraft, which still passes through the normal
// validation/confirmation policy in @markd/contracts.
import type {
  ProposedActionAmbiguity,
  ProposedActionType,
} from "@markd/contracts";

export const supportedLanguageCodes = ["en", "af", "xh"] as const;
export type SupportedLanguageCode = (typeof supportedLanguageCodes)[number];

export function isSupportedLanguageCode(
  value: string | null | undefined,
): value is SupportedLanguageCode {
  return (
    typeof value === "string" &&
    (supportedLanguageCodes as readonly string[]).includes(value)
  );
}

export interface LanguageDetectionResult {
  languageCode: SupportedLanguageCode;
  confidence: number;
}

export interface LanguageDetectionProvider {
  detect(text: string): Promise<LanguageDetectionResult | null>;
}

export interface TranscriptionInput {
  mediaUrl: string;
  mimeType: string;
}

export interface TranscriptionResult {
  transcript: string;
  languageCode: SupportedLanguageCode | null;
  confidence: number;
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult | null>;
}

const languageKeywords: Record<SupportedLanguageCode, readonly string[]> = {
  en: ["available", "work", "tomorrow", "today", "need", "workers", "rate"],
  af: ["beskikbaar", "werk", "môre", "vandag", "nodig", "werkers", "tarief"],
  xh: [
    "ndiyakwazi",
    "umsebenzi",
    "ngomso",
    "namhlanje",
    "kufuneka",
    "abasebenzi",
  ],
};

/**
 * Deterministic keyword-frequency detector used when no live provider is
 * configured for the pilot. It never fabricates confidence beyond what the
 * keyword overlap supports, and returns null rather than guessing.
 */
export class HeuristicLanguageDetectionProvider implements LanguageDetectionProvider {
  async detect(text: string): Promise<LanguageDetectionResult | null> {
    const normalized = text.toLowerCase();
    let best: { code: SupportedLanguageCode; hits: number } | null = null;
    for (const code of supportedLanguageCodes) {
      const hits = languageKeywords[code].filter((word) =>
        normalized.includes(word),
      ).length;
      if (hits > 0 && (!best || hits > best.hits)) {
        best = { code, hits };
      }
    }
    if (!best) return null;
    const confidence = Math.min(0.6 + best.hits * 0.1, 0.95);
    return { languageCode: best.code, confidence };
  }
}

/** No transcription vendor is wired up for the pilot yet; callers must treat
 * a null result as "voice note pending transcription", not a failure. */
export class UnavailableTranscriptionProvider implements TranscriptionProvider {
  async transcribe(
    _input: TranscriptionInput,
  ): Promise<TranscriptionResult | null> {
    return null;
  }
}

export interface LanguageEvidence {
  originalText: string | null;
  transcript: string | null;
  transcriptConfidence: number | null;
  detectedLanguageCode: SupportedLanguageCode | null;
  detectionConfidence: number | null;
}

export function buildLanguageEvidence(input: {
  originalText?: string | null;
  transcript?: string | null;
  transcriptConfidence?: number | null;
  detection?: LanguageDetectionResult | null;
}): LanguageEvidence {
  return {
    originalText: input.originalText ?? null,
    transcript: input.transcript ?? null,
    transcriptConfidence: input.transcriptConfidence ?? null,
    detectedLanguageCode: input.detection?.languageCode ?? null,
    detectionConfidence: input.detection?.confidence ?? null,
  };
}

export interface ExtractedIntent {
  actionType: ProposedActionType;
  fields: Record<string, string | number | boolean | null>;
  confidence: number;
  ambiguity: ProposedActionAmbiguity;
}

interface IntentRule {
  actionType: ProposedActionType;
  keywords: readonly string[];
  extractFields: (
    text: string,
  ) => Record<string, string | number | boolean | null>;
}

const availabilityDateWords: Record<
  SupportedLanguageCode,
  Record<string, string>
> = {
  en: { today: "today", tomorrow: "tomorrow" },
  af: { vandag: "today", môre: "tomorrow", more: "tomorrow" },
  xh: { namhlanje: "today", ngomso: "tomorrow" },
};

const intentRulesByLanguage: Record<
  SupportedLanguageCode,
  readonly IntentRule[]
> = {
  en: [
    {
      actionType: "worker_availability",
      keywords: ["available", "free to work"],
      extractFields: (text) => ({ availability: matchDateWord(text, "en") }),
    },
    {
      actionType: "labour_request",
      keywords: ["need workers", "need", "how many workers"],
      extractFields: (text) => ({ headcount: matchHeadcount(text) }),
    },
  ],
  af: [
    {
      actionType: "worker_availability",
      keywords: ["beskikbaar"],
      extractFields: (text) => ({ availability: matchDateWord(text, "af") }),
    },
    {
      actionType: "labour_request",
      keywords: ["werkers nodig", "nodig"],
      extractFields: (text) => ({ headcount: matchHeadcount(text) }),
    },
  ],
  xh: [
    {
      actionType: "worker_availability",
      keywords: ["ndiyakwazi", "ndikhona"],
      extractFields: (text) => ({ availability: matchDateWord(text, "xh") }),
    },
    {
      actionType: "labour_request",
      keywords: ["kufuneka abasebenzi", "kufuneka"],
      extractFields: (text) => ({ headcount: matchHeadcount(text) }),
    },
  ],
};

function matchDateWord(
  text: string,
  code: SupportedLanguageCode,
): string | null {
  const normalized = text.toLowerCase();
  for (const [word, value] of Object.entries(availabilityDateWords[code])) {
    if (normalized.includes(word)) return value;
  }
  return null;
}

function matchHeadcount(text: string): number | null {
  const match = text.match(/\b(\d{1,3})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Rule-based, deterministic intent extraction for the two initial message
 * types (worker_availability, labour_request). This is intentionally simple
 * and swappable: a future StructuredIntentProvider can replace it behind the
 * same shape without changing how callers build ProposedActionDrafts.
 */
export function extractIntent(
  text: string,
  languageCode: SupportedLanguageCode | null,
): ExtractedIntent | null {
  const normalized = text.toLowerCase();
  const languages = languageCode ? [languageCode] : supportedLanguageCodes;
  for (const code of languages) {
    for (const rule of intentRulesByLanguage[code]) {
      if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
        const fields = rule.extractFields(text);
        const hasUnresolvedField = Object.values(fields).some(
          (value) => value === null,
        );
        return {
          actionType: rule.actionType,
          fields,
          confidence: hasUnresolvedField ? 0.55 : 0.8,
          ambiguity: hasUnresolvedField ? "ambiguous" : "clear",
        };
      }
    }
  }
  return null;
}

// --- Shared language-neutral copy for WhatsApp templates and app UI ---
//
// These keys and templates are the single source of copy for worker-facing
// Assignment states. The same deterministic string is used for on-screen
// text and for device text-to-speech ("LISTEN"); nothing here paraphrases or
// invents a rate, date, time or location that is not passed in as a variable.
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

/** Combines a participant's stored language/read-aloud preference with a
 * message key into the single deterministic string used for both the app
 * screen and any read-aloud (TTS) rendering of it. */
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
