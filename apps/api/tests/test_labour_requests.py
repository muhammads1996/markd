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
    AssignmentAcknowledgementInput,
    AssignmentLogisticsInput,
    AuthoriseAssignmentTravelInput,
    CancelAssignmentInput,
    ContractorConfirmationInput,
    RespondToAssignmentInput,
    _cancel_request_assignments,
    _require_assignment_actor,
    authorise_assignment_travel_mutation,
    cancel_assignment_mutation,
    confirm_assignment_mutation,
    record_assignment_acknowledgement_mutation,
    respond_to_assignment_mutation,
    set_assignment_logistics_mutation,
)
from app.api.v1.proposed_actions import (
    WorkCompletionActionInput,
    _bound_work_completion,
)
from app.api.v1.workmarks import AssignmentStampInput
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

    async def fetchall(self) -> list[dict[str, object]]:
        return [self._row] if self._row is not None else []


class FakeConnection:
    def __init__(self, proposed_action_type: str = "labour_request") -> None:
        self.proposed_action_type = proposed_action_type
        self.calls: list[tuple[str, tuple[object, ...] | None]] = []

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
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
                    "occurred_at": datetime(2026, 9, 18, tzinfo=UTC),
                    "payload": {
                        "entityIds": (
                            {
                                "organisationId": (
                                    "55555555-5555-4555-8555-555555555555"
                                ),
                                "organisationContactId": (
                                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                                ),
                                "assertedById": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                                "assertedRole": "hirer",
                            }
                            if self.proposed_action_type == "labour_request"
                            else {
                                "assignmentId": "88888888-8888-4888-8888-888888888888",
                                "assertedRole": "hirer",
                            }
                        )
                    },
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
        self.last_connection: FakeConnection | None = None

    def transaction(self, *_: object):
        proposed_action_type = self.proposed_action_type
        database = self

        class Transaction:
            async def __aenter__(self) -> FakeConnection:
                connection = FakeConnection(proposed_action_type)
                database.last_connection = connection
                return connection

            async def __aexit__(self, *_: object) -> None:
                return None

        return Transaction()


async def test_whatsapp_closeout_confirmation_cannot_reassign_source_evidence() -> None:
    bound_assignment = uuid.UUID("88888888-8888-4888-8888-888888888888")
    bound_worker = uuid.UUID("99999999-9999-4999-8999-999999999999")
    requested = WorkCompletionActionInput(
        assignment_id=bound_assignment,
        stamp=AssignmentStampInput(
            attendance="attended",
            asserted_by=uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            asserted_role="hirer",
        ),
    )

    with pytest.raises(ProblemDetail) as error:
        _bound_work_completion(
            {
                "entityIds": {
                    "assignmentId": str(bound_assignment),
                    "assertedById": str(bound_worker),
                    "assertedRole": "worker",
                }
            },
            requested,
        )

    assert error.value.code == "SOURCE_BINDING_MISMATCH"


class TravelFakeConnection:
    def __init__(self, assignment: dict[str, object]) -> None:
        self.assignment = assignment
        self.last_query = ""
        self.blocking_exception = False
        self.acknowledged = False

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        self.last_query = query
        if "from public.exception_cases" in query:
            return FakeResult({"blocked": self.blocking_exception})
        if "assignment_acknowledgements" in query:
            if self.acknowledged:
                return FakeResult()
            self.acknowledged = True
            return FakeResult({"id": uuid.uuid4()})
        if "from public.assignments" in query:
            return FakeResult(self.assignment)
        if "update public.assignments" in query:
            self.assignment["version"] = int(self.assignment["version"]) + 1
            if "lifecycle = 'cancelled'" in query:
                self.assignment["lifecycle"] = "cancelled"
                self.assignment["cancelled_after_travel_authorised"] = (
                    self.assignment.get("travel_authorised_at") is not None
                    or self.assignment.get("travel_revoked_at") is not None
                )
            elif "contractor_confirmation = %s" in query:
                assert params is not None
                self.assignment["contractor_confirmation"] = params[0]
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


class RequestCancellationConnection:
    def __init__(self, cancelled_after_travel_authorised: bool) -> None:
        self.query = ""
        self.cancelled_after_travel_authorised = cancelled_after_travel_authorised

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        self.query = query
        if "cancelled_after_travel_authorised\n                or" in query:
            self.cancelled_after_travel_authorised = (
                self.cancelled_after_travel_authorised
                or "travel_authorised_at is not null" in query
                or "travel_revoked_at is not null" in query
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


def _contractor() -> CurrentActor:
    return CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": "99999999-9999-4999-8999-999999999999",
            "contractor_contacts": [
                {"organisation_id": "55555555-5555-4555-8555-555555555555"}
            ],
        },
    )


async def test_create_labour_request_uses_the_canonical_command_boundary() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    database = FakeDatabase()
    application.dependency_overrides[get_database] = lambda: database
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
    request_insert = next(
        params
        for query, params in database.last_connection.calls
        if "insert into public.labour_requests" in query
    )
    assert request_insert[10] == "ops"


async def test_contractor_request_route_derives_pwa_source() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    database = FakeDatabase()
    application.dependency_overrides[get_database] = lambda: database
    application.dependency_overrides[get_labour_command_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "contractor_contacts": [
                {"organisation_id": "55555555-5555-4555-8555-555555555555"}
            ],
        },
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/labour-requests",
            headers={"Idempotency-Key": "contractor-request-1"},
            json={
                "contractor_organisation_id": "55555555-5555-4555-8555-555555555555",
                "work_date": "2026-09-18",
                "timezone": "Africa/Johannesburg",
                "site_area": "Woodstock, Cape Town",
                "pay": {"amount_minor": 45000, "currency": "ZAR", "basis": "daily"},
                "requirements": [{"work_type": "painter", "headcount": 2}],
            },
        )

    assert response.status_code == 201
    request_insert = next(
        params
        for query, params in database.last_connection.calls
        if "insert into public.labour_requests" in query
    )
    assert request_insert[10] == "pwa"


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
                    "contractor_contact_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
            "worker_scope": True,
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
            "worker_scope": True,
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


async def test_contractor_scope_cannot_submit_worker_response_for_same_person() -> None:
    actor = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": "99999999-9999-4999-8999-999999999999",
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


async def test_repeated_worker_response_does_not_emit_a_duplicate_event() -> None:
    assignment = _travel_assignment(worker_response="accepted")
    assignment["offered_at"] = datetime.now(UTC)

    result = await respond_to_assignment_mutation(
        TravelFakeConnection(assignment),
        CurrentActor(
            user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
            claims={
                "participant_person_id": "99999999-9999-4999-8999-999999999999",
                "worker_scope": True,
                "contractor_contacts": [],
            },
        ),
        assignment["id"],
        RespondToAssignmentInput(response="accepted"),
    )

    assert result.body["status"] == "already_applied"
    assert result.event_type is None


async def test_extracted_response_mutation_preserves_whatsapp_audit_provenance() -> (
    None
):
    connection = FakeConnection()
    actor = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": "99999999-9999-4999-8999-999999999999",
            "worker_scope": True,
            "contractor_contacts": [],
        },
    )

    result = await respond_to_assignment_mutation(
        connection,
        actor,
        uuid.UUID("88888888-8888-4888-8888-888888888888"),
        RespondToAssignmentInput(response="accepted"),
        source_channel_event_id=uuid.UUID("77777777-7777-4777-8777-777777777777"),
    )

    provenance_calls = [
        params
        for query, params in connection.calls
        if "app.source_channel_event_id" in query
    ]
    assert result.body["resource"]["version"] == 2
    assert provenance_calls == [("77777777-7777-4777-8777-777777777777",)]


async def test_assignment_confirmation_proposed_action_uses_canonical_mutation() -> (
    None
):
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    database = FakeDatabase("assignment_confirmation")
    application.dependency_overrides[get_database] = lambda: database
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
    assert database.last_connection is not None
    event_params = next(
        params
        for query, params in database.last_connection.calls
        if "insert into private.domain_events" in query
    )
    assert event_params is not None
    assert event_params[9:12] == (
        "whatsapp",
        uuid.UUID("77777777-7777-4777-8777-777777777777"),
        uuid.UUID("66666666-6666-4666-8666-666666666666"),
    )


async def test_hirer_logistics_proposed_action_uses_canonical_mutation() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    database = FakeDatabase("assignment_logistics")
    application.dependency_overrides[get_database] = lambda: database
    application.dependency_overrides[get_operator_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/proposed-actions/66666666-6666-4666-8666-666666666666/confirm",
            headers={"Idempotency-Key": "confirm-logistics-action-1"},
            json={
                "assignment_logistics": {
                    "assignment_id": "88888888-8888-4888-8888-888888888888",
                    "reporting_mode": "site",
                    "place_text": "Site gate",
                    "reporting_at": "2026-09-18T07:00:00+02:00",
                }
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["resource"]["type"] == "assignment"
    assert database.last_connection is not None
    assert any(
        "update public.assignments" in query
        for query, _ in database.last_connection.calls
    )
    event_params = next(
        params
        for query, params in database.last_connection.calls
        if "insert into private.domain_events" in query
    )
    assert event_params is not None
    assert event_params[9:12] == (
        "whatsapp",
        uuid.UUID("77777777-7777-4777-8777-777777777777"),
        uuid.UUID("66666666-6666-4666-8666-666666666666"),
    )


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

    assert result.event_type == "assignment.travel_revoked"
    assert assignment["travel_authorised_at"] is None
    assert assignment["travel_revoked_at"] is not None


@pytest.mark.parametrize("confirmation", ["pending", "rejected"])
async def test_travel_authorisation_requires_contractor_confirmation(
    confirmation: str,
) -> None:
    assignment = _travel_assignment(contractor_confirmation=confirmation)

    with pytest.raises(ProblemDetail) as error:
        await authorise_assignment_travel_mutation(
            TravelFakeConnection(assignment),
            _operator(),
            assignment["id"],
            AuthoriseAssignmentTravelInput(),
        )

    assert error.value.status_code == 409
    assert "contractor confirms" in error.value.detail.lower()


async def test_travel_authorisation_requires_no_unresolved_exception() -> None:
    assignment = _travel_assignment()
    connection = TravelFakeConnection(assignment)
    connection.blocking_exception = True

    with pytest.raises(ProblemDetail) as error:
        await authorise_assignment_travel_mutation(
            connection,
            _operator(),
            assignment["id"],
            AuthoriseAssignmentTravelInput(),
        )

    assert error.value.status_code == 409
    assert "exception" in error.value.detail.lower()


async def test_contractor_cannot_reject_currently_travel_authorised_assignment() -> (
    None
):
    assignment = _travel_assignment(travel_authorised_at=datetime.now(UTC))

    with pytest.raises(ProblemDetail) as error:
        await confirm_assignment_mutation(
            TravelFakeConnection(assignment),
            _operator(),
            assignment["id"],
            ContractorConfirmationInput(confirmed=False),
        )

    assert error.value.status_code == 409
    assert "authorisation must be revoked" in error.value.detail.lower()


async def test_contractor_confirmation_pwa_source_and_no_op() -> None:
    assignment = _travel_assignment(contractor_confirmation="pending")
    connection = TravelFakeConnection(assignment)

    applied = await confirm_assignment_mutation(
        connection,
        _contractor(),
        assignment["id"],
        ContractorConfirmationInput(confirmed=True),
    )
    no_op = await confirm_assignment_mutation(
        connection,
        _contractor(),
        assignment["id"],
        ContractorConfirmationInput(confirmed=True),
    )

    assert applied.source_channel == "pwa"
    assert no_op.body["status"] == "already_applied"
    assert no_op.event_type is None


async def test_contractor_cancellation_pwa_source_and_no_op() -> None:
    assignment = _travel_assignment()
    connection = TravelFakeConnection(assignment)

    applied = await cancel_assignment_mutation(
        connection,
        _contractor(),
        assignment["id"],
        CancelAssignmentInput(reason_code="contractor_cancelled"),
    )
    no_op = await cancel_assignment_mutation(
        connection,
        _contractor(),
        assignment["id"],
        CancelAssignmentInput(reason_code="contractor_cancelled"),
    )

    assert applied.source_channel == "pwa"
    assert no_op.body["status"] == "already_applied"
    assert no_op.event_type is None


async def test_only_assigned_worker_can_acknowledge_travel() -> None:
    assignment = _travel_assignment(travel_authorised_at=datetime.now(UTC))
    contractor = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "contractor_contacts": [
                {"organisation_id": "55555555-5555-4555-8555-555555555555"}
            ]
        },
    )

    with pytest.raises(ProblemDetail) as error:
        await record_assignment_acknowledgement_mutation(
            TravelFakeConnection(assignment),
            contractor,
            assignment["id"],
            AssignmentAcknowledgementInput(kind="on_my_way"),
        )

    assert error.value.status_code == 403


async def test_operator_cannot_acknowledge_travel_for_worker() -> None:
    assignment = _travel_assignment(travel_authorised_at=datetime.now(UTC))

    with pytest.raises(ProblemDetail) as error:
        await record_assignment_acknowledgement_mutation(
            TravelFakeConnection(assignment),
            _operator(),
            assignment["id"],
            AssignmentAcknowledgementInput(kind="on_my_way"),
        )

    assert error.value.status_code == 403


async def test_worker_acknowledgement_records_pwa_provenance() -> None:
    assignment = _travel_assignment(travel_authorised_at=datetime.now(UTC))
    worker = CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "participant_person_id": str(assignment["worker_id"]),
            "worker_scope": True,
            "contractor_contacts": [],
        },
    )

    result = await record_assignment_acknowledgement_mutation(
        TravelFakeConnection(assignment),
        worker,
        assignment["id"],
        AssignmentAcknowledgementInput(kind="on_my_way"),
    )

    assert result.event_type == "assignment.acknowledged"
    assert result.source_channel == "pwa"


async def test_request_cancellation_records_previous_travel_authorisation() -> None:
    connection = RequestCancellationConnection(
        cancelled_after_travel_authorised=True,
    )

    await _cancel_request_assignments(
        connection,
        uuid.UUID("22222222-2222-4222-8222-222222222222"),
        "job_cancelled",
    )

    assert "cancelled_after_travel_authorised" in connection.query
    assert "cancelled_after_travel_authorised\n                or" in connection.query
    assert "travel_authorised_at is not null" in connection.query
    assert "travel_revoked_at is not null" in connection.query
    assert connection.cancelled_after_travel_authorised is True


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
