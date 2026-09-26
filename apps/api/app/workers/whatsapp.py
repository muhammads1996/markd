from __future__ import annotations

from dataclasses import asdict, replace
from datetime import date, datetime, timedelta
from typing import Any, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.api.v1.availability import (
    SetWorkerAvailabilityInput,
    set_worker_availability_mutation,
)
from app.api.v1.labour_requests import (
    CancelAssignmentInput,
    RespondToAssignmentInput,
    cancel_assignment_mutation,
    respond_to_assignment_mutation,
)
from app.application.channel_actors import ChannelPrincipal, resolve_channel_principal
from app.application.conversation_window import (
    CommunicationFallbackRequired,
    ConversationWindowPolicy,
)
from app.application.dispatcher import execute_command
from app.application.template_delivery import verify_template_facts
from app.core.config import Settings
from app.core.problems import ProblemDetail
from app.decisions.question_bundles import (
    CLOSEOUT_EVIDENCE_V1,
    EXCEPTION_TRIAGE_V1,
    MESSAGE_ROUTING_V1,
)
from app.decisions.service import SemanticDecisionService, SemanticEvaluation
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
from app.integrations.typesafe_jev import TypeSafeJevProvider
from app.integrations.whatsapp import (
    MetaWhatsAppCloudProvider,
    WhatsAppProviderError,
    normalize_delivery_statuses,
)
from app.messaging.templates import (
    ApprovedTemplatePayload,
    Locale,
    MessagePayload,
    SessionTextPayload,
    TemplateKey,
    build_template_payload,
    parse_message_payload,
    render_session_text,
    resolve_meta_template,
)

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
    window_policy = ConversationWindowPolicy()
    try:
        outcomes: list[dict[str, str]] = []
        for delivery in deliveries:
            delivery_id = str(delivery["id"])
            message: str | None
            provider_message_id: str | None
            payload: SessionTextPayload | ApprovedTemplatePayload | None = None
            send_started = False
            template = None
            session_body = None
            try:
                payload = parse_message_payload(delivery["message_payload"])
                recipient = str(delivery["recipient_phone_number"])
                async with database.service_transaction() as connection:
                    await connection.execute(
                        "select public.mark_channel_delivery_send_started(%s::uuid)",
                        (delivery_id,),
                    )
                send_started = True
                async with database.service_transaction() as connection:
                    if payload.type == "approved_template":
                        source_record_id = delivery.get("source_record_id")
                        await verify_template_facts(
                            connection,
                            payload,
                            UUID(str(source_record_id))
                            if source_record_id is not None
                            else None,
                            recipient,
                            settings.whatsapp_template_fallback_locale,
                        )
                    window_open = await window_policy.is_open_for(connection, recipient)
                    template = None
                    session_body = None
                    if payload.type == "approved_template":
                        if window_open:
                            session_body = render_session_text(payload).body
                        else:
                            try:
                                template = resolve_meta_template(
                                    payload,
                                    settings.whatsapp_template_catalog,
                                    settings.whatsapp_template_fallback_locale,
                                )
                            except ValueError as error:
                                raise CommunicationFallbackRequired(
                                    f"No approved Meta template for {payload.key}; "
                                    "Ops/call follow-up required"
                                ) from error
                    elif window_open:
                        session_body = payload.body
                    else:
                        raise CommunicationFallbackRequired(
                            "No open WhatsApp service window or approved template; "
                            "Ops/call follow-up required"
                        )
                    await connection.execute(
                        """
                        update public.channel_deliveries
                        set provider_send_type = %s, provider_template_name = %s,
                            provider_template_locale = %s
                        where id = %s::uuid and state = 'leased'
                        """,
                        (
                            "approved_template" if template else "session_text",
                            template.name if template else None,
                            template.language_code if template else None,
                            delivery_id,
                        ),
                    )
                    if template is not None:
                        provider_message_id = await provider.send_template(
                            recipient, template
                        )
                    else:
                        assert session_body is not None
                        provider_message_id = await provider.send_text(
                            recipient, session_body
                        )
                    await connection.execute(
                        "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (provider_message_id,),
                    )
                    await connection.execute(
                        "select public.complete_channel_delivery("
                        "%s::uuid, true, %s, null, false)",
                        (delivery_id, provider_message_id),
                    )
                    prior_events = await connection.execute(
                        """
                        select provider_event_id, payload
                        from public.channel_events
                        where channel = 'whatsapp' and event_type = 'status'
                          and provider_message_id = %s
                        order by occurred_at, id limit 50
                        """,
                        (provider_message_id,),
                    )
                    for event in await prior_events.fetchall():
                        for status in normalize_delivery_statuses(event["payload"]):
                            if (
                                status.provider_message_id == provider_message_id
                                and status.provider_event_id
                                == event["provider_event_id"]
                            ):
                                await connection.execute(
                                    "select public.record_channel_delivery_status("
                                    "%s, %s, %s, %s)",
                                    (
                                        provider_message_id,
                                        status.state,
                                        status.occurred_at,
                                        status.failure_reason,
                                    ),
                                )
            except Exception as error:
                message, retryable = _delivery_failure(error)
                # Once a provider request may have started, its outcome can be
                # ambiguous. Ops reconciles instead of sending it twice.
                if send_started:
                    retryable = False
                succeeded = False
                provider_message_id = None
                outcome = "failed"
            else:
                message, retryable = None, False
                succeeded = True
                outcome = "sent"
            if not succeeded:
                async with database.service_transaction() as connection:
                    if send_started and (
                        template is not None or session_body is not None
                    ):
                        await connection.execute(
                            """
                            update public.channel_deliveries
                            set provider_send_type = %s,
                                provider_template_name = %s,
                                provider_template_locale = %s
                            where id = %s::uuid and state = 'leased'
                            """,
                            (
                                "approved_template" if template else "session_text",
                                template.name if template else None,
                                template.language_code if template else None,
                                delivery_id,
                            ),
                        )
                    await connection.execute(
                        "select public.complete_channel_delivery("
                        "%s::uuid, %s, %s, %s, %s)",
                        (
                            delivery_id,
                            succeeded,
                            provider_message_id,
                            message,
                            retryable,
                        ),
                    )
            outcomes.append({"delivery_id": delivery_id, "outcome": outcome})
        return outcomes
    finally:
        await provider.aclose()


async def run_command_outbox_jobs(
    database: Database, batch_size: int = 10, settings: Settings | None = None
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
                             event.aggregate_version, event.payload,
                             assignment.id as assignment_id,
                             assignment.worker_response, assignment.lifecycle,
                             assignment.version as assignment_version,
                             assignment.travel_authorised_at,
                             assignment.travel_revoked_at,
                             assignment.starts_on as work_date,
                             assignment.reporting_at,
                             assignment.reporting_place_text,
                             request.site_area, request.timezone,
                             language.code as preferred_language_code,
                             case
                                 when event.event_type =
                                     'worker.availability_set'
                                 then availability_phone.phone_number
                                 else phone.phone_number
                             end as phone_number
                from private.domain_events as event
                left join public.assignments as assignment
                    on assignment.id = event.aggregate_id
                left join public.labour_requests as request
                    on request.id = assignment.labour_request_id
                left join public.people as worker
                    on worker.id = assignment.worker_id
                left join public.languages as language
                    on language.id = worker.preferred_language_id
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
                if event_type == "worker.availability_set":
                    recipients = [event]
                elif event_type == "labour_request.cancelled":
                    recipients = await _cancelled_assignment_recipients(
                        connection, event.get("payload")
                    )
                else:
                    recipients = [event]
                for recipient in recipients:
                    message = _outbound_message(
                        event_type,
                        recipient,
                        settings.whatsapp_template_fallback_locale
                        if settings
                        else "en",
                    )
                    if message is not None:
                        body, payload, message_kind = message
                        if recipient["phone_number"] is None:
                            raise RuntimeError(
                                "event recipient has no active primary phone"
                            )
                        idempotency_key = f"domain-event:{event['id']}"
                        if event_type == "labour_request.cancelled":
                            idempotency_key += f":{recipient['assignment_id']}"
                        await connection.execute(
                            """
                            insert into public.channel_deliveries (
                              channel, recipient_phone_number, body, message_kind,
                              message_payload, idempotency_key,
                              source_table, source_record_id, state
                                                        ) values (
                                                            'whatsapp',
                                                            %s,
                                                            %s,
                                                            %s,
                                                            %s,
                                                            %s,
                                                            %s,
                                                            %s::uuid,
                                                            'queued'
                                                        )
                            on conflict (idempotency_key) do nothing
                            """,
                            (
                                recipient["phone_number"],
                                body,
                                message_kind,
                                Jsonb(payload.model_dump(mode="json")),
                                idempotency_key,
                                "assignments"
                                if payload.type == "approved_template"
                                else None,
                                recipient.get("assignment_id")
                                if payload.type == "approved_template"
                                else None,
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
    exact_availability = _exact_availability(text) if text else None
    exact_withdrawal = _exact_withdrawal(text) if text else False
    intent: ExtractedIntent | None = extract_intent(interpretation_text, language_code)
    semantic_evaluations = await _evaluate_semantic_decisions(
        connection,
        settings,
        channel_event_id=channel_event_id,
        text=interpretation_text,
        language_code=language_code,
        transcript_confidence=transcript_confidence,
    )
    semantic_requires_review = any(
        evaluation.policy.route in {"confirmation_or_ops", "ops"}
        for _, evaluation in semantic_evaluations
    )
    if (
        settings.openrouter_api_key
        and exact_response is None
        and exact_availability is None
        and not exact_withdrawal
    ):
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
    elif exact_availability is not None:
        availability, status = exact_availability
        intent = ExtractedIntent(
            "worker_availability",
            {"availability": availability, "status": status},
            1.0,
            "clear",
        )
    elif exact_withdrawal:
        intent = ExtractedIntent("assignment_cancellation", {}, 1.0, "clear")
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
    if semantic_evaluations:
        interpretation["semanticDecisionEvidence"] = [
            {
                "bundle": bundle.name,
                "bundleVersion": bundle.version,
                "policyOutcome": evaluation.policy.route,
                "policyReason": evaluation.policy.reason,
                "status": "failed" if evaluation.failure_kind else "succeeded",
            }
            for bundle, evaluation in semantic_evaluations
        ]
    if intent.evidence:
        interpretation["structuredIntentProvider"] = asdict(intent.evidence)
    principal = (
        await resolve_channel_principal(connection, channel_event_id)
        if database is not None
        else None
    )
    entity_ids: dict[str, str] = principal.entity_ids() if principal else {}
    if database is not None and intent.action_type in {
        "work_completion",
        "payment_issue",
    }:
        # Bind trust/economic assertions to immutable sender and assignment
        # evidence even when semantic review prevents command execution.
        entity_ids = await _resolve_closeout_entities(
            connection, event, channel_event_id, principal
        )
    elif principal is not None and intent.action_type in {
        "assignment_confirmation",
        "assignment_logistics",
        "assignment_cancellation",
    }:
        assignment_id = await _resolve_active_assignment(connection, principal)
        if assignment_id is not None:
            entity_ids["assignmentId"] = str(assignment_id)
    if (
        database is not None
        and intent.action_type not in {"work_completion", "payment_issue"}
        and (
            exact_response is not None
            or exact_availability is not None
            or exact_withdrawal
            or not semantic_requires_review
        )
    ):
        outcome, attempted_entities = await _try_execute_worker_action(
            database,
            connection,
            event,
            intent,
            channel_event_id,
            exact_assignment_response=exact_response is not None,
            exact_availability=exact_availability is not None,
            exact_withdrawal=exact_withdrawal,
            principal=principal,
        )
        entity_ids.update(attempted_entities)
        if outcome is not None:
            return outcome
    proposed_action_result = await connection.execute(
        """
        insert into public.proposed_actions (
          channel_event_id, action_type, ambiguity, confidence, entity_resolution,
          interpretation, model_provider, model_name, payload, risk_tier
        ) values (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (channel_event_id) where archived_at is null do nothing
        returning id
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
            (
                "trust"
                if intent.action_type == "work_completion"
                else "economic"
                if intent.action_type == "payment_issue"
                else "operational"
                if intent.evidence
                else "informational"
            ),
        ),
    )
    proposed_action = await proposed_action_result.fetchone()
    if proposed_action is None:
        existing_result = await connection.execute(
            """
            select id from public.proposed_actions
            where channel_event_id = %s::uuid and archived_at is null
            """,
            (channel_event_id,),
        )
        proposed_action = await existing_result.fetchone()
    if proposed_action is not None:
        await connection.execute(
            """
            update public.semantic_decisions
            set proposed_action_id = %s::uuid
            where channel_event_id = %s::uuid and proposed_action_id is null
            """,
            (proposed_action["id"], channel_event_id),
        )
    return "created"


async def _evaluate_semantic_decisions(
    connection: Any,
    settings: Settings,
    *,
    channel_event_id: str,
    text: str,
    language_code: str | None,
    transcript_confidence: float | None,
) -> list[tuple[Any, SemanticEvaluation]]:
    """Evaluate only after a ChannelEvent is persisted and leased.

    Provider errors are converted into decision evidence and retain the normal
    processing path. No semantic result is allowed to become a command here.
    """
    if (
        not settings.semantic_decision_enabled
        or settings.semantic_decision_mode == "off"
        or settings.semantic_decision_provider != "jev"
        or not settings.typesafe_api_key
    ):
        return []
    provider = _semantic_provider(settings)
    service = SemanticDecisionService(
        provider,
        mode=settings.semantic_decision_mode,
        active_policy=settings.semantic_decision_active_policy,
    )
    state: dict[str, object] = {
        "message": text,
        "channel": "whatsapp",
        "actorRole": "unknown",
        "detectedLanguageCode": language_code,
        "transcriptConfidence": transcript_confidence,
    }
    try:
        routing = await service.evaluate_persisted_event(
            connection,
            channel_event_id=channel_event_id,
            state=state,
            bundle=MESSAGE_ROUTING_V1,
            language_code=language_code,
        )
        evaluations: list[tuple[Any, SemanticEvaluation]] = [
            (MESSAGE_ROUTING_V1, routing)
        ]
        message_class = (
            routing.result.answers["message_class"].value
            if routing.result and "message_class" in routing.result.answers
            else None
        )
        if message_class in {"EXCEPTION", "PAYMENT"}:
            evaluations.append(
                (
                    EXCEPTION_TRIAGE_V1,
                    await service.evaluate_persisted_event(
                        connection,
                        channel_event_id=channel_event_id,
                        state=state,
                        bundle=EXCEPTION_TRIAGE_V1,
                        language_code=language_code,
                    ),
                )
            )
        elif message_class == "CLOSEOUT":
            evaluations.append(
                (
                    CLOSEOUT_EVIDENCE_V1,
                    await service.evaluate_persisted_event(
                        connection,
                        channel_event_id=channel_event_id,
                        state=state,
                        bundle=CLOSEOUT_EVIDENCE_V1,
                        language_code=language_code,
                    ),
                )
            )
        return evaluations
    finally:
        await provider.aclose()


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
        "MARKD_ASSIGNMENT_YES": "accepted",
        "MARKD_ASSIGNMENT_NO": "declined",
        "MARKD_ASSIGNMENT_CALL_ME": "call_me",
    }.get(normalized)
    return cast(Literal["accepted", "declined", "call_me"] | None, response)


def _availability_work_date(
    availability: Literal["today", "tomorrow"], occurred_at: datetime
) -> date:
    return occurred_at.astimezone(ZoneInfo("Africa/Johannesburg")).date() + timedelta(
        days=1 if availability == "tomorrow" else 0
    )


def _exact_availability(
    text: str,
) -> tuple[Literal["today", "tomorrow"], Literal["available", "unavailable"]] | None:
    normalized = " ".join(text.upper().split())
    translated: dict[
        str,
        tuple[Literal["today", "tomorrow"], Literal["available", "unavailable"]],
    ] = {
        "EK IS BESKIKBAAR VANDAG": ("today", "available"),
        "EK IS BESKIKBAAR MORE": ("tomorrow", "available"),
        "EK IS BESKIKBAAR MÔRE": ("tomorrow", "available"),
        "NDIYAKWAZI UKUSEBENZA NAMHLANJE": ("today", "available"),
        "NDIYAKWAZI UKUSEBENZA NGOMSO": ("tomorrow", "available"),
    }
    if normalized in translated:
        return translated[normalized]
    for day in ("TODAY", "TOMORROW"):
        if normalized in {f"AVAILABLE {day}", f"I AM AVAILABLE {day}"}:
            return cast(Literal["today", "tomorrow"], day.lower()), "available"
        if normalized in {f"UNAVAILABLE {day}", f"NOT AVAILABLE {day}"}:
            return cast(Literal["today", "tomorrow"], day.lower()), "unavailable"
    return None


def _exact_withdrawal(text: str) -> bool:
    return " ".join(text.upper().split()) in {"WITHDRAW", "CANCEL MY ASSIGNMENT"}


async def _resolve_active_assignment(
    connection: Any, principal: ChannelPrincipal
) -> UUID | None:
    column = "worker_id" if principal.role == "worker" else "organisation_id"
    value = (
        principal.person_id if principal.role == "worker" else principal.organisation_id
    )
    result = await connection.execute(
        f"""
        select id from public.assignments
        where {column} = %s and lifecycle = 'active' and offered_at is not null
        order by offered_at desc limit 2
        """,
        (value,),
    )
    assignments = await result.fetchall()
    return UUID(str(assignments[0]["id"])) if len(assignments) == 1 else None


async def _resolve_replied_assignment(
    connection: Any,
    replied_to_message_id: str,
    sender_phone_number: object,
    worker_id: UUID,
) -> UUID | None:
    if not isinstance(sender_phone_number, str):
        return None
    result = await connection.execute(
        """
        select assignment.id
        from public.channel_deliveries delivery
        join public.assignments assignment
          on assignment.id = delivery.source_record_id
        where delivery.provider_message_id = %s
          and delivery.source_table = 'assignments'
          and delivery.message_kind = 'assignment_offer_do_not_travel'
          and delivery.recipient_phone_number = %s
          and assignment.worker_id = %s::uuid
          and assignment.lifecycle = 'active'
          and assignment.offered_at is not null
          and assignment.worker_response in ('pending', 'call_me')
        """,
        (replied_to_message_id, sender_phone_number, worker_id),
    )
    rows = await result.fetchall()
    return UUID(str(rows[0]["id"])) if len(rows) == 1 else None


async def _resolve_closeout_entities(
    connection: Any,
    event: dict[str, Any],
    channel_event_id: str,
    principal: ChannelPrincipal | None = None,
) -> dict[str, str]:
    principal = principal or await resolve_channel_principal(
        connection, channel_event_id
    )
    if principal is None:
        return {}
    closeout_date = (
        event["occurred_at"].astimezone(ZoneInfo("Africa/Johannesburg")).date()
    )
    entity_ids: dict[str, str]
    assignment_query: str
    assignment_params: tuple[object, ...]
    if principal.role == "worker":
        worker_id = principal.person_id
        entity_ids = {
            "workerId": str(worker_id),
            "assertedById": str(worker_id),
            "assertedRole": "worker",
        }
        assignment_query = "worker_id = %s"
        assignment_params = (worker_id, closeout_date, closeout_date)
    else:
        entity_ids = {
            "assertedById": str(principal.person_id),
            "assertedRole": "hirer",
            "organisationId": str(principal.organisation_id),
            "organisationContactId": str(principal.organisation_contact_id),
        }
        assignment_query = "organisation_id = %s"
        assignment_params = (
            principal.organisation_id,
            closeout_date,
            closeout_date,
        )
    result = await connection.execute(
        f"""
        select id
        from public.assignments
        where {assignment_query}
          and lifecycle in ('active', 'completed', 'no_show')
          and ends_on between %s::date - 14 and %s::date
        order by ends_on desc, created_at desc
        limit 2
        """,
        assignment_params,
    )
    assignments = await result.fetchall()
    if len(assignments) == 1:
        entity_ids["assignmentId"] = str(assignments[0]["id"])
    return entity_ids


async def _try_execute_worker_action(
    database: Database,
    connection: Any,
    event: dict[str, Any],
    intent: ExtractedIntent,
    channel_event_id: str,
    *,
    exact_assignment_response: bool,
    exact_availability: bool = False,
    exact_withdrawal: bool = False,
    principal: ChannelPrincipal | None = None,
) -> tuple[str | None, dict[str, str]]:
    principal = principal or await resolve_channel_principal(
        connection, channel_event_id
    )
    if intent.action_type in {"work_completion", "payment_issue"}:
        return None, await _resolve_closeout_entities(
            connection, event, channel_event_id, principal
        )
    if principal is None or principal.role != "worker":
        return None, {}
    worker_id = principal.person_id
    actor = principal.command_actor()
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
        raw_payload = event.get("payload")
        is_button, replied_to_message_id = _interactive_reply_context(
            raw_payload if isinstance(raw_payload, dict) else {},
            provider_message_id,
        )
        if is_button:
            assignment_id = (
                await _resolve_replied_assignment(
                    connection,
                    replied_to_message_id,
                    event.get("sender_phone_number"),
                    worker_id,
                )
                if replied_to_message_id is not None
                else None
            )
        else:
            assignment_id = await _resolve_active_assignment(connection, principal)
        if assignment_id is None:
            return None, {"workerId": str(worker_id)}
        resolved_assignment_id = assignment_id

        async def handler(command_connection: Any) -> Any:
            return await respond_to_assignment_mutation(
                command_connection,
                actor,
                resolved_assignment_id,
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

    if intent.action_type == "assignment_cancellation":
        if not exact_withdrawal:
            return None, {"workerId": str(worker_id)}
        assignment_id = await _resolve_active_assignment(connection, principal)
        if assignment_id is None:
            return None, {"workerId": str(worker_id)}

        async def cancellation_handler(command_connection: Any) -> Any:
            await command_connection.execute(
                "select set_config('app.source_channel_event_id', %s, true)",
                (str(event_id),),
            )
            mutation = await cancel_assignment_mutation(
                command_connection,
                actor,
                assignment_id,
                CancelAssignmentInput(reason_code="worker_withdrew"),
            )
            return replace(
                mutation,
                source_channel="whatsapp",
                source_channel_event_id=event_id,
            )

        try:
            await execute_command(
                database,
                actor,
                str(event_id),
                "CancelAssignment",
                f"wa:{provider_message_id}:cancel-assignment",
                {"assignment_id": str(assignment_id), "reason_code": "worker_withdrew"},
                cancellation_handler,
            )
        except (HTTPException, ProblemDetail):
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
        or not exact_availability
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
            SetWorkerAvailabilityInput(
                status=(
                    "unavailable"
                    if exact_availability
                    and intent.fields.get("status") == "unavailable"
                    else "available"
                )
            ),
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
                "status": (
                    "unavailable"
                    if exact_availability
                    and intent.fields.get("status") == "unavailable"
                    else "available"
                ),
            },
            availability_handler,
        )
    except (HTTPException, ProblemDetail):
        return None, {"workerId": str(worker_id)}
    return "executed", {"workerId": str(worker_id)}


def _outbound_message(
    event_type: str, recipient: dict[str, Any], fallback_locale: Locale = "en"
) -> tuple[str | None, MessagePayload, str] | None:
    if event_type == "worker.availability_set":
        body = "Availability saved."
        return (
            body,
            SessionTextPayload(type="session_text", body=body),
            "availability_update",
        )

    if (
        event_type == "assignment.worker_responded"
        and recipient.get("worker_response") != "accepted"
    ):
        return None

    template_keys: dict[str, TemplateKey] = {
        "assignment.offered": "assignment_offer_do_not_travel",
        "assignment.worker_responded": "assignment_accepted_waiting",
        "assignment.travel_authorised": "assignment_travel_ready",
        "assignment.travel_revoked": "assignment_changed",
        "assignment.logistics_updated": "assignment_changed",
        "assignment.cancelled": "assignment_cancelled",
        "labour_request.cancelled": "assignment_cancelled",
    }
    key = template_keys.get(event_type)
    if key is None:
        return None

    # Delayed events must not send stale instructions after another command.
    if event_type.startswith("assignment."):
        event_version = recipient.get("aggregate_version")
        current_version = recipient.get("assignment_version")
        if event_version is not None and event_version != current_version:
            return None
    if event_type == "assignment.offered" and (
        recipient.get("lifecycle") != "active"
        or recipient.get("worker_response") != "pending"
    ):
        return None
    if event_type == "assignment.travel_authorised" and (
        recipient.get("lifecycle") != "active"
        or recipient.get("travel_authorised_at") is None
        or recipient.get("travel_revoked_at") is not None
    ):
        return None
    if key == "assignment_cancelled" and recipient.get("lifecycle") != "cancelled":
        return None

    language = recipient.get("preferred_language_code")
    locale: Locale = language if language in {"en", "af", "xh"} else fallback_locale
    if key in {
        "assignment_offer_do_not_travel",
        "assignment_accepted_waiting",
        "assignment_changed",
        "assignment_cancelled",
    }:
        work_date = recipient.get("work_date")
        if not isinstance(work_date, date):
            raise ValueError("assignment work date is required for template delivery")
        variables: dict[str, Any] = {"work_date": work_date}
        if key == "assignment_offer_do_not_travel":
            variables["site_area"] = recipient.get("site_area")
    else:
        reporting_at = recipient.get("reporting_at")
        if not isinstance(reporting_at, datetime):
            raise ValueError("reporting time is required for travel-ready delivery")
        timezone = recipient.get("timezone")
        if not isinstance(timezone, str):
            raise ValueError("labour request timezone is required")
        variables = {
            "reporting_at": reporting_at.astimezone(ZoneInfo(timezone)),
            "reporting_place_text": recipient.get("reporting_place_text"),
        }
    payload = build_template_payload(key, locale, variables)
    return None, payload, key


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
        select assignment.id as assignment_id, phone.phone_number,
               assignment.starts_on as work_date,
               assignment.lifecycle, assignment.worker_response,
               assignment.version as assignment_version,
               request.site_area, request.timezone,
               language.code as preferred_language_code
        from public.assignments as assignment
        join public.labour_requests as request
          on request.id = assignment.labour_request_id
        join public.people as worker
          on worker.id = assignment.worker_id
        left join public.languages as language
          on language.id = worker.preferred_language_id
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


def _semantic_provider(settings: Settings) -> TypeSafeJevProvider:
    return TypeSafeJevProvider(
        settings.typesafe_api_key,
        settings.semantic_decision_base_url,
        settings.semantic_decision_model,
        settings.semantic_decision_timeout_seconds,
        settings.semantic_decision_max_retries,
    )


def _meta_provider(settings: Settings) -> MetaWhatsAppCloudProvider:
    return MetaWhatsAppCloudProvider(
        settings.whatsapp_access_token,
        settings.whatsapp_phone_number_id,
        settings.whatsapp_graph_api_version,
        settings.whatsapp_graph_base_url,
        settings.whatsapp_max_media_bytes,
    )


def _interactive_reply_context(
    payload: dict[str, Any], provider_message_id: str
) -> tuple[bool, str | None]:
    entries = payload.get("entry")
    if not isinstance(entries, list):
        return False, None
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
                if (
                    not isinstance(message, dict)
                    or message.get("id") != provider_message_id
                ):
                    continue
                if not isinstance(message.get("button"), dict) and not isinstance(
                    message.get("interactive"), dict
                ):
                    return False, None
                context = message.get("context")
                replied_to = context.get("id") if isinstance(context, dict) else None
                return True, replied_to if isinstance(replied_to, str) else None
    return False, None


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
                button = message.get("button")
                button_payload = (
                    button.get("payload") if isinstance(button, dict) else None
                )
                if isinstance(button_payload, str) and button_payload.strip():
                    return button_payload
                interactive = message.get("interactive")
                if not isinstance(interactive, dict):
                    continue
                for reply_type in ("button_reply", "list_reply"):
                    reply = interactive.get(reply_type)
                    if isinstance(reply, dict):
                        reply_value = reply.get("id")
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
    if isinstance(error, CommunicationFallbackRequired):
        return str(error), False
    if isinstance(error, HTTPException):
        return "canonical template facts changed; Ops review required", False
    if isinstance(error, WhatsAppProviderError):
        return str(error), error.retryable
    return "delivery dispatch failed", True
