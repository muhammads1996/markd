from datetime import UTC, datetime
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
from app.api.v1.labour_requests import (
    _check_version,
    _command_body,
    _get_assignment,
    _headers,
)
from app.application.dispatcher import (
    MutationResult,
    RelatedDomainEvent,
    execute_command,
)
from app.application.workmark_reconciliation import reconcile_workmark_evidence
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail
from app.integrations.database import Database

router = APIRouter(tags=["Workmarks"])


class StampPaymentInput(BaseModel):
    state: Literal["unknown", "pending", "paid", "partial", "disputed"] = "unknown"
    amount_minor: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    method: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def validate_amount(self) -> "StampPaymentInput":
        if (self.amount_minor is None) != (self.currency is None):
            raise ValueError("amount_minor and currency must be provided together")
        return self


class AssignmentStampInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attendance: Literal["attended", "no_show", "unknown"] = "unknown"
    completion: Literal["completed", "partial", "not_completed", "unknown"] = "unknown"
    reuse_preference: Literal["yes", "no", "unknown"] = "unknown"
    payment: StampPaymentInput = Field(default_factory=StampPaymentInput)
    note: str | None = Field(default=None, max_length=2000)
    expected_version: int | None = Field(default=None, ge=1)
    asserted_by: UUID | None = None
    asserted_role: Literal["worker", "hirer"] | None = None


class CorrectionChanges(BaseModel):
    attendance: Literal["attended", "no_show", "unknown"] | None = None
    completion: Literal["completed", "partial", "not_completed", "unknown"] | None = (
        None
    )
    payment_state: (
        Literal["unknown", "pending", "paid", "partial", "disputed"] | None
    ) = None
    amount_minor: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    payment_method: str | None = Field(default=None, max_length=80)
    worker_reuse_preference: Literal["yes", "no", "unknown"] | None = None
    organisation_reuse_preference: Literal["yes", "no", "unknown"] | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "CorrectionChanges":
        if not any(value is not None for value in self.model_dump().values()):
            raise ValueError("At least one Workmark fact must be corrected")
        return self


class CorrectWorkmarkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=1000)
    changes: CorrectionChanges
    expected_version: int | None = Field(default=None, ge=1)


def _is_operator(actor: CurrentActor) -> bool:
    return actor.claims.get("operator") is not None


def _require_operator_correction(actor: CurrentActor) -> None:
    if _is_operator(actor):
        return
    raise ProblemDetail(
        403,
        "FORBIDDEN",
        "Forbidden",
        "Only an operator can resolve Workmark facts.",
    )


def _require_assignment_outcome_ready(assignment: dict[str, Any]) -> None:
    if assignment["lifecycle"] != "active":
        return
    if (
        assignment.get("worker_response") == "accepted"
        and assignment.get("contractor_confirmation") == "confirmed"
        and assignment.get("travel_authorised_at") is not None
    ):
        return
    raise ProblemDetail(
        409,
        "WORK_NOT_TRAVEL_READY",
        "Work is not travel-ready",
        "Assignment closeout evidence can only be recorded after worker acceptance, "
        "contractor confirmation, and travel authorisation.",
    )


def _contractor_organisations(actor: CurrentActor) -> set[UUID]:
    return {
        UUID(str(contact["organisation_id"]))
        for contact in actor.claims.get("contractor_contacts", [])
        if contact.get("organisation_id") is not None
    }


def _assertion_role(actor: CurrentActor, assignment: dict[str, Any]) -> str:
    participant_person_id = actor.claims.get("participant_person_id")
    if participant_person_id is not None:
        participant_id = UUID(str(participant_person_id))
        if (
            actor.claims.get("worker_scope") is True
            and participant_id == assignment["worker_id"]
        ):
            return "worker"
        if assignment.get("hirer_person_id") == participant_id:
            return "hirer"
    organisation_id = assignment.get("organisation_id")
    if organisation_id is not None and UUID(
        str(organisation_id)
    ) in _contractor_organisations(actor):
        return "hirer"
    if _is_operator(actor):
        return "operator"
    raise ProblemDetail(
        403,
        "FORBIDDEN",
        "Forbidden",
        "Actor cannot submit closeout evidence for this assignment.",
    )


async def _resolve_assertion(
    connection: Any,
    actor: CurrentActor,
    assignment: dict[str, Any],
    input: AssignmentStampInput,
) -> tuple[str, UUID | None]:
    actor_role = _assertion_role(actor, assignment)
    if not _is_operator(actor):
        if input.asserted_by is not None and input.asserted_by != UUID(
            str(actor.claims.get("participant_person_id"))
        ):
            raise ProblemDetail(
                403,
                "FORBIDDEN",
                "Forbidden",
                "Participant clients cannot assert another person's facts.",
            )
        if input.asserted_role is not None and input.asserted_role != actor_role:
            raise ProblemDetail(
                403,
                "FORBIDDEN",
                "Forbidden",
                "Participant clients can only assert their own facts.",
            )
        return actor_role, UUID(str(actor.claims["participant_person_id"]))

    if input.asserted_by is None:
        return "operator", None
    role = input.asserted_role
    if role is None:
        raise ProblemDetail(
            422,
            "ASSERTED_ROLE_REQUIRED",
            "Invalid asserted subject",
            "Ops capture must identify whether the statement is from the worker "
            "or hirer.",
        )
    if role == "worker" and input.asserted_by != assignment["worker_id"]:
        raise ProblemDetail(
            422,
            "INVALID_ASSERTED_SUBJECT",
            "Invalid asserted subject",
            "The asserted worker must be assigned to this Assignment.",
        )
    if role == "hirer":
        result = await connection.execute(
            """
            select exists(
              select 1 from public.people p
              where p.id = %s and (
                p.id = %s or exists (
                  select 1 from public.organisation_contacts c
                  where c.person_id = p.id and c.organisation_id = %s
                    and c.archived_at is null
                )
              )
            ) as valid
            """,
            (
                input.asserted_by,
                assignment.get("hirer_person_id"),
                assignment.get("organisation_id"),
            ),
        )
        row = await result.fetchone()
        if not row or not row["valid"]:
            raise ProblemDetail(
                422,
                "INVALID_ASSERTED_SUBJECT",
                "Invalid asserted subject",
                "The asserted hirer must belong to this Assignment.",
            )
    return role, input.asserted_by


async def _get_assignment_for_workmark(
    connection: Any, workmark_id: UUID
) -> tuple[dict[str, Any], dict[str, Any]]:
    result = await connection.execute(
        """
        select w.id as workmark_id, w.assignment_id, w.version as workmark_version,
               a.id, a.labour_request_id, a.worker_id, a.organisation_id,
               a.hirer_person_id, a.site_id, a.lifecycle, a.version
        from public.workmarks w
        join public.assignments a on a.id = w.assignment_id
        where w.id = %s
        for update of w, a
        """,
        (workmark_id,),
    )
    row = await result.fetchone()
    if row is None:
        raise ProblemDetail(404, "NOT_FOUND", "Not found", "Workmark was not found.")
    record = dict(row)
    workmark = {
        "id": record.pop("workmark_id"),
        "version": record.pop("workmark_version"),
    }
    return record, workmark


def _db_preference(value: str) -> str:
    return {"yes": "would_reuse", "no": "would_not_reuse", "unknown": "unknown"}[value]


def _api_preference(value: str) -> str:
    return {"would_reuse": "yes", "would_not_reuse": "no", "unknown": "unknown"}[value]


def _aggregate(
    stamps: list[dict[str, Any]], corrections: list[dict[str, Any]]
) -> dict[str, Any]:
    return reconcile_workmark_evidence(stamps, corrections)


async def _read_evidence(
    connection: Any, workmark_id: UUID
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    stamps_result = await connection.execute(
        """
        select asserted_role, attendance::text, completion::text,
               reuse_preference::text, payment::text, amount_cents,
               currency, payment_method, created_at
        from public.assignment_stamps
        where workmark_id = %s
        order by created_at, id
        """,
        (workmark_id,),
    )
    corrections_result = await connection.execute(
        """
        select changes, created_at from public.workmark_corrections
        where workmark_id = %s
        order by created_at, id
        """,
        (workmark_id,),
    )
    return [dict(row) for row in await stamps_result.fetchall()], [
        dict(row) for row in await corrections_result.fetchall()
    ]


async def _reconcile_workmark(
    connection: Any,
    workmark_id: UUID,
    assignment: dict[str, Any],
) -> tuple[dict[str, Any], str | None, int | None]:
    stamps, corrections = await _read_evidence(connection, workmark_id)
    aggregate = _aggregate(stamps, corrections)
    workmark_lifecycle = {
        "corroborated": "confirmed",
        "operator_resolved": "corrected",
    }.get(aggregate["evidence_state"], "draft")
    result = await connection.execute(
        """
        update public.workmarks
        set attendance = %s, completion = %s, payment = %s,
            amount_cents = %s, currency = %s, payment_method = %s,
            worker_reuse_preference = %s, organisation_reuse_preference = %s,
            evidence_state = %s, lifecycle = %s, version = version + 1
        where id = %s
        returning id, version
        """,
        (
            aggregate["attendance"],
            aggregate["completion"],
            aggregate["payment"],
            aggregate["amount_cents"],
            aggregate["currency"],
            aggregate["payment_method"],
            aggregate["worker_reuse_preference"],
            aggregate["organisation_reuse_preference"],
            aggregate["evidence_state"],
            workmark_lifecycle,
            workmark_id,
        ),
    )
    updated = await result.fetchone()
    assignment_lifecycle: str | None = None
    assignment_version: int | None = None
    authoritative_fields = aggregate.pop("authoritative_fields")
    aggregate.pop("conflicting_fields")
    aggregate.pop("unresolved_shared_fields")
    if assignment["lifecycle"] == "active":
        if (
            "attendance" in authoritative_fields
            and aggregate["attendance"] == "no_show"
        ):
            assignment_lifecycle = "no_show"
        elif (
            {"attendance", "completion"} <= authoritative_fields
            and aggregate["attendance"] == "attended"
            and aggregate["completion"] == "completed"
        ):
            assignment_lifecycle = "completed"
        if assignment_lifecycle is not None:
            assignment_result = await connection.execute(
                """
                update public.assignments
                set lifecycle = %s, version = version + 1
                where id = %s and lifecycle = 'active'
                returning version
                """,
                (assignment_lifecycle, assignment["id"]),
            )
            assignment_row = await assignment_result.fetchone()
            assignment_version = assignment_row["version"]
    return (
        {
            "id": updated["id"],
            "version": updated["version"],
            **aggregate,
        },
        assignment_lifecycle,
        assignment_version,
    )


async def submit_assignment_stamp_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: AssignmentStampInput,
    *,
    source: str,
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    role, asserted_by = await _resolve_assertion(connection, actor, assignment, input)
    _check_version(assignment, input.expected_version)
    if assignment["lifecycle"] not in {"active", "completed", "no_show"}:
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Cancelled assignments cannot be rewritten by closeout evidence.",
        )
    _require_assignment_outcome_ready(assignment)
    workmark_result = await connection.execute(
        """
        insert into public.workmarks(
          worker_id, organisation_id, hirer_person_id, assignment_id, site_id,
          work_started_on, work_ended_on, origin, lifecycle, source,
          source_channel_event_id, source_proposed_action_id
        ) values (%s, %s, %s, %s, %s, %s, %s, 'assignment_closeout',
              'draft', %s, %s, %s)
        on conflict (assignment_id) where assignment_id is not null do nothing
        returning id, version
        """,
        (
            assignment["worker_id"],
            assignment.get("organisation_id"),
            assignment.get("hirer_person_id"),
            assignment_id,
            assignment.get("site_id"),
            assignment["starts_on"],
            assignment["ends_on"],
            source,
            source_channel_event_id,
            source_proposed_action_id,
        ),
    )
    workmark = await workmark_result.fetchone()
    workmark_created = workmark is not None
    if workmark is None:
        existing_result = await connection.execute(
            "select id, version from public.workmarks "
            "where assignment_id = %s for update",
            (assignment_id,),
        )
        workmark = await existing_result.fetchone()
    workmark_id = workmark["id"]
    stamp_result = await connection.execute(
        """
        insert into public.assignment_stamps(
          assignment_id, workmark_id, asserted_by_person_id, recorded_by_user_id,
          asserted_role, attendance, completion, reuse_preference, payment,
          amount_cents, currency, payment_method, note, source,
          source_channel_event_id, source_proposed_action_id, occurred_at
        ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        returning id
        """,
        (
            assignment_id,
            workmark_id,
            asserted_by,
            actor.user_id,
            role,
            input.attendance,
            input.completion,
            _db_preference(input.reuse_preference),
            input.payment.state,
            input.payment.amount_minor,
            input.payment.currency,
            input.payment.method,
            input.note,
            source,
            source_channel_event_id,
            source_proposed_action_id,
            occurred_at or datetime.now(UTC),
        ),
    )
    stamp = await stamp_result.fetchone()
    workmark, assignment_lifecycle, assignment_version = await _reconcile_workmark(
        connection, workmark_id, assignment
    )
    body = _command_body("workmark", workmark_id, workmark["version"])
    body.update(
        {
            "assignment_id": str(assignment_id),
            "stamp_id": str(stamp["id"]),
            "evidence_state": workmark["evidence_state"],
            "assignment_lifecycle": assignment_lifecycle,
            "arranged": True,
        }
    )
    related_events = (
        (
            RelatedDomainEvent(
                "assignment.completed"
                if assignment_lifecycle == "completed"
                else "assignment.no_show",
                "assignment",
                assignment_id,
                assignment_version,
                {
                    "assignment_id": str(assignment_id),
                    "outcome": assignment_lifecycle,
                    "workmark_id": str(workmark_id),
                },
            ),
        )
        if assignment_lifecycle is not None
        else ()
    )
    return MutationResult(
        201,
        body,
        "workmark.created" if workmark_created else "workmark.updated",
        "workmark",
        workmark_id,
        jsonable_encoder(body),
        source,
        source_channel_event_id,
        source_proposed_action_id,
        related_events,
    )


@router.post(
    "/api/v1/assignments/{assignment_id}/stamps", status_code=status.HTTP_201_CREATED
)
async def submit_assignment_stamp(
    assignment_id: UUID,
    input: AssignmentStampInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    source = "ops" if _is_operator(actor) else "pwa"

    async def handler(connection: Any) -> MutationResult:
        return await submit_assignment_stamp_mutation(
            connection, actor, assignment_id, input, source=source
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "SubmitAssignmentStamp",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/api/v1/workmarks/{workmark_id}/corrections")
async def correct_workmark(
    workmark_id: UUID,
    input: CorrectWorkmarkInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    source = "ops" if _is_operator(actor) else "pwa"

    async def handler(connection: Any) -> MutationResult:
        assignment, workmark = await _get_assignment_for_workmark(
            connection, workmark_id
        )
        _require_operator_correction(actor)
        _check_version(workmark, input.expected_version)
        correction_result = await connection.execute(
            """
            insert into public.workmark_corrections(
              workmark_id, reason, changes, asserted_by_person_id, recorded_by_user_id,
              source, source_channel_event_id, source_proposed_action_id, occurred_at
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                workmark_id,
                input.reason,
                Jsonb(input.changes.model_dump(mode="json", exclude_none=True)),
                actor.claims.get("participant_person_id"),
                actor.user_id,
                source,
                None,
                None,
                datetime.now(UTC),
            ),
        )
        correction = await correction_result.fetchone()
        (
            reconciled,
            assignment_lifecycle,
            assignment_version,
        ) = await _reconcile_workmark(connection, workmark_id, assignment)
        body = _command_body("workmark", workmark_id, reconciled["version"])
        body.update(
            {
                "correction_id": str(correction["id"]),
                "evidence_state": reconciled["evidence_state"],
                "assignment_lifecycle": assignment_lifecycle,
                "arranged": True,
            }
        )
        related_events = (
            (
                RelatedDomainEvent(
                    "assignment.completed"
                    if assignment_lifecycle == "completed"
                    else "assignment.no_show",
                    "assignment",
                    assignment["id"],
                    assignment_version,
                    {
                        "assignment_id": str(assignment["id"]),
                        "outcome": assignment_lifecycle,
                        "workmark_id": str(workmark_id),
                    },
                ),
            )
            if assignment_lifecycle is not None
            else ()
        )
        return MutationResult(
            200,
            body,
            "workmark.corrected",
            "workmark",
            workmark_id,
            jsonable_encoder(body),
            source,
            related_events=related_events,
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "CorrectWorkmark",
        idempotency_key,
        {"workmark_id": str(workmark_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )
