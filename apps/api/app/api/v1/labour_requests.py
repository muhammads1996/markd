from datetime import UTC, date, datetime, time
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.dependencies import (
    get_correlation_id,
    get_database,
    get_labour_command_actor,
)
from app.application.dispatcher import MutationResult, execute_command
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail
from app.integrations.database import Database

router = APIRouter(prefix="/labour-requests", tags=["Labour requests"])
assignment_router = APIRouter(prefix="/assignments", tags=["Assignments"])


class PayInput(BaseModel):
    amount_minor: int = Field(ge=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    basis: Literal["daily", "hourly", "fixed", "other"]
    terms_text: str | None = None


class RequirementInput(BaseModel):
    work_type: str = Field(min_length=1, max_length=120)
    headcount: int = Field(gt=0)
    notes: str | None = None


class CreateLabourRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractor_organisation_id: UUID | None = None
    contractor_contact_id: UUID | None = None
    individual_hirer_person_id: UUID | None = None
    work_date: date
    start_time: time | None = None
    timezone: str = Field(min_length=1, max_length=64)
    site_area: str = Field(min_length=1, max_length=255)
    site_text: str | None = None
    pay: PayInput
    notes: str | None = None
    requirements: list[RequirementInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_requester(self) -> "CreateLabourRequestInput":
        if (self.contractor_organisation_id is None) == (
            self.individual_hirer_person_id is None
        ):
            raise ValueError("Exactly one requester identifier is required.")
        if self.contractor_contact_id and self.contractor_organisation_id is None:
            raise ValueError(
                "contractor_contact_id requires contractor_organisation_id"
            )
        return self


class UpdateLabourRequestInput(BaseModel):
    work_date: date | None = None
    start_time: time | None = None
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    site_area: str | None = Field(default=None, min_length=1, max_length=255)
    site_text: str | None = None
    pay: PayInput | None = None
    notes: str | None = None
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_change(self) -> "UpdateLabourRequestInput":
        if not any(
            value is not None
            for name, value in self.__dict__.items()
            if name != "expected_version"
        ):
            raise ValueError("At least one Labour Request field must be updated")
        return self


class CancelLabourRequestInput(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class CreateAssignmentsInput(BaseModel):
    requirement_id: UUID
    worker_ids: list[UUID] = Field(min_length=1)
    expected_version: int | None = Field(default=None, ge=1)


class OfferAssignmentInput(BaseModel):
    expected_version: int | None = Field(default=None, ge=1)


class RespondToAssignmentInput(BaseModel):
    response: Literal["accepted", "declined", "call_me"]
    expected_version: int | None = Field(default=None, ge=1)


class ContractorConfirmationInput(BaseModel):
    confirmed: bool
    expected_version: int | None = Field(default=None, ge=1)


class CancelAssignmentInput(BaseModel):
    reason_code: Literal[
        "worker_withdrew",
        "contractor_cancelled",
        "job_cancelled",
        "operator_cancelled",
        "other",
    ]
    reason_text: str | None = Field(default=None, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class LocationPinInput(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class AssignmentContactInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=1, max_length=32)


class AssignmentLogisticsInput(BaseModel):
    reporting_mode: Literal["site", "pickup"]
    place_text: str = Field(min_length=1, max_length=500)
    reporting_at: datetime
    pickup_point_id: UUID | None = None
    location_pin: LocationPinInput | None = None
    landmark: str | None = Field(default=None, max_length=500)
    instructions: str | None = Field(default=None, max_length=1000)
    contact: AssignmentContactInput | None = None
    expected_version: int | None = Field(default=None, ge=1)


class AuthoriseAssignmentTravelInput(BaseModel):
    expected_version: int | None = Field(default=None, ge=1)


class AssignmentAcknowledgementInput(BaseModel):
    kind: Literal["on_my_way"]


def _headers(command_id: UUID, replayed: bool) -> dict[str, str]:
    return {
        "X-Command-Id": str(command_id),
        "X-Idempotent-Replay": str(replayed).lower(),
    }


def _command_body(
    resource_type: str,
    resource_id: UUID,
    version: int = 1,
    status_value: Literal["applied", "already_applied"] = "applied",
    outbound_messages_queued: int = 0,
) -> dict[str, Any]:
    return {
        "status": status_value,
        "resource": {
            "type": resource_type,
            "id": str(resource_id),
            "version": version,
        },
        "occurred_at": datetime.now(UTC).isoformat(),
        "effects": {"outbound_messages_queued": outbound_messages_queued},
    }


def _is_operator(actor: CurrentActor) -> bool:
    return actor.claims.get("operator") is not None


def _source_for_actor(actor: CurrentActor) -> Literal["ops", "pwa"]:
    return "ops" if _is_operator(actor) else "pwa"


def _contractor_organisations(actor: CurrentActor) -> set[UUID]:
    contacts = actor.claims.get("contractor_contacts", [])
    return {
        UUID(str(contact["organisation_id"]))
        for contact in contacts
        if contact.get("organisation_id") is not None
    }


def _require_request_actor(
    actor: CurrentActor,
    organisation_id: UUID | None,
    individual_hirer_person_id: UUID | None,
) -> None:
    if _is_operator(actor):
        return
    if organisation_id is not None and organisation_id in _contractor_organisations(
        actor
    ):
        return
    if individual_hirer_person_id is not None and str(
        actor.claims.get("participant_person_id")
    ) == str(individual_hirer_person_id):
        return
    raise ProblemDetail(
        403, "FORBIDDEN", "Forbidden", "Actor cannot manage this request."
    )


def _require_assignment_actor(
    actor: CurrentActor,
    assignment: dict[str, Any],
    allow_worker: bool = False,
    worker_only: bool = False,
) -> None:
    participant_person_id = actor.claims.get("participant_person_id")
    is_worker = (
        allow_worker
        and actor.claims.get("worker_scope") is True
        and participant_person_id is not None
        and str(participant_person_id) == str(assignment.get("worker_id"))
    )
    if worker_only:
        if is_worker:
            return
        raise ProblemDetail(
            403, "FORBIDDEN", "Forbidden", "Only the assigned worker can respond."
        )
    if _is_operator(actor):
        return
    organisation_id = assignment.get("organisation_id")
    if organisation_id and UUID(str(organisation_id)) in _contractor_organisations(
        actor
    ):
        return
    if is_worker:
        return
    raise ProblemDetail(
        403, "FORBIDDEN", "Forbidden", "Actor cannot manage this assignment."
    )


def _check_version(record: dict[str, Any], expected_version: int | None) -> None:
    if expected_version is not None and record["version"] != expected_version:
        raise ProblemDetail(
            409,
            "STALE_VERSION",
            "Stale version",
            "The record changed before this command was applied.",
        )


async def _get_request(connection: Any, labour_request_id: UUID) -> dict[str, Any]:
    result = await connection.execute(
        """
        select id, organisation_id, requester_person_id, lifecycle, version
        from public.labour_requests where id = %s for update
        """,
        (labour_request_id,),
    )
    request = await result.fetchone()
    if request is None:
        raise ProblemDetail(
            404, "NOT_FOUND", "Not found", "Labour Request was not found."
        )
    return dict(request)


async def _get_assignment(connection: Any, assignment_id: UUID) -> dict[str, Any]:
    result = await connection.execute(
        """
         select id, labour_request_id, worker_id, organisation_id, hirer_person_id,
             site_id, starts_on, ends_on, lifecycle, worker_response,
             contractor_confirmation, travel_authorised_at,
             travel_revoked_at, offered_at, reporting_mode,
             reporting_place_text, reporting_at, pickup_point_id, location_pin,
             landmark, instructions, contact, version
        from public.assignments where id = %s for update
        """,
        (assignment_id,),
    )
    assignment = await result.fetchone()
    if assignment is None:
        raise ProblemDetail(404, "NOT_FOUND", "Not found", "Assignment was not found.")
    return dict(assignment)


async def _has_blocking_exception(connection: Any, assignment_id: UUID) -> bool:
    result = await connection.execute(
        """
        select exists(
          select 1 from public.exception_cases
          where assignment_id = %s
            and state in ('open', 'investigating')
            and archived_at is null
        ) as blocked
        """,
        (assignment_id,),
    )
    exception = await result.fetchone()
    return bool(exception and exception["blocked"])


async def _cancel_request_assignments(
    connection: Any, labour_request_id: UUID, reason: str
) -> list[UUID]:
    result = await connection.execute(
        """
        update public.assignments
        set lifecycle = 'cancelled', cancelled_at = timezone('utc', now()),
            cancellation_reason = %s,
            cancelled_after_travel_authorised =
                cancelled_after_travel_authorised
                or travel_authorised_at is not null
                or travel_revoked_at is not null,
            version = version + 1
        where labour_request_id = %s and lifecycle = 'active'
        returning id
        """,
        (reason, labour_request_id),
    )
    return [UUID(str(row["id"])) for row in await result.fetchall()]


async def create_labour_request_mutation(
    connection: Any,
    actor: CurrentActor,
    input: CreateLabourRequestInput,
    source: str,
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
) -> MutationResult:
    _require_request_actor(
        actor, input.contractor_organisation_id, input.individual_hirer_person_id
    )
    result = await connection.execute(
        """
        insert into public.labour_requests (
          organisation_id, requester_person_id, requested_by_contact_id,
          needed_from, needed_to, needed_at, headcount, rate_cents, currency,
          terms, source, source_channel_event_id, source_proposed_action_id,
          notes, site_area, site_text, timezone, rate_basis, lifecycle, version
        ) values (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, 'active', 1
        ) returning id, version
        """,
        (
            input.contractor_organisation_id,
            input.individual_hirer_person_id,
            input.contractor_contact_id,
            input.work_date,
            input.work_date,
            input.start_time,
            sum(requirement.headcount for requirement in input.requirements),
            input.pay.amount_minor,
            input.pay.currency,
            input.pay.terms_text,
            source,
            source_channel_event_id,
            source_proposed_action_id,
            input.notes,
            input.site_area,
            input.site_text,
            input.timezone,
            input.pay.basis,
        ),
    )
    row = await result.fetchone()
    labour_request_id = row["id"]
    for requirement in input.requirements:
        await connection.execute(
            """
            insert into public.labour_requirements (
              labour_request_id, work_type, headcount, notes
            ) values (%s, %s, %s, %s)
            """,
            (
                labour_request_id,
                requirement.work_type,
                requirement.headcount,
                requirement.notes,
            ),
        )
    body = _command_body(
        "labour_request", labour_request_id, int(row.get("version", 1))
    )
    return MutationResult(
        201,
        body,
        "labour_request.created",
        "labour_request",
        labour_request_id,
        jsonable_encoder(body),
        source,
        source_channel_event_id,
        source_proposed_action_id,
    )


async def create_assignments_mutation(
    connection: Any,
    actor: CurrentActor,
    labour_request_id: UUID,
    input: CreateAssignmentsInput,
    source: str = "api",
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
) -> MutationResult:
    request = await _get_request(connection, labour_request_id)
    _require_request_actor(
        actor, request["organisation_id"], request["requester_person_id"]
    )
    _check_version(request, input.expected_version)
    if request["lifecycle"] != "active":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Only active requests can receive assignments.",
        )
    requirement_result = await connection.execute(
        """
        select id from public.labour_requirements
        where id = %s and labour_request_id = %s and archived_at is null
        """,
        (input.requirement_id, labour_request_id),
    )
    if await requirement_result.fetchone() is None:
        raise ProblemDetail(404, "NOT_FOUND", "Not found", "Requirement was not found.")
    assignment_ids: list[str] = []
    for worker_id in dict.fromkeys(input.worker_ids):
        result = await connection.execute(
            """
            insert into public.assignments (
              labour_request_id, labour_requirement_id, worker_id, organisation_id,
              hirer_person_id, site_id, starts_on, ends_on, lifecycle,
              worker_response, contractor_confirmation, source,
              source_channel_event_id, source_proposed_action_id, version
            ) select %s, %s, %s, organisation_id, requester_person_id, site_id,
                     needed_from, needed_to, 'active', 'pending', 'pending', %s,
                     %s, %s, 1
              from public.labour_requests where id = %s
            on conflict (labour_request_id, labour_requirement_id, worker_id)
              where lifecycle = 'active'
            do update set worker_id = excluded.worker_id
            returning id, version
            """,
            (
                labour_request_id,
                input.requirement_id,
                worker_id,
                source,
                source_channel_event_id,
                source_proposed_action_id,
                labour_request_id,
            ),
        )
        assignment = await result.fetchone()
        assignment_ids.append(str(assignment["id"]))
    body = _command_body("labour_request", labour_request_id, request["version"])
    body["assignments"] = assignment_ids
    return MutationResult(
        201, body, "assignment.created", "labour_request", labour_request_id, body
    )


async def confirm_assignment_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: ContractorConfirmationInput,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_actor(actor, assignment)
    _check_version(assignment, input.expected_version)
    if assignment["lifecycle"] != "active":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Only active assignments can be confirmed.",
        )
    confirmation = "confirmed" if input.confirmed else "rejected"
    if not input.confirmed and assignment.get("travel_authorised_at") is not None:
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Travel authorisation must be revoked before rejecting an assignment.",
        )
    if assignment["contractor_confirmation"] == confirmation:
        body = _command_body(
            "assignment", assignment_id, assignment["version"], "already_applied"
        )
        return MutationResult(
            200,
            body,
            None,
            "assignment",
            assignment_id,
            body,
        )
    result = await connection.execute(
        """
        update public.assignments
        set contractor_confirmation = %s,
            contractor_confirmed_at = timezone('utc', now()), version = version + 1
        where id = %s returning id, version
        """,
        (confirmation, assignment_id),
    )
    confirmed = await result.fetchone()
    body = _command_body("assignment", confirmed["id"], confirmed["version"])
    return MutationResult(
        200,
        body,
        "assignment.contractor_confirmed",
        "assignment",
        confirmed["id"],
        body,
        source_channel=_source_for_actor(actor),
    )


def _logistics_changed(
    assignment: dict[str, Any], input: AssignmentLogisticsInput
) -> bool:
    return any(
        (
            assignment.get("reporting_mode") != input.reporting_mode,
            assignment.get("reporting_place_text") != input.place_text,
            assignment.get("reporting_at") != input.reporting_at,
            assignment.get("pickup_point_id") != input.pickup_point_id,
            assignment.get("location_pin")
            != (
                input.location_pin.model_dump(mode="json")
                if input.location_pin
                else None
            ),
            assignment.get("landmark") != input.landmark,
            assignment.get("instructions") != input.instructions,
            assignment.get("contact")
            != (input.contact.model_dump() if input.contact else None),
        )
    )


async def set_assignment_logistics_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: AssignmentLogisticsInput,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_actor(actor, assignment)
    _check_version(assignment, input.expected_version)
    if assignment["lifecycle"] != "active":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Only active assignments can receive logistics.",
        )
    changed = _logistics_changed(assignment, input)
    if not changed:
        body = _command_body(
            "assignment", assignment_id, assignment["version"], "already_applied"
        )
        return MutationResult(200, body, None, "assignment", assignment_id, body)
    was_authorised = assignment.get("travel_authorised_at") is not None
    result = await connection.execute(
        """
        update public.assignments
        set reporting_mode = %s,
            reporting_place_text = %s,
            reporting_at = %s,
            pickup_point_id = %s,
            location_pin = %s,
            landmark = %s,
            instructions = %s,
            contact = %s,
            travel_authorised_at = case
              when %s and travel_authorised_at is not null then null
              else travel_authorised_at
            end,
            travel_revoked_at = case
              when %s and travel_authorised_at is not null
                then timezone('utc', now())
              else travel_revoked_at
            end,
            version = version + 1
        where id = %s
        returning id, version
        """,
        (
            input.reporting_mode,
            input.place_text,
            input.reporting_at,
            input.pickup_point_id,
            (Jsonb(input.location_pin.model_dump()) if input.location_pin else None),
            input.landmark,
            input.instructions,
            Jsonb(input.contact.model_dump()) if input.contact else None,
            was_authorised,
            was_authorised,
            assignment_id,
        ),
    )
    updated = await result.fetchone()
    body = _command_body("assignment", updated["id"], updated["version"])
    return MutationResult(
        200,
        body,
        (
            "assignment.travel_revoked"
            if was_authorised
            else "assignment.logistics_updated"
        ),
        "assignment",
        updated["id"],
        body,
        source_channel=_source_for_actor(actor),
    )


async def authorise_assignment_travel_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: AuthoriseAssignmentTravelInput,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_actor(actor, assignment)
    _check_version(assignment, input.expected_version)
    if assignment.get("travel_authorised_at") is not None:
        body = _command_body(
            "assignment", assignment_id, assignment["version"], "already_applied"
        )
        return MutationResult(200, body, None, "assignment", assignment_id, body)
    if assignment["lifecycle"] != "active":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Travel cannot be authorised for an inactive assignment.",
        )
    if assignment["worker_response"] != "accepted":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Travel cannot be authorised until the worker accepts.",
        )
    if assignment["contractor_confirmation"] != "confirmed":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Travel cannot be authorised until the contractor confirms.",
        )
    if await _has_blocking_exception(connection, assignment_id):
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Travel cannot be authorised while an exception is unresolved.",
        )
    if not (
        assignment.get("reporting_mode")
        and assignment.get("reporting_place_text")
        and str(assignment["reporting_place_text"]).strip()
        and assignment.get("reporting_at")
    ):
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Travel cannot be authorised until reporting logistics are complete.",
        )
    result = await connection.execute(
        """
        update public.assignments
        set travel_authorised_at = timezone('utc', now()),
            travel_revoked_at = null,
            version = version + 1
        where id = %s returning id, version
        """,
        (assignment_id,),
    )
    authorised = await result.fetchone()
    body = _command_body(
        "assignment", authorised["id"], authorised["version"], "applied", 1
    )
    return MutationResult(
        200,
        body,
        "assignment.travel_authorised",
        "assignment",
        authorised["id"],
        body,
        source_channel=_source_for_actor(actor),
    )


async def record_assignment_acknowledgement_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: AssignmentAcknowledgementInput,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_actor(actor, assignment, allow_worker=True, worker_only=True)
    if (
        assignment["lifecycle"] != "active"
        or assignment.get("travel_authorised_at") is None
    ):
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "An acknowledgement requires current travel authorisation.",
        )
    result = await connection.execute(
        """
                insert into public.assignment_acknowledgements
                    (assignment_id, kind, actor_user_id)
        values (%s, %s, %s)
        on conflict (assignment_id, kind) do nothing
        returning id
        """,
        (assignment_id, input.kind, actor.user_id),
    )
    acknowledged = await result.fetchone()
    body = _command_body(
        "assignment",
        assignment_id,
        assignment["version"],
        "applied" if acknowledged else "already_applied",
    )
    return MutationResult(
        200,
        body,
        "assignment.acknowledged" if acknowledged else None,
        "assignment",
        assignment_id,
        body,
        source_channel=_source_for_actor(actor),
    )


async def cancel_assignment_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: CancelAssignmentInput,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_actor(actor, assignment, allow_worker=True)
    _check_version(assignment, input.expected_version)
    if assignment["lifecycle"] == "cancelled":
        body = _command_body(
            "assignment", assignment_id, assignment["version"], "already_applied"
        )
        return MutationResult(200, body, None, "assignment", assignment_id, body)
    if assignment["lifecycle"] != "active":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Assignment cannot be cancelled.",
        )
    result = await connection.execute(
        """
        update public.assignments
        set lifecycle = 'cancelled', cancelled_at = timezone('utc', now()),
            cancellation_reason = %s, cancellation_note = %s,
                        cancelled_after_travel_authorised =
                            travel_authorised_at is not null
                            or travel_revoked_at is not null,
            version = version + 1
        where id = %s returning id, version
        """,
        (input.reason_code, input.reason_text, assignment_id),
    )
    cancelled = await result.fetchone()
    body = _command_body("assignment", cancelled["id"], cancelled["version"])
    return MutationResult(
        200,
        body,
        "assignment.cancelled",
        "assignment",
        cancelled["id"],
        body,
        source_channel=_source_for_actor(actor),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_labour_request(
    input: CreateLabourRequestInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    payload = input.model_dump(mode="json")
    source = _source_for_actor(actor)

    async def handler(connection: Any) -> MutationResult:
        return await create_labour_request_mutation(connection, actor, input, source)

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "CreateLabourRequest",
        idempotency_key,
        payload,
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.patch("/{labour_request_id}")
async def update_labour_request(
    labour_request_id: UUID,
    input: UpdateLabourRequestInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    payload = input.model_dump(mode="json", exclude_none=True)

    async def handler(connection: Any) -> MutationResult:
        request = await _get_request(connection, labour_request_id)
        _require_request_actor(
            actor, request["organisation_id"], request["requester_person_id"]
        )
        _check_version(request, input.expected_version)
        if request["lifecycle"] != "active":
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "Only active requests may be changed.",
            )
        fields: list[str] = []
        values: list[Any] = []
        if input.work_date is not None:
            fields.extend(["needed_from = %s", "needed_to = %s"])
            values.extend([input.work_date, input.work_date])
        for column, value in (
            ("needed_at", input.start_time),
            ("timezone", input.timezone),
            ("site_area", input.site_area),
            ("site_text", input.site_text),
            ("notes", input.notes),
        ):
            if value is not None:
                fields.append(f"{column} = %s")
                values.append(value)
        if input.pay is not None:
            fields.extend(
                ["rate_cents = %s", "currency = %s", "rate_basis = %s", "terms = %s"]
            )
            values.extend(
                [
                    input.pay.amount_minor,
                    input.pay.currency,
                    input.pay.basis,
                    input.pay.terms_text,
                ]
            )
        fields.append("version = version + 1")
        values.append(labour_request_id)
        result = await connection.execute(
            f"update public.labour_requests set {', '.join(fields)} "
            "where id = %s returning id, version",
            tuple(values),
        )
        updated = await result.fetchone()
        body = _command_body("labour_request", updated["id"], updated["version"])
        return MutationResult(
            200, body, "labour_request.updated", "labour_request", updated["id"], body
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "UpdateLabourRequest",
        idempotency_key,
        {"labour_request_id": str(labour_request_id), **payload},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/{labour_request_id}/cancel")
async def cancel_labour_request(
    labour_request_id: UUID,
    input: CancelLabourRequestInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    payload = input.model_dump(mode="json")

    async def handler(connection: Any) -> MutationResult:
        request = await _get_request(connection, labour_request_id)
        _require_request_actor(
            actor, request["organisation_id"], request["requester_person_id"]
        )
        _check_version(request, input.expected_version)
        if request["lifecycle"] == "cancelled":
            body = _command_body(
                "labour_request",
                labour_request_id,
                request["version"],
                "already_applied",
            )
            return MutationResult(
                200,
                body,
                "labour_request.cancelled",
                "labour_request",
                labour_request_id,
                body,
            )
        if request["lifecycle"] != "active":
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "Request cannot be cancelled.",
            )
        cancelled_assignment_ids = await _cancel_request_assignments(
            connection, labour_request_id, input.reason
        )
        result = await connection.execute(
            """
            update public.labour_requests
            set lifecycle = 'cancelled', cancelled_at = timezone('utc', now()),
                cancellation_reason = %s, version = version + 1
            where id = %s returning id, version
            """,
            (input.reason, labour_request_id),
        )
        cancelled = await result.fetchone()
        body = _command_body("labour_request", cancelled["id"], cancelled["version"])
        event_payload = {
            **body,
            "cancelled_assignment_ids": [
                str(assignment_id) for assignment_id in cancelled_assignment_ids
            ],
        }
        return MutationResult(
            200,
            body,
            "labour_request.cancelled",
            "labour_request",
            cancelled["id"],
            event_payload,
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "CancelLabourRequest",
        idempotency_key,
        {"labour_request_id": str(labour_request_id), **payload},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/{labour_request_id}/assignments", status_code=status.HTTP_201_CREATED)
async def create_assignments(
    labour_request_id: UUID,
    input: CreateAssignmentsInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    payload = input.model_dump(mode="json")

    async def handler(connection: Any) -> MutationResult:
        return await create_assignments_mutation(
            connection, actor, labour_request_id, input
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "CreateAssignments",
        idempotency_key,
        {"labour_request_id": str(labour_request_id), **payload},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@assignment_router.post("/{assignment_id}/offer")
async def offer_assignment(
    assignment_id: UUID,
    input: OfferAssignmentInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        assignment = await _get_assignment(connection, assignment_id)
        _require_assignment_actor(actor, assignment)
        _check_version(assignment, input.expected_version)
        if assignment["lifecycle"] != "active":
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "Only active assignments can be offered.",
            )
        result = await connection.execute(
            """
            update public.assignments
            set offered_at = coalesce(offered_at, timezone('utc', now())),
                version = version + 1
            where id = %s returning id, version, offered_at
            """,
            (assignment_id,),
        )
        offered = await result.fetchone()
        replayed = assignment.get("offered_at") is not None
        body = _command_body(
            "assignment",
            offered["id"],
            offered["version"],
            "already_applied" if replayed else "applied",
            0 if replayed else 1,
        )
        return MutationResult(
            200, body, "assignment.offered", "assignment", offered["id"], body
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "OfferAssignment",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


async def respond_to_assignment_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: RespondToAssignmentInput,
    *,
    source_channel: str = "pwa",
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
) -> MutationResult:
    if source_channel_event_id is not None:
        await connection.execute(
            "select set_config('app.source_channel_event_id', %s, true)",
            (str(source_channel_event_id),),
        )
    if source_proposed_action_id is not None:
        await connection.execute(
            "select set_config('app.source_proposed_action_id', %s, true)",
            (str(source_proposed_action_id),),
        )
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_actor(actor, assignment, allow_worker=True, worker_only=True)
    _check_version(assignment, input.expected_version)
    if assignment["lifecycle"] != "active" or assignment.get("offered_at") is None:
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Only offered active assignments can receive a response.",
        )
    previous = assignment["worker_response"]
    if previous == input.response:
        body = _command_body(
            "assignment", assignment_id, assignment["version"], "already_applied"
        )
        return MutationResult(
            200,
            body,
            None,
            "assignment",
            assignment_id,
            body,
        )
    if previous in {"accepted", "declined"}:
        raise ProblemDetail(
            409,
            "CONFLICTING_RESPONSE",
            "Conflicting response",
            "A terminal response cannot be overwritten.",
        )
    result = await connection.execute(
        """
        update public.assignments
        set worker_response = %s, worker_responded_at = timezone('utc', now()),
            version = version + 1
        where id = %s returning id, version
        """,
        (input.response, assignment_id),
    )
    responded = await result.fetchone()
    body = _command_body("assignment", responded["id"], responded["version"])
    return MutationResult(
        200,
        body,
        "assignment.worker_responded",
        "assignment",
        responded["id"],
        body,
        source_channel,
        source_channel_event_id,
        source_proposed_action_id,
    )


@assignment_router.post("/{assignment_id}/respond")
async def respond_to_assignment(
    assignment_id: UUID,
    input: RespondToAssignmentInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    source = _source_for_actor(actor)

    async def handler(connection: Any) -> MutationResult:
        return await respond_to_assignment_mutation(
            connection, actor, assignment_id, input, source_channel=source
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "RespondToAssignment",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@assignment_router.post("/{assignment_id}/contractor-confirm")
async def confirm_assignment_by_contractor(
    assignment_id: UUID,
    input: ContractorConfirmationInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        return await confirm_assignment_mutation(
            connection, actor, assignment_id, input
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "ConfirmAssignmentByContractor",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@assignment_router.put("/{assignment_id}/logistics")
async def set_assignment_logistics(
    assignment_id: UUID,
    input: AssignmentLogisticsInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        return await set_assignment_logistics_mutation(
            connection, actor, assignment_id, input
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "SetAssignmentLogistics",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@assignment_router.post("/{assignment_id}/authorise-travel")
async def authorise_assignment_travel(
    assignment_id: UUID,
    input: AuthoriseAssignmentTravelInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        return await authorise_assignment_travel_mutation(
            connection, actor, assignment_id, input
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "AuthoriseAssignmentTravel",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@assignment_router.post("/{assignment_id}/acknowledgements")
async def record_assignment_acknowledgement(
    assignment_id: UUID,
    input: AssignmentAcknowledgementInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        return await record_assignment_acknowledgement_mutation(
            connection, actor, assignment_id, input
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "RecordAssignmentAcknowledgement",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@assignment_router.post("/{assignment_id}/cancel")
async def cancel_assignment(
    assignment_id: UUID,
    input: CancelAssignmentInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        return await cancel_assignment_mutation(connection, actor, assignment_id, input)

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "CancelAssignment",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )
