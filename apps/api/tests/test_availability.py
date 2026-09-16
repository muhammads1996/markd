import uuid
from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_database, get_labour_command_actor
from app.api.v1.availability import (
    SetWorkerAvailabilityInput,
    set_worker_availability_mutation,
)
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.core.problems import ProblemDetail
from app.main import create_app

pytestmark = pytest.mark.asyncio

ACTOR_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")
WORKER_ID = uuid.UUID("99999999-9999-4999-8999-999999999999")
SIGNAL_ID = uuid.UUID("88888888-8888-4888-8888-888888888888")
COMMAND_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


class FakeResult:
    def __init__(self, row: dict[str, object] | None = None) -> None:
        self._row = row

    async def fetchone(self) -> dict[str, object] | None:
        return self._row


class FakeConnection:
    def __init__(self, current: dict[str, object] | None = None) -> None:
        self.current = current
        self.archived_ids: list[object] = []
        self.insert_params: tuple[object, ...] | None = None
        self.queries: list[str] = []

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        self.queries.append(query)
        if "insert into private.command_executions" in query:
            return FakeResult({"id": COMMAND_ID})
        if "from public.availability_signals" in query:
            return FakeResult(self.current)
        if "update public.availability_signals" in query:
            assert params is not None
            self.archived_ids.append(params[0])
            return FakeResult()
        if "insert into public.availability_signals" in query:
            assert params is not None
            self.insert_params = params
            return FakeResult({"id": SIGNAL_ID, "version": 1})
        if "insert into private.domain_events" in query:
            return FakeResult({"id": SIGNAL_ID})
        return FakeResult()


class FakeDatabase:
    def __init__(self) -> None:
        self.connection = FakeConnection()

    def transaction(self, *_: object):
        connection = self.connection

        class Transaction:
            async def __aenter__(self) -> FakeConnection:
                return connection

            async def __aexit__(self, *_: object) -> None:
                return None

        return Transaction()


def _worker_actor() -> CurrentActor:
    return CurrentActor(
        user_id=ACTOR_ID,
        claims={
            "participant_person_id": str(WORKER_ID),
            "worker_scope": True,
            "contractor_contacts": [],
        },
    )


def _contractor_actor() -> CurrentActor:
    return CurrentActor(
        user_id=ACTOR_ID,
        claims={
            "participant_person_id": str(WORKER_ID),
            "contractor_contacts": [
                {"organisation_id": "55555555-5555-4555-8555-555555555555"}
            ],
        },
    )


async def test_worker_self_update_uses_canonical_command_boundary() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_database] = FakeDatabase
    application.dependency_overrides[get_labour_command_actor] = _worker_actor

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.put(
            f"/api/v1/workers/{WORKER_ID}/availability/2026-09-18",
            headers={"Idempotency-Key": "set-availability-1"},
            json={"status": "available"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["resource"] == {
        "type": "availability_signal",
        "id": str(SIGNAL_ID),
        "version": 1,
    }
    assert response.headers["X-Idempotent-Replay"] == "false"


async def test_contractor_cannot_record_worker_availability() -> None:
    with pytest.raises(ProblemDetail) as error:
        await set_worker_availability_mutation(
            FakeConnection(),
            _contractor_actor(),
            WORKER_ID,
            date(2026, 9, 18),
            SetWorkerAvailabilityInput(status="available"),
        )

    assert error.value.status_code == 403




async def test_same_status_and_note_are_already_applied_without_domain_event() -> None:
    connection = FakeConnection(
        {"id": SIGNAL_ID, "status": "available", "note": "Near site", "version": 2}
    )

    result = await set_worker_availability_mutation(
        connection,
        _worker_actor(),
        WORKER_ID,
        date(2026, 9, 18),
        SetWorkerAvailabilityInput(
            status="available", note="Near site", expected_version=2
        ),
    )

    assert result.body["status"] == "already_applied"
    assert result.event_type is None
    assert connection.archived_ids == []
    assert connection.insert_params is None


async def test_changed_status_or_note_archives_then_inserts_actor_and_source_provenance() -> (
    None
):
    connection = FakeConnection(
        {"id": SIGNAL_ID, "status": "available", "note": None, "version": 1}
    )

    result = await set_worker_availability_mutation(
        connection,
        _worker_actor(),
        WORKER_ID,
        date(2026, 9, 18),
        SetWorkerAvailabilityInput(
            status="available", note="Near site", expected_version=1
        ),
        source="ops",
    )

    assert result.event_type == "worker.availability_set"
    assert connection.archived_ids == [SIGNAL_ID]
    assert connection.insert_params == (
        WORKER_ID,
        date(2026, 9, 18),
        date(2026, 9, 18),
        "available",
        "Near site",
        "ops",
        ACTOR_ID,
        None,
        None,
    )
    assert connection.queries.index(
        next(query for query in connection.queries if "update public" in query)
    ) < connection.queries.index(
        next(query for query in connection.queries if "insert into public" in query)
    )


async def test_availability_command_route_is_published() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))

    assert (
        "/api/v1/workers/{worker_id}/availability/{work_date}"
        in application.openapi()["paths"]
    )
