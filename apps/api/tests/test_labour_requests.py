import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import (
    get_database,
    get_labour_command_actor,
    get_operator_actor,
)
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.main import create_app

pytestmark = pytest.mark.asyncio


class FakeResult:
    def __init__(self, row: dict[str, object] | None = None) -> None:
        self._row = row

    async def fetchone(self) -> dict[str, object] | None:
        return self._row


class FakeConnection:
    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        if "insert into private.command_executions" in query:
            return FakeResult({"id": uuid.UUID("11111111-1111-4111-8111-111111111111")})
        if "insert into public.labour_requests" in query:
            return FakeResult({"id": uuid.UUID("22222222-2222-4222-8222-222222222222")})
        if "from public.proposed_actions" in query:
            return FakeResult(
                {
                    "id": uuid.UUID("66666666-6666-4666-8666-666666666666"),
                    "action_type": "labour_request",
                    "state": "pending",
                    "channel_event_id": uuid.UUID(
                        "77777777-7777-4777-8777-777777777777"
                    ),
                }
            )
        if "insert into private.domain_events" in query:
            return FakeResult({"id": uuid.UUID("33333333-3333-4333-8333-333333333333")})
        return FakeResult()


class FakeDatabase:
    def __init__(self) -> None:
        self.connection = FakeConnection()

    def transaction(self, *_: object):
        class Transaction:
            async def __aenter__(self) -> FakeConnection:
                return FakeConnection()

            async def __aexit__(self, *_: object) -> None:
                return None

        return Transaction()


async def test_create_labour_request_uses_the_canonical_command_boundary() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_database] = FakeDatabase
    application.dependency_overrides[get_labour_command_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/labour-requests",
            headers={"Idempotency-Key": "create-request-1"},
            json={
                "contractor_organisation_id": "55555555-5555-4555-8555-555555555555",
                "work_date": "2026-09-18",
                "start_time": "07:30",
                "timezone": "Africa/Johannesburg",
                "site_area": "Woodstock, Cape Town",
                "pay": {
                    "amount_minor": 45000,
                    "currency": "ZAR",
                    "basis": "daily",
                    "terms_text": "Paid at end of day",
                },
                "requirements": [{"work_type": "painter", "headcount": 2}],
            },
        )

    assert response.status_code == 201
    assert response.json()["resource"] == {
        "type": "labour_request",
        "id": "22222222-2222-4222-8222-222222222222",
        "version": 1,
    }


async def test_confirmed_proposed_action_uses_labour_request_command_policy() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_database] = FakeDatabase
    operator = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )
    application.dependency_overrides[get_operator_actor] = lambda: operator

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/proposed-actions/66666666-6666-4666-8666-666666666666/confirm",
            headers={"Idempotency-Key": "confirm-action-1"},
            json={
                "labour_request": {
                    "contractor_organisation_id": (
                        "55555555-5555-4555-8555-555555555555"
                    ),
                    "work_date": "2026-09-18",
                    "timezone": "Africa/Johannesburg",
                    "site_area": "Woodstock, Cape Town",
                    "pay": {
                        "amount_minor": 45000,
                        "currency": "ZAR",
                        "basis": "daily",
                    },
                    "requirements": [{"work_type": "painter", "headcount": 2}],
                }
            },
        )

    assert response.status_code == 201
    assert response.json()["resource"]["type"] == "labour_request"
