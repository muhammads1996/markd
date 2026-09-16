import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import (
    get_database,
    get_labour_command_actor,
    get_operator_actor,
)
from app.api.v1.labour_requests import (
    AssignmentLogisticsInput,
    AuthoriseAssignmentTravelInput,
    CancelAssignmentInput,
    _require_assignment_actor,
    authorise_assignment_travel_mutation,
    cancel_assignment_mutation,
    set_assignment_logistics_mutation,
)
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.core.problems import ProblemDetail
from app.main import create_app

pytestmark = pytest.mark.asyncio


class FakeResult:
    def __init__(self, row: dict[str, object] | None = None) -> None:
        self._row = row

    async def fetchone(self) -> dict[str, object] | None:
        return self._row


class FakeConnection:
    def __init__(self, proposed_action_type: str = "labour_request") -> None:
        self.proposed_action_type = proposed_action_type

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
                    "action_type": self.proposed_action_type,
                    "state": "pending",
                    "channel_event_id": uuid.UUID(
                        "77777777-7777-4777-8777-777777777777"
                    ),
                }
            )
        if "from public.assignments" in query:
            return FakeResult(
                {
                    "id": uuid.UUID("88888888-8888-4888-8888-888888888888"),
                    "labour_request_id": uuid.UUID(
                        "22222222-2222-4222-8222-222222222222"
                    ),
                    "worker_id": uuid.UUID("99999999-9999-4999-8999-999999999999"),
                    "organisation_id": uuid.UUID(
                        "55555555-5555-4555-8555-555555555555"
                    ),
                    "lifecycle": "active",
                    "worker_response": "pending",
                    "contractor_confirmation": "pending",
                    "offered_at": datetime(2026, 9, 16, tzinfo=UTC),
                    "travel_authorised_at": None,
                    "version": 1,
                }
            )
        if "update public.assignments" in query:
            return FakeResult(
                {
                    "id": uuid.UUID("88888888-8888-4888-8888-888888888888"),
                    "version": 2,
                }
            )
        if "insert into private.domain_events" in query:
            return FakeResult({"id": uuid.UUID("33333333-3333-4333-8333-333333333333")})
        return FakeResult()


class FakeDatabase:
    def __init__(self, proposed_action_type: str = "labour_request") -> None:
        self.proposed_action_type = proposed_action_type

    def transaction(self, *_: object):
        proposed_action_type = self.proposed_action_type

        class Transaction:
            async def __aenter__(self) -> FakeConnection:
                return FakeConnection(proposed_action_type)

            async def __aexit__(self, *_: object) -> None:
                return None

        return Transaction()


class TravelFakeConnection:
    def __init__(self, assignment: dict[str, object]) -> None:
        self.assignment = assignment
        self.last_query = ""

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        self.last_query = query
        if "from public.assignments" in query:
            return FakeResult(self.assignment)
        if "update public.assignments" in query:
            self.assignment["version"] = int(self.assignment["version"]) + 1
            if "lifecycle = 'cancelled'" in query:
                self.assignment["cancelled_after_travel_authorised"] = (
                    self.assignment.get("travel_authorised_at") is not None
                    or self.assignment.get("travel_revoked_at") is not None
                )
            elif "reporting_mode = %s" in query:
                if self.assignment.get("travel_authorised_at") is not None:
                    self.assignment["travel_authorised_at"] = None
                    self.assignment["travel_revoked_at"] = datetime.now(UTC)
            else:
                self.assignment["travel_authorised_at"] = datetime.now(UTC)
                self.assignment["travel_revoked_at"] = None
            return FakeResult(
                {
                    "id": self.assignment["id"],
                    "version": self.assignment["version"],
                }
            )
        return FakeResult()


def _travel_assignment(**overrides: object) -> dict[str, object]:
    assignment: dict[str, object] = {
        "id": uuid.UUID("88888888-8888-4888-8888-888888888888"),
        "worker_id": uuid.UUID("99999999-9999-4999-8999-999999999999"),
        "organisation_id": uuid.UUID("55555555-5555-4555-8555-555555555555"),
        "lifecycle": "active",
        "worker_response": "accepted",
        "contractor_confirmation": "confirmed",
        "travel_authorised_at": None,
        "travel_revoked_at": None,
        "reporting_mode": "site",
        "reporting_place_text": "Main gate",
        "reporting_at": datetime(2026, 9, 18, 5, 0, tzinfo=UTC),
        "pickup_point_id": None,
        "location_pin": None,
        "landmark": None,
        "instructions": None,
        "contact": None,
        "version": 1,
    }
    assignment.update(overrides)
    return assignment


def _operator() -> CurrentActor:
    return CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )


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


async def test_contractor_cannot_submit_worker_response() -> None:
    actor = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "contractor_contacts": [
                {"organisation_id": "55555555-5555-4555-8555-555555555555"}
            ],
        },
    )

    with pytest.raises(ProblemDetail) as error:
        _require_assignment_actor(
            actor,
            {
                "organisation_id": uuid.UUID("55555555-5555-4555-8555-555555555555"),
                "worker_id": uuid.UUID("99999999-9999-4999-8999-999999999999"),
            },
            allow_worker=True,
            worker_only=True,
        )

    assert error.value.status_code == 403


@pytest.mark.parametrize("response", ["accepted", "declined", "call_me"])
async def test_worker_response_uses_the_canonical_assignment_command(
    response: str,
) -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_database] = FakeDatabase
    application.dependency_overrides[get_labour_command_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": "99999999-9999-4999-8999-999999999999",
            "contractor_contacts": [],
        },
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        result = await client.post(
            "/api/v1/assignments/88888888-8888-4888-8888-888888888888/respond",
            headers={"Idempotency-Key": f"worker-response-{response}"},
            json={"response": response},
        )

    assert result.status_code == 200, result.text
    assert result.json()["resource"] == {
        "type": "assignment",
        "id": "88888888-8888-4888-8888-888888888888",
        "version": 2,
    }


async def test_assignment_confirmation_proposed_action_uses_canonical_mutation() -> (
    None
):
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_database] = lambda: FakeDatabase(
        "assignment_confirmation"
    )
    application.dependency_overrides[get_operator_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/proposed-actions/66666666-6666-4666-8666-666666666666/confirm",
            headers={"Idempotency-Key": "confirm-assignment-action-1"},
            json={
                "assignment_confirmation": {
                    "assignment_id": "88888888-8888-4888-8888-888888888888",
                    "confirmed": True,
                }
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["resource"] == {
        "type": "assignment",
        "id": "88888888-8888-4888-8888-888888888888",
        "version": 2,
    }


async def test_travel_authorisation_requires_complete_logistics() -> None:
    assignment = _travel_assignment(reporting_mode=None, reporting_place_text=None)
    connection = TravelFakeConnection(assignment)

    with pytest.raises(ProblemDetail) as error:
        await authorise_assignment_travel_mutation(
            connection,
            _operator(),
            assignment["id"],
            AuthoriseAssignmentTravelInput(),
        )

    assert error.value.status_code == 409
    assert "logistics" in error.value.detail.lower()


@pytest.mark.parametrize("response", ["pending", "declined", "call_me"])
async def test_travel_authorisation_requires_worker_acceptance(response: str) -> None:
    assignment = _travel_assignment(worker_response=response)

    with pytest.raises(ProblemDetail) as error:
        await authorise_assignment_travel_mutation(
            TravelFakeConnection(assignment),
            _operator(),
            assignment["id"],
            AuthoriseAssignmentTravelInput(),
        )

    assert error.value.status_code == 409
    assert "worker accepts" in error.value.detail.lower()


async def test_authorisation_is_idempotent_and_does_not_repeat_event() -> None:
    assignment = _travel_assignment()
    connection = TravelFakeConnection(assignment)
    first = await authorise_assignment_travel_mutation(
        connection, _operator(), assignment["id"], AuthoriseAssignmentTravelInput()
    )
    second = await authorise_assignment_travel_mutation(
        connection, _operator(), assignment["id"], AuthoriseAssignmentTravelInput()
    )

    assert first.event_type == "assignment.travel_authorised"
    assert first.body["effects"]["outbound_messages_queued"] == 1
    assert second.body["status"] == "already_applied"
    assert second.event_type is None


async def test_material_logistics_change_revokes_current_travel_authorisation() -> None:
    assignment = _travel_assignment(travel_authorised_at=datetime.now(UTC))
    connection = TravelFakeConnection(assignment)
    input = AssignmentLogisticsInput(
        reporting_mode="pickup",
        place_text="Library car park",
        reporting_at=datetime(2026, 9, 18, 5, 0, tzinfo=UTC),
    )

    result = await set_assignment_logistics_mutation(
        connection, _operator(), assignment["id"], input
    )

    assert result.event_type == "assignment.logistics_updated"
    assert assignment["travel_authorised_at"] is None
    assert assignment["travel_revoked_at"] is not None


async def test_cancellation_preserves_before_and_after_travel_distinction() -> None:
    before = _travel_assignment(cancelled_after_travel_authorised=False)
    before_connection = TravelFakeConnection(before)
    await cancel_assignment_mutation(
        before_connection,
        _operator(),
        before["id"],
        CancelAssignmentInput(reason_code="operator_cancelled"),
    )

    after = _travel_assignment(travel_revoked_at=datetime.now(UTC))
    after_connection = TravelFakeConnection(after)
    await cancel_assignment_mutation(
        after_connection,
        _operator(),
        after["id"],
        CancelAssignmentInput(reason_code="operator_cancelled"),
    )

    assert before["cancelled_after_travel_authorised"] is False
    assert after["cancelled_after_travel_authorised"] is True


async def test_travel_command_paths_are_published() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    paths = application.openapi()["paths"]

    assert "/api/v1/assignments/{assignment_id}/logistics" in paths
    assert "/api/v1/assignments/{assignment_id}/authorise-travel" in paths
    assert "/api/v1/assignments/{assignment_id}/acknowledgements" in paths
