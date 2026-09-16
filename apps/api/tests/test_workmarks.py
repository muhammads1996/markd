import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_database, get_labour_command_actor
from app.api.v1.workmarks import (
    _aggregate,
    _resolve_assertion,
)
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.core.problems import ProblemDetail
from app.main import create_app

pytestmark = pytest.mark.asyncio

WORKER_ID = uuid.UUID("99999999-9999-4999-8999-999999999999")
HIRER_ID = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")


class EmptyResult:
    async def fetchone(self) -> dict[str, bool]:
        return {"valid": True}


class Connection:
    async def execute(self, query: str, params: tuple[object, ...]) -> EmptyResult:
        return EmptyResult()


class RowsResult(EmptyResult):
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    async def fetchone(self) -> dict[str, object] | None:
        return self.rows[0] if self.rows else None

    async def fetchall(self) -> list[dict[str, object]]:
        return self.rows


class StampConnection:
    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> RowsResult:
        assignment = {
            "id": uuid.UUID("88888888-8888-4888-8888-888888888888"),
            "labour_request_id": uuid.UUID("22222222-2222-4222-8222-222222222222"),
            "worker_id": WORKER_ID,
            "organisation_id": uuid.UUID("55555555-5555-4555-8555-555555555555"),
            "hirer_person_id": None,
            "site_id": None,
            "starts_on": "2026-09-18",
            "ends_on": "2026-09-18",
            "lifecycle": "active",
            "worker_response": "accepted",
            "contractor_confirmation": "confirmed",
            "travel_authorised_at": None,
            "version": 1,
        }
        if "insert into private.command_executions" in query:
            return RowsResult(
                [{"id": uuid.UUID("11111111-1111-4111-8111-111111111111")}]
            )
        if "from public.assignments" in query:
            return RowsResult([assignment])
        if "insert into public.workmarks" in query:
            return RowsResult(
                [
                    {
                        "id": uuid.UUID("40000000-0000-4000-8000-000000000001"),
                        "version": 1,
                    }
                ]
            )
        if "select id from public.assignment_stamps" in query:
            return RowsResult(
                [{"id": uuid.UUID("41000000-0000-4000-8000-000000000001")}]
            )
        if "from public.assignment_stamps" in query:
            return RowsResult(
                [
                    {
                        "asserted_role": "operator",
                        "attendance": "attended",
                        "completion": "unknown",
                        "reuse_preference": "unknown",
                        "payment": "unknown",
                        "amount_cents": None,
                        "currency": None,
                        "payment_method": None,
                    }
                ]
            )
        if "from public.workmark_corrections" in query:
            return RowsResult([])
        if "update public.workmarks" in query:
            return RowsResult(
                [
                    {
                        "id": uuid.UUID("40000000-0000-4000-8000-000000000001"),
                        "version": 2,
                    }
                ]
            )
        if "insert into private.domain_events" in query:
            return RowsResult(
                [{"id": uuid.UUID("33333333-3333-4333-8333-333333333333")}]
            )
        return RowsResult([])


class StampDatabase:
    def transaction(self, *_: object):
        class Transaction:
            async def __aenter__(self) -> StampConnection:
                return StampConnection()

            async def __aexit__(self, *_: object) -> None:
                return None

        return Transaction()


def stamp(
    role: str,
    *,
    attendance: str = "unknown",
    completion: str = "unknown",
    payment: str = "unknown",
    reuse_preference: str = "unknown",
    amount_cents: int | None = None,
    currency: str | None = None,
    payment_method: str | None = None,
) -> dict[str, object]:
    return {
        "asserted_role": role,
        "attendance": attendance,
        "completion": completion,
        "payment": payment,
        "reuse_preference": reuse_preference,
        "amount_cents": amount_cents,
        "currency": currency,
        "payment_method": payment_method,
    }


async def test_worker_and_hirer_agreement_is_corroborated() -> None:
    aggregate = _aggregate(
        [
            stamp("worker", attendance="attended", completion="completed"),
            stamp("hirer", attendance="attended", completion="completed"),
        ],
        [],
    )

    assert aggregate["evidence_state"] == "corroborated"
    assert aggregate["attendance"] == "attended"
    assert aggregate["completion"] == "completed"


async def test_conflicting_attendance_and_payment_are_preserved() -> None:
    aggregate = _aggregate(
        [
            stamp("worker", attendance="attended", payment="unknown"),
            stamp("hirer", attendance="no_show", payment="paid", amount_cents=100),
            stamp("worker", payment="disputed", amount_cents=50),
        ],
        [],
    )

    assert aggregate["evidence_state"] == "conflicted"
    assert aggregate["attendance"] == "unknown"
    assert aggregate["payment"] == "unknown"
    assert aggregate["amount_cents"] is None


async def test_one_sided_unknown_evidence_stays_pending() -> None:
    aggregate = _aggregate([stamp("worker", attendance="unknown")], [])

    assert aggregate["evidence_state"] == "pending"
    assert aggregate["attendance"] == "unknown"


async def test_one_sided_known_evidence_stays_pending() -> None:
    aggregate = _aggregate([stamp("hirer", attendance="no_show")], [])

    assert aggregate["evidence_state"] == "pending"
    assert aggregate["attendance"] == "no_show"


async def test_correction_resolves_conflict_without_rewriting_stamps() -> None:
    aggregate = _aggregate(
        [
            stamp("worker", attendance="attended"),
            stamp("hirer", attendance="no_show"),
        ],
        [{"changes": {"attendance": "attended"}}],
    )

    assert aggregate["evidence_state"] == "operator_resolved"
    assert aggregate["attendance"] == "attended"


async def test_participant_cannot_assert_another_person_identity() -> None:
    actor = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"participant_person_id": str(WORKER_ID), "contractor_contacts": []},
    )
    assignment = {
        "worker_id": WORKER_ID,
        "hirer_person_id": HIRER_ID,
        "organisation_id": None,
    }

    with pytest.raises(ProblemDetail) as error:
        await _resolve_assertion(
            Connection(),
            actor,
            assignment,
            type(
                "Input",
                (),
                {"asserted_by": HIRER_ID, "asserted_role": "hirer"},
            )(),
        )

    assert error.value.status_code == 403


async def test_operator_capture_requires_asserted_role_for_other_person() -> None:
    actor = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user"}},
    )
    assignment = {
        "worker_id": WORKER_ID,
        "hirer_person_id": HIRER_ID,
        "organisation_id": None,
    }
    input_value = type("Input", (), {"asserted_by": HIRER_ID, "asserted_role": None})()

    with pytest.raises(ProblemDetail) as error:
        await _resolve_assertion(Connection(), actor, assignment, input_value)

    assert error.value.code == "ASSERTED_ROLE_REQUIRED"


async def test_stamp_route_uses_canonical_workmark_resource() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_database] = StampDatabase
    application.dependency_overrides[get_labour_command_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user"}},
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/assignments/88888888-8888-4888-8888-888888888888/stamps",
            headers={"Idempotency-Key": "stamp-1"},
            json={"attendance": "attended"},
        )

    assert response.status_code == 201, response.text
    assert response.json()["resource"] == {
        "type": "workmark",
        "id": "40000000-0000-4000-8000-000000000001",
        "version": 2,
    }
    assert response.json()["evidence_state"] == "pending"
    assert response.json()["assignment_lifecycle"] is None
