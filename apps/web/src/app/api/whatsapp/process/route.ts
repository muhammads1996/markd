import { NextResponse } from "next/server";
import { actionDraftToRow, constantTimeEquals } from "@markd/messaging";
import type { ProposedActionDraft } from "@markd/contracts";
import {
  buildLanguageEvidence,
  extractIntent,
  HeuristicLanguageDetectionProvider,
  isSupportedLanguageCode,
  UnavailableTranscriptionProvider,
  type LanguageDetectionResult,
} from "@markd/language";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// FLO-110: turns queued ChannelEvents into language-neutral ProposedActions.
// Internal trigger only (cron/Edge Function), not reachable from WhatsApp
// directly. AI/heuristics only ever produce a draft here; nothing in this
// route mutates the canonical Work Graph.

const languageDetector = new HeuristicLanguageDetectionProvider();
const transcriptionProvider = new UnavailableTranscriptionProvider();

type ChannelEventRow = {
  id: string;
  payload: Record<string, unknown>;
  event_type: string;
};

type ChannelMediaRow = {
  id: string;
  provider_media_id: string;
  media_type: string;
};

export async function POST(request: Request) {
  const expectedToken = process.env.WHATSAPP_PROCESS_TOKEN;
  const authorization = request.headers.get("authorization");
  const providedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (!expectedToken || !constantTimeEquals(providedToken, expectedToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const client = createSupabaseAdminClient();
  const { data: jobs, error: claimError } = await client.rpc(
    "claim_channel_processing_jobs",
    { batch_size: 10 },
  );
  if (claimError) {
    return NextResponse.json({ error: "claim failed" }, { status: 503 });
  }

  const results: Array<{ jobId: string; outcome: string }> = [];
  for (const job of jobs ?? []) {
    const outcome = await processJob(client, job.channel_event_id as string);
    await client.rpc("complete_channel_processing_job", {
      job_id: job.id,
      succeeded: outcome !== "failed",
    });
    results.push({ jobId: job.id as string, outcome });
  }

  return NextResponse.json({ processed: results.length, results });
}

async function processJob(
  client: ReturnType<typeof createSupabaseAdminClient>,
  channelEventId: string,
): Promise<"created" | "skipped" | "failed"> {
  const { data: event, error } = await client
    .from("channel_events")
    .select("id, payload, event_type")
    .eq("id", channelEventId)
    .single<ChannelEventRow>();
  if (error || !event || event.event_type !== "message") return "skipped";

  const text = extractText(event.payload);
  const { data: mediaRows } = await client
    .from("channel_media_assets")
    .select("id, provider_media_id, media_type")
    .eq("channel_event_id", channelEventId)
    .returns<ChannelMediaRow[]>();
  const voiceNote = (mediaRows ?? []).find((row) => row.media_type === "audio");

  let transcript: string | null = null;
  let transcriptConfidence: number | null = null;
  let detection: LanguageDetectionResult | null = null;

  if (text) {
    detection = await languageDetector.detect(text);
  } else if (voiceNote) {
    const transcription = await transcriptionProvider.transcribe({
      mediaUrl: voiceNote.provider_media_id,
      mimeType: "audio/ogg",
    });
    if (transcription) {
      transcript = transcription.transcript;
      transcriptConfidence = transcription.confidence;
      if (transcription.languageCode) {
        detection = {
          languageCode: transcription.languageCode,
          confidence: transcription.confidence,
        };
      }
      await client
        .from("channel_media_assets")
        .update({
          transcript,
          transcript_confidence: transcriptConfidence,
          detected_language_code: transcription.languageCode,
        })
        .eq("id", voiceNote.id);
    } else {
      // Voice note captured but no transcription vendor configured yet; an
      // operator can still listen to the source media from the Ops Inbox.
      return "skipped";
    }
  } else {
    return "skipped";
  }

  if (detection && event.event_type === "message" && text) {
    await client
      .from("channel_events")
      .update({
        detected_language_code: detection.languageCode,
        detected_language_confidence: detection.confidence,
      })
      .eq("id", channelEventId);
  }

  const interpretationText = text ?? transcript;
  if (!interpretationText) return "skipped";

  const languageCode = isSupportedLanguageCode(detection?.languageCode)
    ? detection.languageCode
    : null;
  const intent = extractIntent(interpretationText, languageCode);
  if (!intent) return "skipped";

  const evidence = buildLanguageEvidence({
    originalText: text ?? null,
    transcript,
    transcriptConfidence,
    detection,
  });

  const draft: ProposedActionDraft = {
    channelEventId,
    payload: {
      actionType: intent.actionType,
      fields: intent.fields,
      entityIds: {},
    },
    confidence: intent.confidence,
    ambiguity: intent.ambiguity,
    riskTier: "informational",
    entityResolution: {},
    interpretation: { ...evidence },
    modelProvider: "markd-heuristic",
    modelName: "language-rules-v1",
  };

  const { error: insertError } = await client
    .from("proposed_actions")
    .insert(actionDraftToRow(draft) as never);
  return insertError ? "failed" : "created";
}

function extractText(payload: Record<string, unknown>): string | null {
  const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
  const changes =
    entry && typeof entry === "object"
      ? (entry as Record<string, unknown>).changes
      : null;
  const value = Array.isArray(changes)
    ? (changes[0] as Record<string, unknown> | undefined)?.value
    : null;
  const message =
    value && typeof value === "object"
      ? (
          (value as Record<string, unknown>).messages as unknown[] | undefined
        )?.[0]
      : null;
  const body =
    message && typeof message === "object"
      ? (
          (message as Record<string, unknown>).text as
            Record<string, unknown> | undefined
        )?.body
      : null;
  return typeof body === "string" ? body : null;
}
