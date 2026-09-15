from __future__ import annotations

from dataclasses import asdict
from typing import Any

from psycopg.types.json import Jsonb

from app.core.config import Settings
from app.integrations.database import Database
from app.integrations.language import (
    ExtractedIntent,
    HeuristicLanguageDetector,
    LanguageDetection,
    OpenRouterProvider,
    OpenRouterProviderError,
    extract_intent,
)
from app.integrations.storage import download_private_object, upload_private_object
from app.integrations.whatsapp import MetaWhatsAppCloudProvider, WhatsAppProviderError

WHATSAPP_MEDIA_BUCKET = "whatsapp-media"


async def run_processing_jobs(
    database: Database, settings: Settings, batch_size: int = 10
) -> list[dict[str, str]]:
    async with database.service_transaction() as connection:
        await connection.execute(
            "select public.requeue_expired_channel_processing_jobs()"
        )
        result = await connection.execute(
            "select * from public.claim_channel_processing_jobs(%s)", (batch_size,)
        )
        jobs = await result.fetchall()

    outcomes: list[dict[str, str]] = []
    for job in jobs:
        job_id = str(job["id"])
        message: str | None
        try:
            async with database.service_transaction() as connection:
                outcome = await _process_message_job(
                    connection, str(job["channel_event_id"]), settings
                )
        except Exception as error:
            outcome = "failed"
            message, retryable = _processing_failure(error)
        else:
            message, retryable = None, False
        async with database.service_transaction() as connection:
            await connection.execute(
                "select public.complete_channel_processing_job(%s::uuid, %s, %s, %s)",
                (job_id, outcome != "failed", message, retryable),
            )
        outcomes.append({"job_id": job_id, "outcome": outcome})
    return outcomes


async def run_delivery_jobs(
    database: Database, settings: Settings, batch_size: int = 10
) -> list[dict[str, str]]:
    async with database.service_transaction() as connection:
        await connection.execute("select public.requeue_expired_channel_deliveries()")
        result = await connection.execute(
            "select * from public.claim_channel_deliveries(%s)", (batch_size,)
        )
        deliveries = await result.fetchall()
    if not deliveries:
        return []

    provider = _meta_provider(settings)
    try:
        outcomes: list[dict[str, str]] = []
        for delivery in deliveries:
            delivery_id = str(delivery["id"])
            message: str | None
            provider_message_id: str | None
            try:
                provider_message_id = await provider.send_text(
                    str(delivery["recipient_phone_number"]), str(delivery["body"])
                )
            except Exception as error:
                message, retryable = _delivery_failure(error)
                succeeded = False
                provider_message_id = None
                outcome = "failed"
            else:
                message, retryable = None, False
                succeeded = True
                outcome = "sent"
            async with database.service_transaction() as connection:
                await connection.execute(
                    "select public.complete_channel_delivery(%s::uuid, %s, %s, %s, %s)",
                    (delivery_id, succeeded, provider_message_id, message, retryable),
                )
            outcomes.append({"delivery_id": delivery_id, "outcome": outcome})
        return outcomes
    finally:
        await provider.aclose()


async def _process_message_job(
    connection: Any, channel_event_id: str, settings: Settings
) -> str:
    result = await connection.execute(
        """
        select id, payload, event_type
        from public.channel_events
        where id = %s::uuid
        """,
        (channel_event_id,),
    )
    event = await result.fetchone()
    if event is None or event["event_type"] != "message":
        return "skipped"
    payload = event["payload"]
    if not isinstance(payload, dict):
        return "skipped"
    text = _extract_text(payload)
    detector = HeuristicLanguageDetector()
    transcript: str | None = None
    transcript_confidence: float | None = None
    transcription_evidence: dict[str, Any] | None = None
    detection = detector.detect(text) if text else None

    if not text:
        result = await connection.execute(
            """
            select id, provider_media_id, media_type, mime_type, retrieval_state,
              storage_bucket, storage_path
            from public.channel_media_assets
            where channel_event_id = %s::uuid and media_type = 'audio'
            order by created_at asc limit 1
            """,
            (channel_event_id,),
        )
        media = await result.fetchone()
        if media is None or not settings.openrouter_api_key:
            return "skipped"
        content, mime_type = await _retrieve_audio(
            connection, media, channel_event_id, settings
        )
        language_provider = _openrouter_provider(settings)
        try:
            transcription = await language_provider.transcribe(content, mime_type)
        finally:
            await language_provider.aclose()
        if transcription is None:
            return "skipped"
        transcript = transcription.transcript
        transcript_confidence = transcription.confidence
        if transcription.language_code:
            detection = detector.detect(transcript) or LanguageDetection(
                transcription.language_code, transcription.confidence
            )
        if transcription.evidence:
            transcription_evidence = asdict(transcription.evidence)
        await connection.execute(
            """
            update public.channel_media_assets
            set transcript = %s, transcript_confidence = %s,
                detected_language_code = %s, transcription_provider = %s,
                transcription_model = %s, transcription_latency_ms = %s,
                transcription_metadata = %s
            where id = %s::uuid
            """,
            (
                transcript,
                transcript_confidence,
                transcription.language_code,
                transcription_evidence["provider"] if transcription_evidence else None,
                transcription_evidence["model"] if transcription_evidence else None,
                (
                    transcription_evidence["latency_ms"]
                    if transcription_evidence
                    else None
                ),
                Jsonb(transcription_evidence or {}),
                media["id"],
            ),
        )

    interpretation_text = text or transcript
    if not interpretation_text:
        return "skipped"
    if detection:
        await connection.execute(
            """
            update public.channel_events
            set detected_language_code = %s, detected_language_confidence = %s
            where id = %s::uuid
            """,
            (detection.language_code, detection.confidence, channel_event_id),
        )
    language_code = detection.language_code if detection else None
    intent: ExtractedIntent | None = extract_intent(interpretation_text, language_code)
    if settings.openrouter_api_key:
        language_provider = _openrouter_provider(settings)
        try:
            intent = await language_provider.extract_intent(
                interpretation_text, language_code
            )
        finally:
            await language_provider.aclose()
    if intent is None or not _valid_intent(intent):
        return "skipped"
    ambiguity = (
        "ambiguous"
        if transcript_confidence is not None and transcript_confidence < 0.8
        else intent.ambiguity
    )
    interpretation: dict[str, Any] = {
        "originalText": text,
        "transcript": transcript,
        "transcriptConfidence": transcript_confidence,
        "detectedLanguageCode": language_code,
        "detectionConfidence": detection.confidence if detection else None,
    }
    if transcription_evidence:
        interpretation["transcriptionProvider"] = transcription_evidence
    if intent.evidence:
        interpretation["structuredIntentProvider"] = asdict(intent.evidence)
    await connection.execute(
        """
        insert into public.proposed_actions (
          channel_event_id, action_type, ambiguity, confidence, entity_resolution,
          interpretation, model_provider, model_name, payload, risk_tier
        ) values (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (channel_event_id) where archived_at is null do nothing
        """,
        (
            channel_event_id,
            intent.action_type,
            ambiguity,
            intent.confidence,
            Jsonb({}),
            Jsonb(interpretation),
            intent.evidence.provider if intent.evidence else "markd-heuristic",
            intent.evidence.model if intent.evidence else "language-rules-v1",
            Jsonb(
                {
                    "actionType": intent.action_type,
                    "fields": intent.fields,
                    "entityIds": {},
                }
            ),
            "operational" if intent.evidence else "informational",
        ),
    )
    return "created"


async def _retrieve_audio(
    connection: Any, media: Any, channel_event_id: str, settings: Settings
) -> tuple[bytes, str]:
    try:
        if media["retrieval_state"] == "retrieved" and media["storage_path"]:
            content, stored_mime_type = await download_private_object(
                settings,
                media["storage_bucket"] or WHATSAPP_MEDIA_BUCKET,
                media["storage_path"],
            )
            return content, media["mime_type"] or stored_mime_type
        provider = _meta_provider(settings)
        try:
            downloaded = await provider.get_media(str(media["provider_media_id"]))
        finally:
            await provider.aclose()
        extension = _media_extension(downloaded.mime_type)
        storage_path = f"channel-events/{channel_event_id}/{media['id']}.{extension}"
        await upload_private_object(
            settings,
            WHATSAPP_MEDIA_BUCKET,
            storage_path,
            downloaded.bytes,
            downloaded.mime_type,
        )
        await connection.execute(
            """
            update public.channel_media_assets
            set mime_type = %s, retrieval_state = 'retrieved',
                storage_bucket = %s, storage_path = %s, failure_reason = null
            where id = %s::uuid
            """,
            (downloaded.mime_type, WHATSAPP_MEDIA_BUCKET, storage_path, media["id"]),
        )
        return downloaded.bytes, downloaded.mime_type
    except Exception as error:
        message, _ = _processing_failure(error)
        await connection.execute(
            """
            update public.channel_media_assets
            set retrieval_state = 'failed', failure_reason = %s
            where id = %s::uuid
            """,
            (message, media["id"]),
        )
        raise


def _openrouter_provider(settings: Settings) -> OpenRouterProvider:
    return OpenRouterProvider(
        settings.openrouter_api_key,
        settings.openrouter_base_url,
        (settings.openrouter_intent_model, settings.openrouter_intent_fallback_model),
        (
            settings.openrouter_transcription_model,
            settings.openrouter_transcription_fallback_model,
        ),
        settings.openrouter_intent_max_tokens,
        settings.openrouter_transcription_max_tokens,
        settings.openrouter_intent_max_cost_usd,
        settings.openrouter_transcription_max_cost_usd,
    )


def _meta_provider(settings: Settings) -> MetaWhatsAppCloudProvider:
    return MetaWhatsAppCloudProvider(
        settings.whatsapp_access_token,
        settings.whatsapp_phone_number_id,
        settings.whatsapp_graph_api_version,
        settings.whatsapp_graph_base_url,
        settings.whatsapp_max_media_bytes,
    )


def _extract_text(payload: dict[str, Any]) -> str | None:
    entries = payload.get("entry")
    if not isinstance(entries, list) or not entries or not isinstance(entries[0], dict):
        return None
    changes = entries[0].get("changes")
    if not isinstance(changes, list) or not changes or not isinstance(changes[0], dict):
        return None
    value = changes[0].get("value")
    messages = value.get("messages") if isinstance(value, dict) else None
    message = messages[0] if isinstance(messages, list) and messages else None
    text = message.get("text") if isinstance(message, dict) else None
    body = text.get("body") if isinstance(text, dict) else None
    if isinstance(body, str):
        return body
    interactive = message.get("interactive") if isinstance(message, dict) else None
    if not isinstance(interactive, dict):
        return None
    for reply_type in ("button_reply", "list_reply"):
        reply = interactive.get(reply_type)
        if isinstance(reply, dict):
            value = reply.get("id") or reply.get("title")
            if isinstance(value, str) and value.strip():
                return value
    return None


def _valid_intent(intent: ExtractedIntent) -> bool:
    return (
        0 <= intent.confidence <= 1
        and intent.ambiguity in {"clear", "ambiguous", "unresolved"}
        and all(
            isinstance(key, str)
            and isinstance(value, (str, int, float, bool, type(None)))
            for key, value in intent.fields.items()
        )
    )


def _media_extension(mime_type: str) -> str:
    subtype = mime_type.split(";", 1)[0].split("/")[-1].lower()
    if not subtype.isalnum():
        return "bin"
    return {"mpeg": "mp3", "x-wav": "wav"}.get(subtype, subtype)


def _processing_failure(error: Exception) -> tuple[str, bool]:
    if isinstance(error, (WhatsAppProviderError, OpenRouterProviderError)):
        return str(error), error.retryable
    return "provider processing failed", True


def _delivery_failure(error: Exception) -> tuple[str, bool]:
    if isinstance(error, WhatsAppProviderError):
        return str(error), error.retryable
    return "delivery dispatch failed", True