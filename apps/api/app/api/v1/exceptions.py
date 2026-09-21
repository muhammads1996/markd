from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, status
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from app.api.dependencies import (
    get_correlation_id,
    get_database,
    get_labour_command_actor,
)
from app.api.v1.labour_requests import (
    _command_body,
    _contractor_organisations,
    _headers,
)
from app.application.dispatcher import (
    MutationResult,
    RelatedDomainEvent,
    execute_command,
)
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail
from app.integrations.database import Database

router = APIRouter(prefix="/exceptions", tags=["Exceptions"])
assignment_router = APIRouter(prefix="/assignments", tags=["Assignment exceptions"])

ExceptionCategory = Literal[
    "payment_dispute",
    "attendance_dispute",
    "completion_dispute",
    "no_show_concern",
    "cancelled_after_commitment",
    "cancelled_after_travel_authorisation",
    "ambiguous_completion",
    "verification_trust_concern",
]
ExceptionRole = Literal["worker", "hirer", "operator"]
OPERATOR_CLAIM_SOURCES = {"api", "operator_ui", "call", "in_person"}


class ExceptionClaimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asserted_by: UUID | None = None
    asserted_role: ExceptionRole | None = None
    assertion: dict[str, Any] = Field(default_factory=dict)
    statement: str = Field(min_length=1, max_length=4000)
    source: str = Field(default="api", min_length=1, max_length=120)
    source_reference: str | None = Field(default=None, max_length=1000)
    evidence_refs: list[str] = Field(default_factory=list, max_length=50)


class OpenExceptionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: ExceptionCategory = Field(
        validation_alias=AliasChoices("category", "type")
    )
    summary: str = Field(min_length=1, max_length=4000)
    workmark_id: UUID | None = None
    claim: ExceptionClaimInput | None = None
    # Direct claim fields are accepted for the compact command payload as well
    # as the explicit nested form.
    asserted_by: UUID | None = None
    asserted_role: ExceptionRole | None = None
    assertion: dict[str, Any] | None = None
    statement: str | None = Field(default=None, min_length=1, max_length=4000)
    source: str = Field(default="api", min_length=1, max_length=120)
    source_reference: str | None = Field(default=None, max_length=1000)
    evidence_refs: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def require_first_claim(self) -> "OpenExceptionInput":
        if self.claim is None and self.statement is None:
            raise ValueError("Opening an exception requires a first claim")
        return self


class ResolveExceptionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(
        min_length=1,
        max_length=120,
        validation_alias=AliasChoices("outcome", "resolution_outcome"),
    )
    reason: str = Field(min_length=1, max_length=4000)
    evidence: dict[str, Any] = Field(default_factory=dict)
    workmark_correction_id: UUID | None = None
    expected_version: int = Field(ge=1)


def _is_operator(actor: CurrentActor) -> bool:
    return actor.claims.get("operator") is not None


def _participant_id(actor: CurrentActor) -> UUID | None:
    value = actor.claims.get("participant_person_id")
    return UUID(str(value)) if value is not None else None


def _require_assignment_participant(
    actor: CurrentActor, assignment: dict[str, Any]
) -> None:
    if _is_operator(actor):
        return
    participant = _participant_id(actor)
    is_worker = (
        actor.claims.get("worker_scope") is True
        and participant is not None
        and participant == assignment["worker_id"]
    )
    organisation_id = assignment.get("organisation_id")
    is_hirer = participant is not None and (
        participant == assignment.get("hirer_person_id")
        or (
            organisation_id is not None
            and UUID(str(organisation_id)) in _contractor_organisations(actor)
        )
    )
    if not (is_worker or is_hirer):
        raise ProblemDetail(
            403,
            "FORBIDDEN",
            "Forbidden",
            "Only an assignment participant or operator may record an exception.",
        )


def _resolve_assertion(
    actor: CurrentActor,
    assignment: dict[str, Any],
    claim: ExceptionClaimInput,
) -> tuple[ExceptionRole, UUID | None]:
    participant = _participant_id(actor)
    if not _is_operator(actor):
        _require_assignment_participant(actor, assignment)
        if claim.asserted_by is not None and claim.asserted_by != participant:
            raise ProblemDetail(
                403,
                "FORBIDDEN",
                "Forbidden",
                "Participants can only assert their own exception claims.",
            )
        if (
            participant == assignment["worker_id"]
            and actor.claims.get("worker_scope") is True
        ):
            role: ExceptionRole = "worker"
        else:
            role = "hirer"
        if claim.asserted_role is not None and claim.asserted_role != role:
            raise ProblemDetail(
                403,
                "FORBIDDEN",
                "Forbidden",
                "Participants can only assert their own role.",
            )
        return role, participant

    role = claim.asserted_role or "operator"
    asserted_by = claim.asserted_by
    if role == "operator" and asserted_by is not None:
        raise ProblemDetail(
            422,
            "INVALID_ASSERTION_ACTOR",
            "Invalid assertion actor",
            "An operator claim cannot be attributed to a participant.",
        )
    if role in ("worker", "hirer") and asserted_by is None:
        raise ProblemDetail(
            422,
            "ASSERTED_BY_REQUIRED",
            "Claimant required",
            "Ops must identify the worker or hirer whose claim is being captured.",
        )
    if role == "worker" and asserted_by != assignment["worker_id"]:
        raise ProblemDetail(
            422,
            "INVALID_ASSERTION_ACTOR",
            "Invalid assertion actor",
            "The worker claim must be attributed to the assigned worker.",
        )
    if role == "hirer" and asserted_by not in {
        assignment.get("hirer_person_id"),
        *(assignment.get("hirer_person_ids") or []),
    }:
        raise ProblemDetail(
            422,
            "INVALID_ASSERTION_ACTOR",
            "Invalid assertion actor",
            "The hirer claim must be attributed to an active assignment hirer.",
        )
    return role, asserted_by


async def _get_assignment(connection: Any, assignment_id: UUID) -> dict[str, Any]:
    result = await connection.execute(
        """
        select id, worker_id, organisation_id, hirer_person_id, lifecycle,
               cancelled_after_travel_authorised, travel_authorised_at,
               travel_revoked_at, version,
               array(
                 select contact.person_id
                 from public.organisation_contacts contact
                 where contact.organisation_id = assignments.organisation_id
                   and contact.archived_at is null
               ) as hirer_person_ids
        from public.assignments where id = %s for update
        """,
        (assignment_id,),
    )
    row = await result.fetchone()
    if row is None:
        raise ProblemDetail(404, "NOT_FOUND", "Not found", "Assignment was not found.")
    return dict(row)


def _actor_person_id(actor: CurrentActor) -> UUID | None:
    if _is_operator(actor):
        value = actor.claims["operator"].get("person_id")
        return UUID(str(value)) if value is not None else None
    return _participant_id(actor)


def _claim_from_open(input: OpenExceptionInput) -> ExceptionClaimInput:
    if input.claim is not None:
        return input.claim
    # The validator guarantees statement is present in this branch.
    return ExceptionClaimInput(
        asserted_by=input.asserted_by,
        asserted_role=input.asserted_role,
        assertion=input.assertion or {},
        statement=input.statement or input.summary,
        source=input.source,
        source_reference=input.source_reference,
        evidence_refs=input.evidence_refs,
    )


def _validate_category_context(
    assignment: dict[str, Any], category: ExceptionCategory
) -> None:
    has_travel_evidence = bool(
        assignment.get("cancelled_after_travel_authorised")
        or assignment.get("travel_authorised_at") is not None
        or assignment.get("travel_revoked_at") is not None
    )
    if category == "cancelled_after_travel_authorisation" and not has_travel_evidence:
        raise ProblemDetail(
            422,
            "TRAVEL_EVIDENCE_REQUIRED",
            "Travel evidence required",
            "A post-travel cancellation exception requires assignment travel evidence.",
        )
    if category == "cancelled_after_commitment" and has_travel_evidence:
        raise ProblemDetail(
            422,
            "TRAVEL_CANCELLATION_CATEGORY_REQUIRED",
            "Travel cancellation category required",
            "An assignment with travel evidence must use the post-travel "
            "cancellation category.",
        )


def _claim_source(
    actor: CurrentActor,
    claim: ExceptionClaimInput,
    source_channel: str,
    source_channel_event_id: UUID | None,
) -> str:
    if source_channel_event_id is not None:
        return source_channel
    if not _is_operator(actor):
        return source_channel
    if claim.source not in OPERATOR_CLAIM_SOURCES:
        raise ProblemDetail(
            422,
            "INVALID_SOURCE",
            "Invalid source",
            "Operator claims must use api, operator_ui, call, or in_person. "
            "Channel provenance is bound by the channel command path.",
        )
    return claim.source


async def _insert_claim(
    connection: Any,
    claim: ExceptionClaimInput,
    category: ExceptionCategory,
    role: ExceptionRole,
    asserted_by: UUID | None,
    actor: CurrentActor,
    case_id: UUID,
    source: str,
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> dict[str, Any]:
    values = (
        case_id,
        asserted_by,
        actor.user_id,
        role,
        category,
        Jsonb(claim.assertion),
        claim.statement,
        source,
        claim.source_reference,
        Jsonb(claim.evidence_refs),
        source_channel_event_id,
        source_proposed_action_id,
        occurred_at or datetime.now(UTC),
    )
    result = await connection.execute(
        """
        insert into public.exception_claims(
          exception_case_id, asserted_by_person_id, recorded_by_user_id,
          asserted_role, category, assertion, statement, source, source_reference,
          evidence_refs, source_channel_event_id, source_proposed_action_id,
          occurred_at
        ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        returning id, created_at
        """,
        values,
    )
    row = await result.fetchone()
    if row is None:
        raise ProblemDetail(
            503,
            "CLAIM_NOT_RECORDED",
            "Claim not recorded",
            "The exception claim could not be recorded.",
        )
    return dict(row)


def _case_body(
    case: dict[str, Any],
    status_value: Literal["applied", "already_applied"] = "applied",
) -> dict[str, Any]:
    return {
        **_command_body("exception_case", case["id"], case["version"], status_value),
        "state": case["state"],
        "category": case["category"],
    }


async def open_exception_mutation(
    connection: Any,
    actor: CurrentActor,
    assignment_id: UUID,
    input: OpenExceptionInput,
    *,
    source_channel: str = "ops",
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> MutationResult:
    assignment = await _get_assignment(connection, assignment_id)
    _require_assignment_participant(actor, assignment)
    _validate_category_context(assignment, input.category)
    claim = _claim_from_open(input)
    role, asserted_by = _resolve_assertion(actor, assignment, claim)
    source_event = source_channel_event_id
    source_action = source_proposed_action_id
    claim_source = _claim_source(actor, claim, source_channel, source_event)
    if source_action is not None and source_event is None:
        raise ProblemDetail(
            422,
            "INVALID_PROVENANCE",
            "Invalid provenance",
            "A proposed action requires its source channel event.",
        )

    existing_result = await connection.execute(
        """
        select id, state, category, version
        from public.exception_cases
        where assignment_id = %s and category = %s
          and state <> 'resolved' and archived_at is null
        order by created_at
        limit 1 for update
        """,
        (assignment_id, input.category),
    )
    existing = await existing_result.fetchone()
    if existing is not None:
        case = dict(existing)
        claim_row = await _insert_claim(
            connection,
            claim,
            input.category,
            role,
            asserted_by,
            actor,
            case["id"],
            claim_source,
            source_event,
            source_action,
            occurred_at,
        )
        related: list[RelatedDomainEvent] = []
        if case["state"] == "open":
            result = await connection.execute(
                """
                update public.exception_cases
                set state = 'under_review', version = version + 1
                where id = %s
                returning id, state, category, version
                """,
                (case["id"],),
            )
            updated = await result.fetchone()
            if updated is None:
                raise ProblemDetail(
                    503,
                    "EXCEPTION_NOT_UPDATED",
                    "Exception not updated",
                    "The exception could not be updated.",
                )
            case = dict(updated)
            related.append(
                RelatedDomainEvent(
                    "exception.status_changed",
                    "exception_case",
                    case["id"],
                    case["version"],
                    {"from": "open", "to": "under_review"},
                )
            )
        else:
            result = await connection.execute(
                """
                update public.exception_cases
                set version = version + 1
                where id = %s
                returning id, state, category, version
                """,
                (case["id"],),
            )
            updated = await result.fetchone()
            if updated is None:
                raise ProblemDetail(
                    503,
                    "EXCEPTION_NOT_UPDATED",
                    "Exception not updated",
                    "The exception could not be updated.",
                )
            case = dict(updated)
        body = _case_body(case)
        body["claim_id"] = str(claim_row["id"])
        return MutationResult(
            200,
            body,
            "exception.claim_added",
            "exception_case",
            case["id"],
            body,
            source_channel,
            source_event,
            source_action,
            tuple(related),
        )

    # The optional matching Workmark belongs in the case payload. It is accepted
    # by the command as a provenance reference without ever mutating that row.
    insert_result = await connection.execute(
        """
        insert into public.exception_cases(
          assignment_id, workmark_id, state, category, summary,
          opened_by_person_id, recorded_by_user_id, source_channel_event_id,
          source_proposed_action_id, source, opened_at, recorded_at,
          interpretation
        ) values (%s, %s, 'open', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        returning id, state, category, version
        """,
        (
            assignment_id,
            input.workmark_id,
            input.category,
            input.summary,
            _actor_person_id(actor),
            actor.user_id,
            source_event,
            source_action,
            claim_source,
            datetime.now(UTC),
            datetime.now(UTC),
            None,
        ),
    )
    row = await insert_result.fetchone()
    if row is None:
        raise ProblemDetail(
            503,
            "EXCEPTION_NOT_OPENED",
            "Exception not opened",
            "The exception could not be opened.",
        )
    case = dict(row)
    claim_row = await _insert_claim(
        connection,
        claim,
        input.category,
        role,
        asserted_by,
        actor,
        case["id"],
        claim_source,
        source_event,
        source_action,
        occurred_at,
    )
    body = _case_body(case)
    body["claim_id"] = str(claim_row["id"])
    return MutationResult(
        status.HTTP_201_CREATED,
        body,
        "exception.opened",
        "exception_case",
        case["id"],
        body,
        source_channel,
        source_event,
        source_action,
        related_events=(
            RelatedDomainEvent(
                "exception.claim_added",
                "exception_case",
                case["id"],
                case["version"],
                {"claim_id": str(claim_row["id"]), **body},
            ),
        ),
    )


async def add_exception_claim_mutation(
    connection: Any,
    actor: CurrentActor,
    exception_id: UUID,
    input: ExceptionClaimInput,
    *,
    source_channel: str = "ops",
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> MutationResult:
    result = await connection.execute(
        """
        select id, assignment_id, state, category, version
        from public.exception_cases where id = %s and archived_at is null for update
        """,
        (exception_id,),
    )
    row = await result.fetchone()
    if row is None:
        raise ProblemDetail(
            404, "NOT_FOUND", "Not found", "Exception case was not found."
        )
    case = dict(row)
    if case["state"] == "resolved":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Resolved exceptions cannot receive claims.",
        )
    assignment = await _get_assignment(connection, case["assignment_id"])
    _require_assignment_participant(actor, assignment)
    role, asserted_by = _resolve_assertion(actor, assignment, input)
    source_event = source_channel_event_id
    source_action = source_proposed_action_id
    if source_action is not None and source_event is None:
        raise ProblemDetail(
            422,
            "INVALID_PROVENANCE",
            "Invalid provenance",
            "A proposed action requires its source channel event.",
        )
    claim_source = _claim_source(actor, input, source_channel, source_event)
    claim_row = await _insert_claim(
        connection,
        input,
        case["category"],
        role,
        asserted_by,
        actor,
        exception_id,
        claim_source,
        source_event,
        source_action,
        occurred_at,
    )
    new_version = case["version"] + 1
    related: list[RelatedDomainEvent] = []
    if case["state"] == "open":
        transition = "under_review"
        state_result = await connection.execute(
            """
            update public.exception_cases set state = 'under_review', version = %s
            where id = %s returning id, state, category, version
            """,
            (new_version, exception_id),
        )
        updated = await state_result.fetchone()
        if updated is None:
            raise ProblemDetail(
                503,
                "EXCEPTION_NOT_UPDATED",
                "Exception not updated",
                "The exception could not be updated.",
            )
        case = dict(updated)
        related.append(
            RelatedDomainEvent(
                "exception.status_changed",
                "exception_case",
                exception_id,
                case["version"],
                {"from": "open", "to": transition},
            )
        )
    else:
        state_result = await connection.execute(
            """
            update public.exception_cases set version = %s
            where id = %s returning id, state, category, version
            """,
            (new_version, exception_id),
        )
        updated = await state_result.fetchone()
        if updated is not None:
            case = dict(updated)
    body = _case_body(case)
    body["claim_id"] = str(claim_row["id"])
    return MutationResult(
        201,
        body,
        "exception.claim_added",
        "exception_case",
        exception_id,
        body,
        source_channel,
        source_event,
        source_action,
        tuple(related),
    )


async def resolve_exception_mutation(
    connection: Any,
    actor: CurrentActor,
    exception_id: UUID,
    input: ResolveExceptionInput,
    *,
    source_channel: str = "ops",
) -> MutationResult:
    if not _is_operator(actor):
        raise ProblemDetail(
            403, "FORBIDDEN", "Forbidden", "Only an operator can resolve an exception."
        )
    result = await connection.execute(
        """
        select id, assignment_id, workmark_id, state, category, version,
               resolution_outcome, resolution_reason, resolution_evidence,
               workmark_correction_id
        from public.exception_cases where id = %s and archived_at is null for update
        """,
        (exception_id,),
    )
    row = await result.fetchone()
    if row is None:
        raise ProblemDetail(
            404, "NOT_FOUND", "Not found", "Exception case was not found."
        )
    case = dict(row)
    if case["state"] == "resolved":
        if (
            case.get("resolution_outcome") == input.outcome
            and case.get("resolution_reason") == input.reason
            and case.get("resolution_evidence") == input.evidence
            and case.get("workmark_correction_id")
            == input.workmark_correction_id
        ):
            body = _case_body(case, "already_applied")
            return MutationResult(
                200,
                body,
                None,
                "exception_case",
                exception_id,
                body,
                source_channel,
            )
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "A resolved exception cannot receive a different resolution.",
        )
    if case["state"] != "under_review":
        raise ProblemDetail(
            409,
            "INVALID_STATE",
            "Invalid state transition",
            "Only under-review exceptions can be resolved.",
        )
    if input.expected_version != case["version"]:
        raise ProblemDetail(
            409,
            "STALE_VERSION",
            "Stale version",
            "The exception changed before this command was applied.",
        )
    if input.workmark_correction_id is not None:
        correction = await connection.execute(
            """
            select correction.workmark_id, workmark.assignment_id
            from public.workmark_corrections correction
            join public.workmarks workmark on workmark.id = correction.workmark_id
            where correction.id = %s
            """,
            (input.workmark_correction_id,),
        )
        correction_row = await correction.fetchone()
        if (
            correction_row is None
            or (
                case["workmark_id"] is not None
                and correction_row["workmark_id"] != case["workmark_id"]
            )
            or (
                case["workmark_id"] is None
                and correction_row["assignment_id"] != case["assignment_id"]
            )
        ):
            raise ProblemDetail(
                422,
                "INVALID_RESOLUTION_EVIDENCE",
                "Invalid resolution evidence",
                "The correction does not reference a Workmark for this Assignment.",
            )
    resolved_at = datetime.now(UTC)
    result = await connection.execute(
        """
        update public.exception_cases
        set state = 'resolved', resolution_outcome = %s, resolution_reason = %s,
            resolution_actor_kind = 'operator', resolved_by_user_id = %s,
            resolved_at = %s, resolution_evidence = %s,
            workmark_correction_id = %s, version = version + 1
        where id = %s
        returning id, state, category, version
        """,
        (
            input.outcome,
            input.reason,
            actor.user_id,
            resolved_at,
            Jsonb(input.evidence),
            input.workmark_correction_id,
            exception_id,
        ),
    )
    resolved = await result.fetchone()
    if resolved is None:
        raise ProblemDetail(
            503,
            "EXCEPTION_NOT_RESOLVED",
            "Exception not resolved",
            "The exception could not be resolved.",
        )
    case = dict(resolved)
    body = _case_body(case)
    body.update(
        {"resolution_outcome": input.outcome, "resolved_at": resolved_at.isoformat()}
    )
    return MutationResult(
        200,
        body,
        "exception.status_changed",
        "exception_case",
        exception_id,
        {"from": "under_review", "to": "resolved", **body},
        source_channel,
        related_events=(
            RelatedDomainEvent(
                "exception.resolved",
                "exception_case",
                exception_id,
                case["version"],
                body,
            ),
        ),
    )


@assignment_router.post(
    "/{assignment_id}/exceptions", status_code=status.HTTP_201_CREATED
)
async def open_assignment_exception(
    assignment_id: UUID,
    input: OpenExceptionInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    source = "ops" if _is_operator(actor) else "pwa"

    async def handler(connection: Any) -> MutationResult:
        return await open_exception_mutation(
            connection, actor, assignment_id, input, source_channel=source
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "OpenAssignmentException",
        idempotency_key,
        {"assignment_id": str(assignment_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/{exception_id}/claims", status_code=status.HTTP_201_CREATED)
async def add_exception_claim(
    exception_id: UUID,
    input: ExceptionClaimInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    source = "ops" if _is_operator(actor) else "pwa"

    async def handler(connection: Any) -> MutationResult:
        return await add_exception_claim_mutation(
            connection, actor, exception_id, input, source_channel=source
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "AddExceptionClaim",
        idempotency_key,
        {"exception_id": str(exception_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/{exception_id}/resolve")
async def resolve_exception(
    exception_id: UUID,
    input: ResolveExceptionInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    async def handler(connection: Any) -> MutationResult:
        return await resolve_exception_mutation(connection, actor, exception_id, input)

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "ResolveAssignmentException",
        idempotency_key,
        {"exception_id": str(exception_id), **input.model_dump(mode="json")},
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )
