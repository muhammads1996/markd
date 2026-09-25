from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from app.application.channel_actors import ChannelPrincipal
from app.core.config import Settings
from app.integrations.language import ExtractedIntent
from app.integrations.whatsapp import WhatsAppProviderError, normalize_inbound_messages
from app.main import create_app
from app.messaging.templates import TemplateKey, build_template_payload
from app.workers import whatsapp as whatsapp_worker
from app.workers.whatsapp import (
    _exact_assignment_response,
    _try_execute_worker_action,
    run_delivery_jobs,
)


class Result:
    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        row: dict[str, Any] | None = None,
    ) -> None:
        self.rows = rows or []
        self.row = row

    async def fetchall(self) -> list[dict[str, Any]]:
        return self.rows

    async def fetchone(self) -> dict[str, Any] | None:
        return self.row


class DeliveryConnection:
    def __init__(self, deliveries: list[dict[str, Any]]) -> None:
        self.deliveries = deliveries
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> Result:
        self.calls.append((query, params))
        if "claim_channel_deliveries" in query:
            return Result(rows=self.deliveries)
        return Result()


class FakeDatabase:
    def __init__(self, connection: Any) -> None:
        self.connection = connection
        self.in_service_transaction = False

    @asynccontextmanager
    async def service_transaction(self) -> AsyncIterator[Any]:
        self.in_service_transaction = True
        try:
            yield self.connection
        finally:
            self.in_service_transaction = False


class FakeMetaProvider:
    def __init__(self, failure: Exception | None = None) -> None:
        self.failure = failure
        self.sent_text: list[tuple[str, str]] = []
        self.sent_templates: list[tuple[str, Any]] = []
        self.closed = False

    async def send_text(self, recipient: str, body: str) -> str:
        self.sent_text.append((recipient, body))
        if self.failure:
            raise self.failure
        return "wamid-session-1"

    async def send_template(self, recipient: str, template: Any) -> str:
        self.sent_templates.append((recipient, template))
        if self.failure:
            raise self.failure
        return "wamid-template-1"

    async def aclose(self) -> None:
        self.closed = True


def _delivery(delivery_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": delivery_id,
        "recipient_phone_number": "+27821234567",
        "message_payload": payload,
        "source_record_id": "88888888-8888-4888-8888-888888888888",
    }


@pytest.mark.asyncio
async def test_delivery_worker_dispatches_session_and_template_and_records_provider_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    offer = build_template_payload(
        "assignment_offer_do_not_travel",
        "en",
        {"work_date": date(2026, 9, 26), "site_area": "Cape Town"},
    )
    deliveries = [
        _delivery(
            "session-id", {"type": "session_text", "body": "Availability saved."}
        ),
        _delivery("template-id", offer.model_dump(mode="json")),
    ]
    connection = DeliveryConnection(deliveries)
    provider = FakeMetaProvider()
    monkeypatch.setattr(whatsapp_worker, "_meta_provider", lambda _: provider)

    async def verify_current_source(*_: Any) -> None:
        return None

    monkeypatch.setattr(whatsapp_worker, "verify_template_facts", verify_current_source)

    outcomes = await run_delivery_jobs(
        FakeDatabase(connection),
        Settings(
            whatsapp_template_catalog={
                "assignment_offer_do_not_travel": {"en": "approved_offer_en"}
            }
        ),
    )

    assert outcomes == [
        {"delivery_id": "session-id", "outcome": "sent"},
        {"delivery_id": "template-id", "outcome": "sent"},
    ]
    assert provider.sent_text == [("+27821234567", "Availability saved.")]
    assert len(provider.sent_templates) == 1
    assert provider.sent_templates[0][1].name == "approved_offer_en"
    completed = [
        params
        for query, params in connection.calls
        if "complete_channel_delivery" in query
    ]
    assert completed == [
        ("session-id", True, "wamid-session-1", None, False),
        ("template-id", "wamid-template-1"),
    ]
    assert provider.closed


@pytest.mark.asyncio
async def test_unconfigured_template_fails_terminally_without_provider_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = build_template_payload(
        "assignment_accepted_waiting", "en", {"work_date": date(2026, 9, 26)}
    )
    connection = DeliveryConnection(
        [_delivery("template-id", payload.model_dump(mode="json"))]
    )
    provider = FakeMetaProvider()
    monkeypatch.setattr(whatsapp_worker, "_meta_provider", lambda _: provider)

    outcomes = await run_delivery_jobs(FakeDatabase(connection), Settings())

    assert outcomes == [{"delivery_id": "template-id", "outcome": "failed"}]
    assert not provider.sent_templates
    assert not any(
        "mark_channel_delivery_send_started" in query for query, _ in connection.calls
    )
    completion = next(
        params
        for query, params in connection.calls
        if "complete_channel_delivery" in query
    )
    assert completion[1] is False
    assert completion[2] is None
    assert completion[4] is False


@pytest.mark.asyncio
async def test_ambiguous_template_provider_failure_is_terminal_after_send_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = build_template_payload(
        "assignment_accepted_waiting", "en", {"work_date": date(2026, 9, 26)}
    )
    connection = DeliveryConnection(
        [_delivery("template-id", payload.model_dump(mode="json"))]
    )
    provider = FakeMetaProvider(WhatsAppProviderError("temporary provider error", True))
    monkeypatch.setattr(whatsapp_worker, "_meta_provider", lambda _: provider)

    async def verify_current_source(*_: Any) -> None:
        return None

    monkeypatch.setattr(whatsapp_worker, "verify_template_facts", verify_current_source)

    outcomes = await run_delivery_jobs(
        FakeDatabase(connection),
        Settings(
            whatsapp_template_catalog={
                "assignment_accepted_waiting": {"en": "approved_waiting_en"}
            }
        ),
    )

    assert outcomes == [{"delivery_id": "template-id", "outcome": "failed"}]
    assert len(provider.sent_templates) == 1
    assert any(
        "mark_channel_delivery_send_started" in query for query, _ in connection.calls
    )
    completion = next(
        params
        for query, params in connection.calls
        if "complete_channel_delivery" in query
    )
    assert completion[1] is False
    assert completion[4] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("key", "variables"),
    [
        (
            "assignment_offer_do_not_travel",
            {"work_date": date(2026, 9, 26), "site_area": "Cape Town"},
        ),
        (
            "assignment_travel_ready",
            {
                "reporting_at": "2026-09-26T06:30:00+02:00",
                "reporting_place_text": "Main gate",
            },
        ),
    ],
)
async def test_stale_template_source_is_revalidated_before_provider_send(
    monkeypatch: pytest.MonkeyPatch, key: TemplateKey, variables: dict[str, Any]
) -> None:
    payload = build_template_payload(key, "en", variables)
    connection = DeliveryConnection(
        [_delivery("stale-template-id", payload.model_dump(mode="json"))]
    )
    database = FakeDatabase(connection)
    provider = FakeMetaProvider()
    verified: list[tuple[Any, ...]] = []
    monkeypatch.setattr(whatsapp_worker, "_meta_provider", lambda _: provider)

    async def reject_stale_source(*args: Any) -> None:
        assert database.in_service_transaction
        verified.append(args)
        raise ValueError("canonical source changed before send")

    monkeypatch.setattr(whatsapp_worker, "verify_template_facts", reject_stale_source)

    outcomes = await run_delivery_jobs(
        database,
        Settings(whatsapp_template_catalog={key: {"en": f"approved_{key}_en"}}),
    )

    assert outcomes == [{"delivery_id": "stale-template-id", "outcome": "failed"}]
    assert len(verified) == 1
    assert verified[0][1] == payload
    assert verified[0][2] == UUID("88888888-8888-4888-8888-888888888888")
    assert not provider.sent_templates
    assert any(
        "mark_channel_delivery_send_started" in query for query, _ in connection.calls
    )
    completion = next(
        params
        for query, params in connection.calls
        if "complete_channel_delivery" in query
    )
    assert completion[1] is False
    assert completion[4] is False


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ("MARKD_ASSIGNMENT_YES", "accepted"),
        ("MARKD_ASSIGNMENT_NO", "declined"),
        ("MARKD_ASSIGNMENT_CALL_ME", "call_me"),
    ],
)
def test_meta_template_button_payload_maps_to_canonical_assignment_response(
    payload: str, expected: str
) -> None:
    webhook = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "id": "wamid-inbound",
                                    "from": "27821234567",
                                    "timestamp": "1790337600",
                                    "button": {
                                        "text": "localized label",
                                        "payload": payload,
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }

    inbound = normalize_inbound_messages(webhook)

    assert len(inbound) == 1
    assert inbound[0].text == payload
    assert _exact_assignment_response(inbound[0].text or "") == expected


class StaleButtonConnection:
    def __init__(self, event: dict[str, Any]) -> None:
        self.event = event
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> Result:
        self.calls.append((query, params))
        if "from public.channel_deliveries delivery" in query:
            assert params == (
                "wamid-old-offer-a",
                "+27821234567",
                UUID("99999999-9999-4999-8999-999999999999"),
            )
            return Result(rows=[])
        if "select id from public.assignments" in query:
            # Assignment B is now the sole active offer. An old-button lookup
            # must not fall back to this query or bind the response to B.
            return Result(rows=[{"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}])
        return Result()


@pytest.mark.asyncio
async def test_delayed_button_for_old_offer_does_not_fall_back_to_new_active_assignment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker_id = UUID("99999999-9999-4999-8999-999999999999")
    event_id = UUID("11111111-1111-4111-8111-111111111111")
    event = {
        "id": str(event_id),
        "provider_message_id": "wamid-inbound-b",
        "sender_phone_number": "+27821234567",
        "payload": {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {
                                        "id": "wamid-inbound-b",
                                        "button": {"payload": "MARKD_ASSIGNMENT_YES"},
                                        "context": {"id": "wamid-old-offer-a"},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        },
    }

    connection = StaleButtonConnection(event)
    principal = ChannelPrincipal(event_id, worker_id, "worker")
    invoked_commands: list[str] = []

    async def record_command(*args: Any, **kwargs: Any) -> None:
        invoked_commands.append(str(args[3]))

    monkeypatch.setattr(whatsapp_worker, "execute_command", record_command)

    outcome, entity_ids = await _try_execute_worker_action(
        FakeDatabase(connection),
        connection,
        event,
        ExtractedIntent("assignment_response", {"response": "accepted"}, 1, "clear"),
        str(event_id),
        exact_assignment_response=True,
        principal=principal,
    )

    assert outcome is None
    assert entity_ids == {"workerId": str(worker_id)}
    assert not invoked_commands
    assert any(
        "from public.channel_deliveries delivery" in query
        for query, _ in connection.calls
    )
    assert not any(
        "select id from public.assignments" in query for query, _ in connection.calls
    )


class CanonicalAssignmentConnection:
    def __init__(self, recipient: str) -> None:
        self.recipient = recipient
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []

    async def execute(
        self, query: str, params: tuple[Any, ...] | None = None
    ) -> Result:
        self.calls.append((query, params))
        if "select assignment.starts_on" in query:
            return Result(
                row={
                    "work_date": date(2026, 9, 26),
                    "reporting_at": datetime(2026, 9, 26, 6, 30, tzinfo=UTC),
                    "reporting_place_text": "Main gate",
                    "reporting_mode": "self_arranged",
                    "lifecycle": "active",
                    "worker_response": "pending",
                    "offered_at": datetime(2026, 9, 25, tzinfo=UTC),
                    "travel_authorised_at": None,
                    "travel_revoked_at": None,
                    "site_area": "Cape Town",
                    "timezone": "Africa/Johannesburg",
                    "phone_number": self.recipient,
                    "preferred_language_code": "en",
                }
            )
        return Result()


@pytest.mark.parametrize(
    ("request_recipient", "canonical_recipient", "site_area", "detail"),
    [
        (
            "+27821234567",
            "+27821234567",
            "Wrong site",
            "Template values do not match canonical facts",
        ),
        (
            "+27829999999",
            "+27821234567",
            "Cape Town",
            "Template source or recipient is invalid",
        ),
    ],
)
@pytest.mark.asyncio
async def test_internal_endpoint_rejects_template_facts_or_recipient_mismatch(
    request_recipient: str,
    canonical_recipient: str,
    site_area: str,
    detail: str,
) -> None:
    connection = CanonicalAssignmentConnection(canonical_recipient)
    application = create_app(Settings(internal_service_token="internal-token"))
    application.state.database = FakeDatabase(connection)
    payload = build_template_payload(
        "assignment_offer_do_not_travel",
        "en",
        {"work_date": date(2026, 9, 26), "site_area": site_area},
    )
    request = {
        "recipient_phone_number": request_recipient,
        "message_payload": payload.model_dump(mode="json"),
        "message_kind": "assignment_offer_do_not_travel",
        "idempotency_key": "test-delivery-key",
        "source_record_id": "11111111-1111-4111-8111-111111111111",
    }

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/internal/whatsapp/deliveries",
            json=request,
            headers={"X-Internal-Service-Token": "internal-token"},
        )

    assert response.status_code == 422
    assert detail in response.text
    assert not any(
        "insert into public.channel_deliveries" in query
        for query, _ in connection.calls
    )


def test_migration_marks_expired_started_or_max_attempt_leases_terminal() -> None:
    migration_path = (
        Path(__file__).parents[3]
        / "supabase"
        / "migrations"
        / "20260925120000_flo_135_template_deliveries.sql"
    )
    migration = migration_path.read_text(encoding="utf-8")

    assert (
        "create or replace function public.requeue_expired_channel_deliveries()"
        in migration
    )
    assert "when send_started_at is not null or attempts >= 5" in migration
    assert "then 'failed'::public.channel_delivery_state" in migration
    assert "else 'queued'::public.channel_delivery_state" in migration
