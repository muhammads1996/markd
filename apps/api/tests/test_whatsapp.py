import hashlib
import hmac
import json
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient, MockTransport, Request, Response

from app.core.config import Settings
from app.integrations.language import (
    ExtractedIntent,
    OpenRouterProvider,
    ProviderEvidence,
    Transcription,
    extract_intent,
)
from app.integrations.whatsapp import MetaWhatsAppCloudProvider, WhatsAppProviderError
from app.main import create_app
from app.workers import whatsapp as whatsapp_worker
from app.workers.whatsapp import (
    _availability_work_date,
    _exact_assignment_response,
    _process_message_job,
    _try_execute_worker_action,
    run_command_outbox_jobs,
    run_delivery_jobs,
)

pytestmark = pytest.mark.asyncio


class FakeResult:
    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self._row = row

    async def fetchone(self) -> dict[str, Any] | None:
        return self._row

    async def fetchall(self) -> list[dict[str, Any]]:
        return []


class WebhookConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []
        self.inbound_inserts = 0

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
        if "insert into public.channel_events" in query and "returning id" in query:
            self.inbound_inserts += 1
            return FakeResult(
                {"id": "11111111-1111-4111-8111-111111111111"}
                if self.inbound_inserts == 1
                else None
            )
        if "select id from public.channel_events" in query:
            return FakeResult({"id": "11111111-1111-4111-8111-111111111111"})
        return FakeResult()


class FakeDatabase:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    @asynccontextmanager
    async def service_transaction(self) -> Any:
        yield self.connection


def _application(connection: WebhookConnection):
    application = create_app(
        Settings(
            whatsapp_verify_token="verify-token",
            whatsapp_app_secret="app-secret",
            internal_service_token="internal-token",
        )
    )
    application.state.database = FakeDatabase(connection)
    return application


async def test_webhook_challenge_requires_the_configured_token() -> None:
    connection = WebhookConnection()
    async with AsyncClient(
        transport=ASGITransport(app=_application(connection)), base_url="http://test"
    ) as client:
        accepted = await client.get(
            "/webhooks/whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "verify-token",
                "hub.challenge": "challenge-value",
            },
        )
        rejected = await client.get(
            "/webhooks/whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "wrong-token",
                "hub.challenge": "challenge-value",
            },
        )

    assert accepted.status_code == 200
    assert accepted.text == "challenge-value"
    assert rejected.status_code == 403


async def test_webhook_persists_replayed_messages_and_read_status_as_evidence() -> None:
    connection = WebhookConnection()
    payload = {
        "id": "provider-event-1",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "27821234567",
                                    "id": "wamid-inbound-1",
                                    "timestamp": "1789459200",
                                    "text": {"body": "I am available tomorrow"},
                                    "audio": {
                                        "id": "media-1",
                                        "mime_type": "audio/ogg",
                                    },
                                }
                            ],
                            "statuses": [
                                {
                                    "id": "wamid-outbound-1",
                                    "status": "read",
                                    "timestamp": "1789459200",
                                }
                            ],
                        }
                    }
                ]
            }
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    signature = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    async with AsyncClient(
        transport=ASGITransport(app=_application(connection)), base_url="http://test"
    ) as client:
        first = await client.post(
            "/webhooks/whatsapp",
            content=body,
            headers={"X-Hub-Signature-256": signature},
        )
        replay = await client.post(
            "/webhooks/whatsapp",
            content=body,
            headers={"X-Hub-Signature-256": signature},
        )
        invalid = await client.post(
            "/webhooks/whatsapp",
            content=body,
            headers={"X-Hub-Signature-256": "sha256=invalid"},
        )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert invalid.status_code == 401
    assert first.json() == {
        "received": True,
        "inbound_messages": 1,
        "delivery_statuses": 1,
    }
    assert sum("channel_media_assets" in query for query, _ in connection.calls) == 2
    status_calls = [
        params
        for query, params in connection.calls
        if "record_channel_delivery_status" in query
    ]
    status_event_inserts = [
        params
        for query, params in connection.calls
        if "insert into public.channel_events" in query and "'status'" in query
    ]
    assert len(status_calls) == 2
    assert all(
        status_call is not None
        and status_call[0] == "wamid-outbound-1"
        and status_call[1] == "delivered"
        and status_call[3] is None
        for status_call in status_calls
    )
    assert len(status_event_inserts) == 2
    assert all(
        event_insert is not None and event_insert[3] == "wamid-outbound-1"
        for event_insert in status_event_inserts
    )


async def test_webhook_preserves_unknown_valid_event_as_evidence() -> None:
    connection = WebhookConnection()
    payload = {"entry": [{"changes": [{"value": {"contacts": []}}]}]}
    body = json.dumps(payload).encode("utf-8")
    signature = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    async with AsyncClient(
        transport=ASGITransport(app=_application(connection)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/webhooks/whatsapp",
            content=body,
            headers={"X-Hub-Signature-256": signature},
        )

    assert response.status_code == 200
    unsupported_insert = next(
        (query for query, _ in connection.calls if "'unsupported'" in query),
        None,
    )
    assert unsupported_insert is not None
    assert "on conflict (channel, provider_event_id) do nothing" in unsupported_insert


class ProcessingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []
        self.event = {
            "id": "11111111-1111-4111-8111-111111111111",
            "event_type": "message",
            "provider_message_id": "wamid-inbound-1",
            "occurred_at": datetime(2026, 9, 16, 23, 30, tzinfo=UTC),
            "payload": {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "messages": [
                                        {
                                            "id": "wamid-inbound-1",
                                            "text": {"body": "I am available tomorrow"},
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            },
        }

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
        if "from public.channel_events" in query:
            return FakeResult(self.event)
        return FakeResult()


class RowsResult(FakeResult):
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        super().__init__(rows[0] if rows else None)
        self._rows = rows

    async def fetchall(self) -> list[dict[str, Any]]:
        return self._rows


class DirectProcessingConnection(ProcessingConnection):
    def __init__(self, assignment_ids: list[str] | None = None) -> None:
        super().__init__()
        self.assignment_ids = assignment_ids or ["88888888-8888-4888-8888-888888888888"]

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
        if "from public.channel_events as event" in query:
            return RowsResult(
                [
                    {
                        "auth_user_id": "44444444-4444-4444-8444-444444444444",
                        "worker_id": "99999999-9999-4999-8999-999999999999",
                    }
                ]
            )
        if "select id from public.assignments" in query:
            return RowsResult(
                [{"id": assignment_id} for assignment_id in self.assignment_ids]
            )
        if "from public.channel_events" in query:
            return FakeResult(self.event)
        return FakeResult()


class AudioProcessingConnection(ProcessingConnection):
    def __init__(self) -> None:
        super().__init__()
        self.event["payload"] = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "id": "wamid-inbound-1",
                                        "audio": {
                                            "id": "media-1",
                                            "mime_type": "audio/ogg",
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }
        self.media = {
            "id": "22222222-2222-4222-8222-222222222222",
            "provider_media_id": "media-1",
            "media_type": "audio",
            "mime_type": "audio/ogg",
            "retrieval_state": "pending",
            "storage_bucket": None,
            "storage_path": None,
        }

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
        if "from public.channel_events" in query:
            return FakeResult(self.event)
        if "from public.channel_media_assets" in query:
            return FakeResult(self.media)
        return FakeResult()


class FakeLanguageProvider:
    async def transcribe(self, media_bytes: bytes, mime_type: str) -> Transcription:
        assert media_bytes == b"voice-note"
        assert mime_type == "audio/ogg"
        return Transcription(
            "Ndiyakwazi ukusebenza ngomso",
            "xh",
            0.65,
            ProviderEvidence("openrouter", "transcription-model", 42, 0.002, False),
        )

    async def extract_intent(
        self, text: str, language_code: str | None
    ) -> ExtractedIntent:
        assert text == "Ndiyakwazi ukusebenza ngomso"
        assert language_code == "xh"
        return ExtractedIntent(
            "worker_availability",
            {"availability": "tomorrow"},
            0.82,
            "clear",
            ProviderEvidence("openrouter", "intent-model", 23, 0.001, False),
        )

    async def aclose(self) -> None:
        return None


async def test_message_processing_creates_only_a_proposed_action_draft() -> None:
    connection = ProcessingConnection()
    outcome = await _process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key=""),
    )
    assert outcome == "created"
    action_call = next(
        (params for query, params in connection.calls if "proposed_actions" in query),
        None,
    )
    assert action_call is not None
    assert action_call[1] == "worker_availability"
    assert all(
        table not in query
        for query, _ in connection.calls
        for table in ("workmarks", "assignments", "worker_availability")
    )


async def test_exact_yes_executes_canonical_assignment_command_with_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = DirectProcessingConnection()
    connection.event["payload"]["entry"][0]["changes"][0]["value"]["messages"][0][
        "text"
    ]["body"] = " YES "
    observed: dict[str, Any] = {}

    async def mutation(*args: Any, **kwargs: Any) -> Any:
        observed["response"] = args[3].response
        observed["source_event_id"] = kwargs["source_channel_event_id"]
        return None

    async def dispatch(*args: Any, **kwargs: Any) -> Any:
        observed["command_name"] = args[3]
        observed["idempotency_key"] = args[4]
        await args[6](connection)
        return None

    monkeypatch.setattr(whatsapp_worker, "respond_to_assignment_mutation", mutation)
    monkeypatch.setattr(whatsapp_worker, "execute_command", dispatch)

    outcome = await _process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key=""),
        FakeDatabase(connection),
    )

    assert outcome == "executed"
    assert observed["command_name"] == "RespondToAssignment"
    assert observed["idempotency_key"] == "wa:wamid-inbound-1:respond-to-assignment"
    assert observed["response"] == "accepted"
    assert str(observed["source_event_id"]) == connection.event["id"]
    assert not any("proposed_actions" in query for query, _ in connection.calls)


@pytest.mark.parametrize(
    ("reply", "response"),
    [
        ("YES", "accepted"),
        ("JA", "accepted"),
        ("EWE", "accepted"),
        ("NO", "declined"),
        ("NEE", "declined"),
        ("HAYI", "declined"),
        ("CALL ME", "call_me"),
        ("3", "call_me"),
    ],
)
async def test_exact_assignment_response_supports_worker_offer_templates(
    reply: str, response: str
) -> None:
    assert _exact_assignment_response(reply) == response


async def test_ambiguous_assignment_response_remains_proposed_action(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = DirectProcessingConnection()
    connection.event["payload"]["entry"][0]["changes"][0]["value"]["messages"][0][
        "text"
    ]["body"] = "I'll take it"
    intent = ExtractedIntent(
        "assignment_response",
        {"response": "accepted"},
        0.95,
        "clear",
        ProviderEvidence("openrouter", "intent-model", 23, 0.001, False),
    )

    monkeypatch.setattr(whatsapp_worker, "extract_intent", lambda *_: intent)

    async def cannot_execute(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("model-derived assignment response must not execute")

    monkeypatch.setattr(whatsapp_worker, "execute_command", cannot_execute)

    outcome = await _process_message_job(
        connection,
        connection.event["id"],
        Settings(openrouter_api_key=""),
        FakeDatabase(connection),
    )
    action_call = next(
        (params for query, params in connection.calls if "proposed_actions" in query),
        None,
    )

    assert outcome == "created"
    assert action_call is not None
    assert action_call[1] == "assignment_response"
    assert action_call[2] == "clear"
    assert action_call[8].obj["fields"] == {"response": "accepted"}
    assert action_call[8].obj["entityIds"] == {
        "workerId": "99999999-9999-4999-8999-999999999999"
    }
    assert not any(
        "select id from public.assignments" in query for query, _ in connection.calls
    )


async def test_ambiguous_assignment_response_is_not_directly_executable() -> None:
    connection = DirectProcessingConnection()
    outcome, entity_ids = await _try_execute_worker_action(
        FakeDatabase(connection),
        connection,
        connection.event,
        ExtractedIntent(
            "assignment_response",
            {"response": "accepted"},
            0.6,
            "ambiguous",
        ),
        connection.event["id"],
        exact_assignment_response=False,
    )

    assert outcome is None
    assert entity_ids == {"workerId": "99999999-9999-4999-8999-999999999999"}
    assert not any(
        "select id from public.assignments" in query for query, _ in connection.calls
    )


async def test_unresolved_or_multiple_assignment_response_remains_draft() -> None:
    connection = DirectProcessingConnection(
        [
            "88888888-8888-4888-8888-888888888888",
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ]
    )
    connection.event["payload"]["entry"][0]["changes"][0]["value"]["messages"][0][
        "text"
    ]["body"] = "NO"

    outcome = await _process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key=""),
        FakeDatabase(connection),
    )

    action_call = next(
        (params for query, params in connection.calls if "proposed_actions" in query),
        None,
    )
    assert outcome == "created"
    assert action_call is not None
    assert action_call[1] == "assignment_response"
    assert action_call[8].obj["fields"] == {"response": "declined"}
    assert action_call[8].obj["entityIds"] == {
        "workerId": "99999999-9999-4999-8999-999999999999"
    }


async def test_resolved_availability_executes_canonical_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = DirectProcessingConnection()
    observed: dict[str, Any] = {}

    async def mutation(*args: Any, **kwargs: Any) -> Any:
        observed["status"] = args[4].status
        observed["source"] = kwargs["source"]
        observed["source_event_id"] = kwargs["source_channel_event_id"]
        return None

    async def dispatch(*args: Any, **kwargs: Any) -> Any:
        observed["command_name"] = args[3]
        await args[6](connection)
        return None

    monkeypatch.setattr(whatsapp_worker, "set_worker_availability_mutation", mutation)
    monkeypatch.setattr(whatsapp_worker, "execute_command", dispatch)

    outcome = await _process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key=""),
        FakeDatabase(connection),
    )

    assert outcome == "executed"
    assert observed["command_name"] == "SetWorkerAvailability"
    assert observed["status"] == "available"
    assert observed["source"] == "whatsapp"
    assert str(observed["source_event_id"]) == connection.event["id"]


async def test_availability_date_uses_the_immutable_event_timestamp() -> None:
    occurred_at = datetime(2026, 9, 16, 23, 30, tzinfo=UTC)

    assert _availability_work_date("today", occurred_at) == date(2026, 9, 16)
    assert _availability_work_date("tomorrow", occurred_at) == date(2026, 9, 17)


class OutboxConnection:
    def __init__(
        self,
        event_type: str = "assignment.travel_authorised",
        payload: dict[str, object] | None = None,
    ) -> None:
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []
        self.claimed = False
        self.event_type = event_type
        self.payload = payload or {}

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
        if "with claimed" in query:
            return RowsResult(
                [
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "domain_event_id": "22222222-2222-4222-8222-222222222222",
                    }
                ]
            )
        if "from private.domain_events" in query:
            return FakeResult(
                {
                    "id": "22222222-2222-4222-8222-222222222222",
                    "event_type": self.event_type,
                    "aggregate_id": "88888888-8888-4888-8888-888888888888",
                    "assignment_id": "88888888-8888-4888-8888-888888888888",
                    "phone_number": "+27821234567",
                    "payload": self.payload,
                }
            )
        if "where assignment.id = any" in query:
            return RowsResult(
                [
                    {
                        "assignment_id": assignment_id,
                        "phone_number": phone_number,
                    }
                    for assignment_id, phone_number in (
                        (
                            "88888888-8888-4888-8888-888888888888",
                            "+27821234567",
                        ),
                        (
                            "99999999-9999-4999-8999-999999999999",
                            "+27829876543",
                        ),
                    )
                ]
            )
        return FakeResult()


async def test_command_outbox_mirrors_travel_authorisation_after_commit() -> None:
    connection = OutboxConnection()

    outcomes = await run_command_outbox_jobs(FakeDatabase(connection))

    delivery = next(
        (
            params
            for query, params in connection.calls
            if "insert into public.channel_deliveries" in query
        ),
        None,
    )
    assert outcomes == [
        {"outbox_id": "11111111-1111-4111-8111-111111111111", "outcome": "published"}
    ]
    assert delivery == (
        "+27821234567",
        "WORK CONFIRMED. GO to the reporting point.",
        "assignment_update",
        "domain-event:22222222-2222-4222-8222-222222222222",
    )
    assert any("set state = 'published'" in query for query, _ in connection.calls)


@pytest.mark.parametrize(
    ("event_type", "expected_body"),
    [
        ("assignment.travel_revoked", "Work details changed. DO NOT TRAVEL."),
        ("labour_request.cancelled", "Work cancelled. DO NOT TRAVEL."),
    ],
)
async def test_command_outbox_notifies_workers_not_to_travel_after_revocation(
    event_type: str, expected_body: str
) -> None:
    connection = OutboxConnection(
        event_type,
        {
            "cancelled_assignment_ids": [
                "88888888-8888-4888-8888-888888888888",
                "99999999-9999-4999-8999-999999999999",
            ]
        },
    )

    await run_command_outbox_jobs(FakeDatabase(connection))

    deliveries = [
        params
        for query, params in connection.calls
        if "insert into public.channel_deliveries" in query
    ]
    assert len(deliveries) == (2 if event_type == "labour_request.cancelled" else 1)
    assert all(
        delivery is not None and delivery[1] == expected_body for delivery in deliveries
    )
    if event_type == "labour_request.cancelled":
        assert {delivery[3] for delivery in deliveries if delivery} == {
            "domain-event:22222222-2222-4222-8222-222222222222:88888888-8888-4888-8888-888888888888",
            "domain-event:22222222-2222-4222-8222-222222222222:99999999-9999-4999-8999-999999999999",
        }


async def test_command_outbox_queues_availability_acknowledgement_after_commit(
) -> None:
    connection = OutboxConnection("worker.availability_set")

    outcomes = await run_command_outbox_jobs(FakeDatabase(connection))

    delivery = next(
        (
            params
            for query, params in connection.calls
            if "insert into public.channel_deliveries" in query
        ),
        None,
    )
    assert outcomes == [
        {"outbox_id": "11111111-1111-4111-8111-111111111111", "outcome": "published"}
    ]
    assert delivery == (
        "+27821234567",
        "Availability saved.",
        "availability_update",
        "domain-event:22222222-2222-4222-8222-222222222222",
    )
    assert any("availability_signals" in query for query, _ in connection.calls)


async def test_audio_processing_persists_transcription_evidence_as_ambiguous_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = AudioProcessingConnection()

    async def retrieve_audio(
        connection: Any, media: Any, channel_event_id: str, settings: Settings
    ) -> tuple[bytes, str]:
        assert media["provider_media_id"] == "media-1"
        assert channel_event_id == "11111111-1111-4111-8111-111111111111"
        assert settings.openrouter_api_key == "test-key"
        return b"voice-note", "audio/ogg"

    monkeypatch.setattr(whatsapp_worker, "_retrieve_audio", retrieve_audio)
    monkeypatch.setattr(
        whatsapp_worker,
        "_openrouter_provider",
        lambda _: FakeLanguageProvider(),
    )

    outcome = await whatsapp_worker._process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key="test-key"),
    )

    transcript_update = next(
        (
            params
            for query, params in connection.calls
            if "set transcript = %s" in query
        ),
        None,
    )
    action_insert = next(
        (params for query, params in connection.calls if "proposed_actions" in query),
        None,
    )
    assert outcome == "created"
    assert transcript_update is not None
    assert transcript_update[:6] == (
        "Ndiyakwazi ukusebenza ngomso",
        0.65,
        "xh",
        "openrouter",
        "transcription-model",
        42,
    )
    assert action_insert is not None
    assert action_insert[1] == "worker_availability"
    assert action_insert[2] == "ambiguous"
    assert action_insert[6:8] == ("openrouter", "intent-model")
    assert all(
        table not in query
        for query, _ in connection.calls
        for table in ("workmarks", "assignments", "worker_availability")
    )


async def test_language_rules_cover_supported_languages_and_uncertainty() -> None:
    afrikaans = extract_intent("Ek is beskikbaar more", "af")
    isixhosa = extract_intent("Ndiyakwazi ukusebenza ngomso", "xh")
    code_switched = extract_intent("I am beskikbaar after work", None)

    assert afrikaans is not None
    assert afrikaans.fields == {"availability": "tomorrow"}
    assert isixhosa is not None
    assert isixhosa.fields == {"availability": "tomorrow"}
    assert code_switched is not None
    assert code_switched.ambiguity == "ambiguous"


async def test_interactive_reply_is_usable_as_message_evidence() -> None:
    connection = ProcessingConnection()
    connection.event["payload"] = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "id": "wamid-inbound-1",
                                    "interactive": {
                                        "button_reply": {"id": "available tomorrow"}
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }

    outcome = await _process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key=""),
    )

    assert outcome == "created"


async def test_batched_webhook_jobs_use_the_matching_provider_message() -> None:
    connection = ProcessingConnection()
    connection.event["provider_message_id"] = "wamid-inbound-2"
    messages = connection.event["payload"]["entry"][0]["changes"][0]["value"][
        "messages"
    ]
    messages.append({"id": "wamid-inbound-2", "text": {"body": "We need 4 workers"}})

    outcome = await _process_message_job(
        connection,
        "11111111-1111-4111-8111-111111111111",
        Settings(openrouter_api_key=""),
    )

    action_call = next(
        (params for query, params in connection.calls if "proposed_actions" in query),
        None,
    )
    assert outcome == "created"
    assert action_call is not None
    assert action_call[1] == "labour_request"


async def test_meta_provider_marks_transient_send_failure_retryable() -> None:
    async def handler(_: Request) -> Response:
        return Response(503)

    client = AsyncClient(transport=MockTransport(handler))
    provider = MetaWhatsAppCloudProvider("token", "phone-id", client=client)
    try:
        with pytest.raises(WhatsAppProviderError) as error:
            await provider.send_text("+27821234567", "Test")
    finally:
        await provider.aclose()

    assert error.value.retryable is True


async def test_idle_delivery_worker_does_not_require_provider_credentials() -> None:
    outcomes = await run_delivery_jobs(
        FakeDatabase(WebhookConnection()), Settings(whatsapp_access_token="")
    )

    assert outcomes == []


async def test_openrouter_retries_the_configured_fallback_model() -> None:
    requested_models: list[str] = []

    async def handler(request: Request) -> Response:
        body = json.loads(request.content)
        requested_models.append(body["model"])
        if body["model"] == "primary-model":
            return Response(503)
        return Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "actionType": "labour_request",
                                    "fields": {"headcount": 4},
                                    "confidence": 0.74,
                                    "ambiguity": "clear",
                                }
                            )
                        }
                    }
                ],
                "usage": {"cost": 0.0008},
            },
        )

    client = AsyncClient(transport=MockTransport(handler))
    provider = OpenRouterProvider(
        "test-key",
        "https://openrouter.test",
        ("primary-model", "fallback-model"),
        ("audio-model", ""),
        300,
        500,
        0.01,
        0.03,
        client=client,
    )
    try:
        intent = await provider.extract_intent("Need 4 workers", "en")
    finally:
        await provider.aclose()

    assert requested_models == ["primary-model", "fallback-model"]
    assert intent is not None
    assert intent.evidence is not None
    assert intent.evidence.used_fallback is True
