from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal, cast
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.api.v1.availability import (
    SetWorkerAvailabilityInput,
    set_worker_availability_mutation,
)
from app.api.v1.labour_requests import (
    RespondToAssignmentInput,
    respond_to_assignment_mutation,
)
from app.application.dispatcher import execute_command
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.core.problems import ProblemDetail
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
                    connection, str(job["channel_event_id"]), settings, database
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


async def run_command_outbox_jobs(
    database: Database, batch_size: int = 10
) -> list[dict[str, str]]:
    async with database.service_transaction() as connection:
        result = await connection.execute(
            """
            with claimed as (
              select id from private.outbox_messages
              where state = 'pending' and available_at <= timezone('utc', now())
              order by available_at, created_at
              for update skip locked limit greatest(%s, 1)
            )
            update private.outbox_messages as outbox
            set state = 'leased', attempts = outbox.attempts + 1,
                leased_until = timezone('utc', now()) + interval '5 minutes'
            from claimed
            where outbox.id = claimed.id
            returning outbox.id, outbox.domain_event_id
            """,
            (batch_size,),
        )
        claimed = await result.fetchall()

    outcomes: list[dict[str, str]] = []
    for outbox in claimed:
        outbox_id = str(outbox["id"])
        try:
            async with database.service_transaction() as connection:
                result = await connection.execute(
                    """
                select event.id, event.event_type, event.aggregate_id,
                             event.payload,
                             assignment.id as assignment_id,
                             assignment.worker_response,
                             case
                                 when event.event_type =
                                     'worker.availability_set'
                                 then availability_phone.phone_number
                                 else phone.phone_number
                             end as phone_number
                from private.domain_events as event
                left join public.assignments as assignment
                    on assignment.id = event.aggregate_id
                left join public.person_phone_numbers as phone
                    on phone.person_id = assignment.worker_id
                 and phone.is_primary
                 and phone.archived_at is null
                left join public.availability_signals as availability
                    on availability.id = event.aggregate_id
                left join public.person_phone_numbers as availability_phone
                    on availability_phone.person_id = availability.worker_id
                 and availability_phone.is_primary
                 and availability_phone.archived_at is null
                where event.id = %s::uuid
                    """,
                    (str(outbox["domain_event_id"]),),
                )
                event = await result.fetchone()
                if event is None:
                    raise RuntimeError("domain event was not found")
                event_type = str(event["event_type"])
                body = (
                    "Availability saved."
                    if event_type == "worker.availability_set"
                    else _assignment_delivery_body(
                        event_type, event.get("worker_response")
                    )
                )
                if body is not None:
                    recipients = [event]
                    if event_type == "labour_request.cancelled":
                        recipients = await _cancelled_assignment_recipients(
                            connection, event.get("payload")
                        )
                    for recipient in recipients:
                        if recipient["phone_number"] is None:
                            raise RuntimeError(
                                "event recipient has no active primary phone"
                            )
                        idempotency_key = f"domain-event:{event['id']}"
                        if event_type == "labour_request.cancelled":
                            idempotency_key += f":{recipient['assignment_id']}"
                        message_kind = (
                            "availability_update"
                            if event_type == "worker.availability_set"
                            else "assignment_update"
                        )
                        await connection.execute(
                            """
                            insert into public.channel_deliveries (
                              channel, recipient_phone_number, body, message_kind,
                              idempotency_key, state
                                                        ) values (
                                                            'whatsapp',
                                                            %s,
                                                            %s,
                                                            %s,
                                                            %s,
                                                            'queued'
                                                        )
                            on conflict (idempotency_key) do nothing
                            """,
                            (
                                recipient["phone_number"],
                                body,
                                message_kind,
                                idempotency_key,
                            ),
                        )
                await connection.execute(
                    """
                    update private.outbox_messages
                    set state = 'published', published_at = timezone('utc', now()),
                        leased_until = null, last_error = null
                    where id = %s::uuid and state = 'leased'
                    """,
                    (outbox_id,),
                )
        except Exception as error:
            async with database.service_transaction() as connection:
                await connection.execute(
                    """
                    update private.outbox_messages
                    set state = 'pending', leased_until = null, last_error = %s,
                        available_at = timezone('utc', now()) + interval '1 minute'
                    where id = %s::uuid and state = 'leased'
                    """,
                    (str(error)[:1000], outbox_id),
                )
            outcomes.append({"outbox_id": outbox_id, "outcome": "failed"})
        else:
            outcomes.append({"outbox_id": outbox_id, "outcome": "published"})
    return outcomes


async def _process_message_job(
    connection: Any,
    channel_event_id: str,
    settings: Settings,
    database: Database | None = None,
) -> str:
    result = await connection.execute(
        """
         select id, payload, event_type, provider_message_id, sender_phone_number,
             occurred_at
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
    provider_message_id = event["provider_message_id"]
    text = _extract_text(
        payload, provider_message_id if isinstance(provider_message_id, str) else None
    )
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
    exact_response = _exact_assignment_response(text) if text else None
    intent: ExtractedIntent | None = extract_intent(interpretation_text, language_code)
    if settings.openrouter_api_key and exact_response is None:
        language_provider = _openrouter_provider(settings)
        try:
            intent = await language_provider.extract_intent(
                interpretation_text, language_code
            )
        finally:
            await language_provider.aclose()
    if exact_response is not None:
        intent = ExtractedIntent(
            "assignment_response", {"response": exact_response}, 1.0, "clear"
        )
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
    entity_ids: dict[str, str] = {}
    if database is not None:
        outcome, entity_ids = await _try_execute_worker_action(
            database,
            connection,
            event,
            intent,
            channel_event_id,
            exact_assignment_response=exact_response is not None,
        )
        if outcome is not None:
            return outcome
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
                    "entityIds": entity_ids,
                }
            ),
            "operational" if intent.evidence else "informational",
        ),
    )
    return "created"


def _exact_assignment_response(
    text: str,
) -> Literal["accepted", "declined", "call_me"] | None:
    normalized = " ".join(text.upper().split())
    response = {
        "YES": "accepted",
        "1": "accepted",
        "JA": "accepted",
        "EWE": "accepted",
        "NO": "declined",
        "2": "declined",
        "NEE": "declined",
        "HAYI": "declined",
        "CALL ME": "call_me",
        "3": "call_me",
    }.get(normalized)
    return cast(Literal["accepted", "declined", "call_me"] | None, response)


def _availability_work_date(
    availability: Literal["today", "tomorrow"], occurred_at: datetime
) -> date:
    return occurred_at.astimezone(UTC).date() + timedelta(
        days=1 if availability == "tomorrow" else 0
    )


async def _resolve_active_participant_workers(
    connection: Any, channel_event_id: str
) -> list[dict[str, Any]]:
    result = await connection.execute(
        """
        select account.auth_user_id, worker.person_id as worker_id
        from public.channel_events as event
        join public.person_phone_numbers as phone
          on phone.phone_number = event.sender_phone_number
         and phone.archived_at is null
        join public.participant_accounts as account
          on account.person_id = phone.person_id and account.status = 'active'
                join public.participant_account_scopes as scope
                    on scope.auth_user_id = account.auth_user_id
                 and scope.scope_kind = 'worker'
        join public.worker_profiles as worker
          on worker.person_id = account.person_id
         and worker.archived_at is null and worker.record_status = 'active'
        where event.id = %s::uuid
        """,
        (channel_event_id,),
    )
    return [dict(worker) for worker in await result.fetchall()]


async def _try_execute_worker_action(
    database: Database,
    connection: Any,
    event: dict[str, Any],
    intent: ExtractedIntent,
    channel_event_id: str,
    *,
    exact_assignment_response: bool,
) -> tuple[str | None, dict[str, str]]:
    workers = await _resolve_active_participant_workers(connection, channel_event_id)
    if len(workers) != 1:
        return None, {}
    worker = workers[0]
    worker_id = UUID(str(worker["worker_id"]))
    actor = CurrentActor(
        user_id=UUID(str(worker["auth_user_id"])),
        claims={
            "participant_person_id": str(worker_id),
            "worker_scope": True,
            "contractor_contacts": [],
        },
    )
    event_id = UUID(str(event["id"]))
    provider_message_id = event.get("provider_message_id")
    if not isinstance(provider_message_id, str) or not provider_message_id.strip():
        return None, {"workerId": str(worker_id)}

    if intent.action_type == "assignment_response":
        if not exact_assignment_response:
            return None, {"workerId": str(worker_id)}
        response = intent.fields.get("response")
        if response not in {"accepted", "declined", "call_me"}:
            return None, {"workerId": str(worker_id)}
        assignment_response = cast(Literal["accepted", "declined", "call_me"], response)
        result = await connection.execute(
            """
            select id from public.assignments
            where worker_id = %s and lifecycle = 'active' and offered_at is not null
            order by offered_at desc
            """,
            (worker_id,),
        )
        assignments = await result.fetchall()
        if len(assignments) != 1:
            return None, {"workerId": str(worker_id)}
        assignment_id = UUID(str(assignments[0]["id"]))

        async def handler(command_connection: Any) -> Any:
            return await respond_to_assignment_mutation(
                command_connection,
                actor,
                assignment_id,
                RespondToAssignmentInput(response=assignment_response),
                source_channel="whatsapp",
                source_channel_event_id=event_id,
            )

        try:
            await execute_command(
                database,
                actor,
                str(event_id),
                "RespondToAssignment",
                f"wa:{provider_message_id}:respond-to-assignment",
                {
                    "assignment_id": str(assignment_id),
                    "response": assignment_response,
                },
                handler,
            )
        except ProblemDetail as error:
            if error.code == "CONFLICTING_RESPONSE":
                return "conflicted", {
                    "workerId": str(worker_id),
                    "assignmentId": str(assignment_id),
                }
            return None, {
                "workerId": str(worker_id),
                "assignmentId": str(assignment_id),
            }
        except HTTPException:
            return None, {
                "workerId": str(worker_id),
                "assignmentId": str(assignment_id),
            }
        return "executed", {
            "workerId": str(worker_id),
            "assignmentId": str(assignment_id),
        }

    if (
        intent.action_type != "worker_availability"
        or intent.ambiguity != "clear"
        or intent.confidence < 0.8
        or intent.fields.get("availability") not in {"today", "tomorrow"}
    ):
        return None, {"workerId": str(worker_id)}
    availability = str(intent.fields["availability"])
    work_date = _availability_work_date(
        cast(Literal["today", "tomorrow"], availability), event["occurred_at"]
    )

    async def availability_handler(command_connection: Any) -> Any:
        return await set_worker_availability_mutation(
            command_connection,
            actor,
            worker_id,
            work_date,
            SetWorkerAvailabilityInput(status="available"),
            source="whatsapp",
            source_channel_event_id=event_id,
        )

    try:
        await execute_command(
            database,
            actor,
            str(event_id),
            "SetWorkerAvailability",
            f"wa:{provider_message_id}:set-worker-availability",
            {
                "worker_id": str(worker_id),
                "work_date": work_date.isoformat(),
                "status": "available",
            },
            availability_handler,
        )
    except (HTTPException, ProblemDetail):
        return None, {"workerId": str(worker_id)}
    return "executed", {"workerId": str(worker_id)}


def _assignment_delivery_body(
    event_type: str, worker_response: object | None = None
) -> str | None:
    if event_type == "assignment.worker_responded":
        return "Accepted. DO NOT TRAVEL YET." if worker_response == "accepted" else None
    return {
        "assignment.travel_authorised": "WORK CONFIRMED. GO to the reporting point.",
        "assignment.travel_revoked": "Work details changed. DO NOT TRAVEL.",
        "assignment.cancelled": "Work cancelled. DO NOT TRAVEL.",
        "labour_request.cancelled": "Work cancelled. DO NOT TRAVEL.",
    }.get(event_type)


async def _cancelled_assignment_recipients(
    connection: Any, payload: object
) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    assignment_ids = payload.get("cancelled_assignment_ids")
    if not isinstance(assignment_ids, list) or not all(
        isinstance(assignment_id, str) for assignment_id in assignment_ids
    ):
        return []
    result = await connection.execute(
        """
        select assignment.id as assignment_id, phone.phone_number
        from public.assignments as assignment
        left join public.person_phone_numbers as phone
          on phone.person_id = assignment.worker_id
         and phone.is_primary
         and phone.archived_at is null
        where assignment.id = any(%s::uuid[])
        """,
        (assignment_ids,),
    )
    return [dict(recipient) for recipient in await result.fetchall()]


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


def _extract_text(
    payload: dict[str, Any], provider_message_id: str | None
) -> str | None:
    entries = payload.get("entry")
    if not isinstance(entries, list):
        return None
    for entry in entries:
        changes = entry.get("changes") if isinstance(entry, dict) else None
        if not isinstance(changes, list):
            continue
        for change in changes:
            value = change.get("value") if isinstance(change, dict) else None
            messages = value.get("messages") if isinstance(value, dict) else None
            if not isinstance(messages, list):
                continue
            for message in messages:
                if not isinstance(message, dict) or (
                    provider_message_id is not None
                    and message.get("id") != provider_message_id
                ):
                    continue
                text = message.get("text")
                body = text.get("body") if isinstance(text, dict) else None
                if isinstance(body, str):
                    return body
                interactive = message.get("interactive")
                if not isinstance(interactive, dict):
                    continue
                for reply_type in ("button_reply", "list_reply"):
                    reply = interactive.get(reply_type)
                    if isinstance(reply, dict):
                        reply_value = reply.get("id") or reply.get("title")
                        if isinstance(reply_value, str) and reply_value.strip():
                            return reply_value
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
