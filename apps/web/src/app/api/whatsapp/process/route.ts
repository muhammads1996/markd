import { NextResponse } from "next/server";
import { actionDraftToRow } from "@markd/messaging";
import {
  validateProposedActionDraft,
  type ProposedActionDraft,
} from "@markd/contracts";
import {
  buildLanguageEvidence,
  extractIntent,
  isSupportedLanguageCode,
  OpenRouterProviderError,
  type LanguageDetectionResult,
  type ProviderExecutionEvidence,
} from "@markd/language";
import { WhatsAppProviderError, type WhatsAppProvider } from "@markd/messaging";
import { isInternalServiceRequestAuthorized } from "@/lib/internal-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getLanguageProcessingProviders,
  getWhatsAppProvider,
  WHATSAPP_MEDIA_BUCKET,
  type LanguageProcessingProviders,
} from "@/lib/whatsapp/providers";

// FLO-110: turns queued ChannelEvents into language-neutral ProposedActions.
// Internal trigger only (cron/Edge Function), not reachable from WhatsApp
// directly. AI/heuristics only ever produce a draft here; nothing in this
// route mutates the canonical Work Graph.

type ChannelEventRow = {
  id: string;
  payload: Record<string, unknown>;
  event_type: string;
};

type ChannelMediaRow = {
  id: string;
  provider_media_id: string;
  media_type: string;
  mime_type: string | null;
  retrieval_state: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export async function POST(request: Request) {
  if (!isInternalServiceRequestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const client = createSupabaseAdminClient();
  const { error: recoveryError } = await client.rpc(
    "requeue_expired_channel_processing_jobs",
  );
  if (recoveryError) {
    return NextResponse.json({ error: "recovery failed" }, { status: 503 });
  }
  const providers = getLanguageProcessingProviders();
  const { data: jobs, error: claimError } = await client.rpc(
    "claim_channel_processing_jobs",
    { batch_size: 10 },
  );
  if (claimError) {
    return NextResponse.json({ error: "claim failed" }, { status: 503 });
  }

  const results: Array<{ jobId: string; outcome: string }> = [];
  for (const job of jobs ?? []) {
    const jobId = job.id as string;
    let outcome: "created" | "skipped" | "failed";
    let errorMessage: string | null = null;
    let retryable = true;
    try {
      outcome = await processJob(
        client,
        job.channel_event_id as string,
        providers,
      );
    } catch (error) {
      outcome = "failed";
      ({ errorMessage, retryable } = processingFailure(error));
    }
    await client.rpc("complete_channel_processing_job", {
      job_id: jobId,
      succeeded: outcome !== "failed",
      error_message: errorMessage,
      retryable,
    });
    results.push({ jobId, outcome });
  }

  return NextResponse.json({ processed: results.length, results });
}

async function processJob(
  client: ReturnType<typeof createSupabaseAdminClient>,
  channelEventId: string,
  providers: LanguageProcessingProviders,
): Promise<"created" | "skipped"> {
  const { data: event, error } = await client
    .from("channel_events")
    .select("id, payload, event_type")
    .eq("id", channelEventId)
    .single<ChannelEventRow>();
  if (error || !event || event.event_type !== "message") return "skipped";

  const text = extractText(event.payload);
  const { data: mediaRows } = await client
    .from("channel_media_assets")
    .select(
      "id, provider_media_id, media_type, mime_type, retrieval_state, storage_bucket, storage_path",
    )
    .eq("channel_event_id", channelEventId)
    .returns<ChannelMediaRow[]>();
  const voiceNote = (mediaRows ?? []).find((row) => row.media_type === "audio");

  let transcript: string | null = null;
  let transcriptConfidence: number | null = null;
  let detection: LanguageDetectionResult | null = null;
  let transcriptionEvidence: ProviderExecutionEvidence | null = null;

  if (text) {
    detection = await providers.languageDetector.detect(text);
  } else if (voiceNote) {
    if (!providers.liveProviderEnabled) return "skipped";
    const media = await retrieveMedia(client, voiceNote, channelEventId);
    const transcription = await providers.transcriptionProvider.transcribe({
      mediaBytes: media.bytes,
      mimeType: media.mimeType,
    });
    if (transcription) {
      transcript = transcription.transcript;
      transcriptConfidence = transcription.confidence;
      transcriptionEvidence = transcription.providerEvidence ?? null;
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
          transcription_provider: transcriptionEvidence?.provider ?? null,
          transcription_model: transcriptionEvidence?.model ?? null,
          transcription_latency_ms: transcriptionEvidence?.latencyMs ?? null,
          transcription_metadata: transcriptionEvidence ?? {},
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

  if (detection && event.event_type === "message") {
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
  let intent = extractIntent(interpretationText, languageCode);
  let intentEvidence: ProviderExecutionEvidence | null = null;
  if (providers.structuredIntentProvider) {
    const structuredIntent = await providers.structuredIntentProvider.extract({
      text: interpretationText,
      languageCode,
    });
    intent = structuredIntent;
    intentEvidence = structuredIntent?.providerEvidence ?? null;
  }
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
    ambiguity:
      transcriptConfidence !== null && transcriptConfidence < 0.8
        ? "ambiguous"
        : intent.ambiguity,
    riskTier: intentEvidence ? "operational" : "informational",
    entityResolution: {},
    interpretation: {
      ...evidence,
      ...(transcriptionEvidence
        ? { transcriptionProvider: transcriptionEvidence }
        : {}),
      ...(intentEvidence ? { structuredIntentProvider: intentEvidence } : {}),
    },
    modelProvider: intentEvidence?.provider ?? "markd-heuristic",
    modelName: intentEvidence?.model ?? "language-rules-v1",
  };

  if (validateProposedActionDraft(draft).length > 0) return "skipped";
  const { error: insertError } = await client
    .from("proposed_actions")
    .upsert(actionDraftToRow(draft) as never, {
      onConflict: "channel_event_id",
      ignoreDuplicates: true,
    });
  if (insertError) throw new Error("proposed action persistence failed");
  return "created";
}

async function retrieveMedia(
  client: ReturnType<typeof createSupabaseAdminClient>,
  asset: ChannelMediaRow,
  channelEventId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  try {
    if (asset.retrieval_state === "retrieved" && asset.storage_path) {
      const { data, error } = await client.storage
        .from(asset.storage_bucket ?? WHATSAPP_MEDIA_BUCKET)
        .download(asset.storage_path);
      if (error || !data) {
        throw new WhatsAppProviderError(
          "Stored WhatsApp media was unavailable.",
          true,
        );
      }
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        mimeType: asset.mime_type ?? data.type ?? "audio/ogg",
      };
    }

    const provider: WhatsAppProvider = getWhatsAppProvider();
    const downloaded = await provider.getMedia({
      providerMediaId: asset.provider_media_id,
    });
    const storagePath = `channel-events/${channelEventId}/${asset.id}.${mediaExtension(downloaded.mimeType)}`;
    const { error: uploadError } = await client.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .upload(storagePath, downloaded.bytes, {
        cacheControl: "0",
        contentType: downloaded.mimeType,
        upsert: true,
      });
    if (uploadError) {
      throw new WhatsAppProviderError("Private media storage failed.", true);
    }
    const { error: updateError } = await client
      .from("channel_media_assets")
      .update({
        mime_type: downloaded.mimeType,
        retrieval_state: "retrieved",
        storage_bucket: WHATSAPP_MEDIA_BUCKET,
        storage_path: storagePath,
        failure_reason: null,
      })
      .eq("id", asset.id);
    if (updateError) {
      throw new WhatsAppProviderError("Media evidence update failed.", true);
    }
    return { bytes: downloaded.bytes, mimeType: downloaded.mimeType };
  } catch (error) {
    const failure = processingFailure(error);
    await client
      .from("channel_media_assets")
      .update({
        retrieval_state: "failed",
        failure_reason: failure.errorMessage,
      })
      .eq("id", asset.id);
    throw error;
  }
}

function mediaExtension(mimeType: string): string {
  const subtype = mimeType.toLowerCase().split(";", 1)[0]?.split("/")[1];
  if (!subtype || !/^[a-z0-9]+$/u.test(subtype)) return "bin";
  return subtype === "mpeg" ? "mp3" : subtype === "x-wav" ? "wav" : subtype;
}

function processingFailure(error: unknown): {
  errorMessage: string;
  retryable: boolean;
} {
  if (
    error instanceof WhatsAppProviderError ||
    error instanceof OpenRouterProviderError
  ) {
    return { errorMessage: error.message, retryable: error.retryable };
  }
  return { errorMessage: "provider processing failed", retryable: true };
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
