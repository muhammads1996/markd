import hashlib
import hmac
import json
from contextlib import asynccontextmanager
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient, MockTransport, Request, Response

from app.core.config import Settings
from app.integrations.language import OpenRouterProvider
from app.integrations.whatsapp import MetaWhatsAppCloudProvider, WhatsAppProviderError
from app.main import create_app
from app.workers.whatsapp import _process_message_job, run_delivery_jobs

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
    signature = "sha256=" + hmac.new(
        b"app-secret", body, hashlib.sha256
    ).hexdigest()
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
    assert len(status_calls) == 2
    assert all(
        status_call is not None
        and status_call[0] == "wamid-outbound-1"
        and status_call[1] == "delivered"
        and status_call[3] is None
        for status_call in status_calls
    )


async def test_webhook_preserves_unknown_valid_events_without_enqueuing_provider_work(
) -> None:
    connection = WebhookConnection()
    payload = {"entry": [{"changes": [{"value": {"contacts": []}}]}]}
    body = json.dumps(payload).encode("utf-8")
    signature = "sha256=" + hmac.new(
        b"app-secret", body, hashlib.sha256
    ).hexdigest()
    async with AsyncClient(
        transport=ASGITransport(app=_application(connection)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/webhooks/whatsapp",
            content=body,
            headers={"X-Hub-Signature-256": signature},
        )

    assert response.status_code == 200
    assert any("'unsupported'" in query for query, _ in connection.calls)


class ProcessingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []
        self.event = {
            "id": "11111111-1111-4111-8111-111111111111",
            "event_type": "message",
            "provider_message_id": "wamid-inbound-1",
            "payload": {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "messages": [
                                        {
                                            "id": "wamid-inbound-1",
                                            "text": {
                                                "body": "I am available tomorrow"
                                            }
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
                                    }
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
    messages.append(
        {"id": "wamid-inbound-2", "text": {"body": "We need 4 workers"}}
    )

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