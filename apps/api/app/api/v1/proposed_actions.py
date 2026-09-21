from dataclasses import replace
from typing import Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.encoders import jsonable_encoder
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, model_validator

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.api.v1.exceptions import (
    ExceptionCategory,
    ExceptionClaimInput,
    OpenExceptionInput,
    open_exception_mutation,
)
from app.api.v1.labour_requests import (
    CancelAssignmentInput,
    ContractorConfirmationInput,
    CreateLabourRequestInput,
    cancel_assignment_mutation,
    confirm_assignment_mutation,
    create_labour_request_mutation,
)
from app.api.v1.workmarks import (
    AssignmentStampInput,
    submit_assignment_stamp_mutation,
)
from app.application.dispatcher import (
    MutationResult,
    RelatedDomainEvent,
    execute_command,
)
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail
from app.integrations.database import Database

router = APIRouter(prefix="/proposed-actions", tags=["Proposed actions"])


class ApprovalInput(BaseModel):
    action_type: Literal[
        "worker_availability",
        "assignment_response",
        "labour_request",
        "assignment_confirmation",
        "assignment_cancellation",
        "work_completion",
        "payment_issue",
        "historical_work_relationship_claim",
    ]
    fields: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    entity_ids: dict[str, str] = Field(default_factory=dict)
    resolve_ambiguity: bool = False


class RejectionInput(BaseModel):
    reason: str


class ConfirmAssignmentActionInput(BaseModel):
    assignment_id: UUID
    confirmed: bool = True
    expected_version: int | None = Field(default=None, ge=1)


class CancelAssignmentActionInput(BaseModel):
    assignment_id: UUID
    reason_code: Literal[
        "worker_withdrew",
        "contractor_cancelled",
        "job_cancelled",
        "operator_cancelled",
        "other",
    ]
    reason_text: str | None = Field(default=None, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class WorkCompletionActionInput(BaseModel):
    assignment_id: UUID
    stamp: AssignmentStampInput


class PaymentIssueActionInput(BaseModel):
    assignment_id: UUID
    category: ExceptionCategory = "payment_dispute"
    summary: str = Field(
        default="Payment issue reported", min_length=1, max_length=4000
    )
    workmark_id: UUID | None = None
    statement: str = Field(
        default="Payment issue reported", min_length=1, max_length=4000
    )
    assertion: dict[str, Any] = Field(default_factory=dict)
    asserted_by: UUID | None = None
    asserted_role: Literal["worker", "hirer", "operator"] | None = None
    evidence_refs: list[str] = Field(default_factory=list, max_length=50)


class ConfirmProposedActionInput(BaseModel):
    labour_request: CreateLabourRequestInput | None = None
    assignment_confirmation: ConfirmAssignmentActionInput | None = None
    assignment_cancellation: CancelAssignmentActionInput | None = None
    work_completion: WorkCompletionActionInput | None = None
    payment_issue: PaymentIssueActionInput | None = None

    @model_validator(mode="after")
    def validate_action_payload(self) -> "ConfirmProposedActionInput":
        if (
            sum(
                value is not None
                for value in (
                    self.labour_request,
                    self.assignment_confirmation,
                    self.assignment_cancellation,
                    self.work_completion,
                    self.payment_issue,
                )
            )
            != 1
        ):
            raise ValueError("Exactly one Proposed Action payload is required.")
        return self


def _bound_work_completion(
    payload: object,
    requested: WorkCompletionActionInput,
) -> WorkCompletionActionInput:
    """Keep a WhatsApp assertion bound to the sender/assignment resolved at intake.

    An operator may complete the proposed facts, but cannot make source WhatsApp
    evidence look like a statement from another person or assignment. Ambiguous
    actions must instead be captured through the normal Ops Stamp command.
    """
    if not isinstance(payload, dict):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp closeout needs sender and Assignment resolution before it "
            "can be confirmed.",
        )
    raw_entity_ids = payload.get("entityIds")
    if not isinstance(raw_entity_ids, dict):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp closeout needs sender and Assignment resolution before it "
            "can be confirmed.",
        )
    entity_ids = cast(dict[str, object], raw_entity_ids)
    raw_assignment_id = entity_ids.get("assignmentId")
    raw_asserted_by = entity_ids.get("assertedById", entity_ids.get("workerId"))
    raw_asserted_role = entity_ids.get("assertedRole")
    if raw_asserted_role is None and "workerId" in entity_ids:
        raw_asserted_role = "worker"
    if (
        not isinstance(raw_assignment_id, str)
        or not isinstance(raw_asserted_by, str)
        or raw_asserted_role not in {"worker", "hirer"}
    ):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp closeout needs sender and Assignment resolution before it "
            "can be confirmed.",
        )
    try:
        assignment_id = UUID(raw_assignment_id)
        asserted_by = UUID(raw_asserted_by)
    except ValueError as error:
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp closeout has invalid sender or Assignment resolution.",
        ) from error
    asserted_role = cast(Literal["worker", "hirer"], raw_asserted_role)
    if requested.assignment_id != assignment_id:
        raise ProblemDetail(
            409,
            "SOURCE_BINDING_MISMATCH",
            "Source evidence cannot be reassigned",
            "The Assignment must match the WhatsApp sender resolution.",
        )
    if (
        requested.stamp.asserted_by not in {None, asserted_by}
        or requested.stamp.asserted_role not in {None, asserted_role}
    ):
        raise ProblemDetail(
            409,
            "SOURCE_BINDING_MISMATCH",
            "Source evidence cannot be reassigned",
            "The asserted person and role must match the WhatsApp sender resolution.",
        )
    return WorkCompletionActionInput(
        assignment_id=assignment_id,
        stamp=requested.stamp.model_copy(
            update={"asserted_by": asserted_by, "asserted_role": asserted_role}
        ),
    )


def _bound_payment_issue(
    payload: object,
    requested: PaymentIssueActionInput,
) -> PaymentIssueActionInput:
    """Keep payment claims bound to the identity resolved when WhatsApp was ingested."""
    if not isinstance(payload, dict):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue needs sender and Assignment resolution "
            "before it can be confirmed.",
        )
    raw_entity_ids = payload.get("entityIds")
    if not isinstance(raw_entity_ids, dict):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue needs sender and Assignment resolution "
            "before it can be confirmed.",
        )
    entity_ids = cast(dict[str, object], raw_entity_ids)
    raw_assignment_id = entity_ids.get("assignmentId")
    raw_asserted_by = entity_ids.get("assertedById", entity_ids.get("workerId"))
    raw_asserted_role = entity_ids.get("assertedRole")
    if raw_asserted_role is None and "workerId" in entity_ids:
        raw_asserted_role = "worker"
    if (
        not isinstance(raw_assignment_id, str)
        or not isinstance(raw_asserted_by, str)
        or raw_asserted_role not in {"worker", "hirer"}
    ):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue needs sender and Assignment resolution "
            "before it can be confirmed.",
        )
    try:
        assignment_id = UUID(raw_assignment_id)
        asserted_by = UUID(raw_asserted_by)
    except ValueError as error:
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue has invalid sender or Assignment resolution.",
        ) from error
    asserted_role = cast(Literal["worker", "hirer"], raw_asserted_role)
    if requested.assignment_id != assignment_id:
        raise ProblemDetail(
            409,
            "SOURCE_BINDING_MISMATCH",
            "Source evidence cannot be reassigned",
            "The Assignment must match the WhatsApp sender resolution.",
        )
    if (
        requested.asserted_by not in {None, asserted_by}
        or requested.asserted_role not in {None, asserted_role}
        or requested.category != "payment_dispute"
    ):
        raise ProblemDetail(
            409,
            "SOURCE_BINDING_MISMATCH",
            "Source evidence cannot be reassigned",
            "The asserted person, role, and category must match the WhatsApp "
            "source resolution.",
        )
    return requested.model_copy(
        update={
            "assignment_id": assignment_id,
            "asserted_by": asserted_by,
            "asserted_role": asserted_role,
            "category": "payment_dispute",
        }
    )


def _headers(command_id: UUID, replayed: bool) -> dict[str, str]:
    return {
        "X-Command-Id": str(command_id),
        "X-Idempotent-Replay": str(replayed).lower(),
    }


def _payment_issue_exception_input(
    payment: PaymentIssueActionInput,
) -> OpenExceptionInput:
    claim = ExceptionClaimInput(
        asserted_by=payment.asserted_by,
        asserted_role=payment.asserted_role,
        assertion=payment.assertion,
        statement=payment.statement,
        source="whatsapp",
        evidence_refs=payment.evidence_refs,
    )
    return OpenExceptionInput(
        category=payment.category,
        summary=payment.summary,
        workmark_id=payment.workmark_id,
        claim=claim,
    )


def _payment_issue_from_approval(
    action: dict[str, Any], input: ApprovalInput
) -> PaymentIssueActionInput:
    payload = action.get("payload")
    payload_dict = payload if isinstance(payload, dict) else {}
    payload_fields = payload_dict.get("fields")
    payload_entities = payload_dict.get("entityIds")
    payload_entities_dict = (
        payload_entities if isinstance(payload_entities, dict) else {}
    )
    if input.entity_ids and input.entity_ids != payload_entities_dict:
        # Entity identity is resolved at intake; approval may edit facts, never
        # the assignment or claimant bound to the source message.
        for key in ("assignmentId", "assertedById", "workerId", "assertedRole"):
            if (
                key in input.entity_ids
                and input.entity_ids.get(key) != payload_entities_dict.get(key)
            ):
                raise ProblemDetail(
                    409,
                    "SOURCE_BINDING_MISMATCH",
                    "Source evidence cannot be reassigned",
                    "The Assignment and claimant must match the WhatsApp source "
                    "resolution.",
                )
    fields = input.fields or (
        payload_fields if isinstance(payload_fields, dict) else {}
    )
    # Always resolve identity from the immutable intake payload.  The approval
    # body can add facts, but never supplies a replacement source identity.
    entities = payload_entities_dict
    raw_assignment = entities.get("assignmentId")
    raw_asserted_by = entities.get("assertedById", entities.get("workerId"))
    raw_role = entities.get("assertedRole")
    if raw_role is None and entities.get("workerId") is not None:
        raw_role = "worker"
    if not isinstance(raw_assignment, str) or not isinstance(raw_asserted_by, str):
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue needs Assignment and claimant resolution.",
        )
    if raw_role not in {"worker", "hirer"}:
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue needs a worker or hirer claimant.",
        )
    try:
        assignment_id = UUID(raw_assignment)
        asserted_by = UUID(raw_asserted_by)
    except ValueError as error:
        raise ProblemDetail(
            409,
            "UNRESOLVED_SOURCE_EVIDENCE",
            "Source evidence is unresolved",
            "This WhatsApp payment issue has invalid Assignment evidence.",
        ) from error
    statement = str(
        fields.get("statement")
        or fields.get("note")
        or fields.get("summary")
        or "Payment issue reported through WhatsApp."
    )
    payment_state = fields.get("payment_state") or "disputed"
    payment = PaymentIssueActionInput(
        assignment_id=assignment_id,
        category="payment_dispute",
        summary=statement,
        statement=statement,
        assertion={"payment": payment_state},
        asserted_by=asserted_by,
        asserted_role=cast(Literal["worker", "hirer"], raw_role),
    )
    return _bound_payment_issue(action.get("payload"), payment)


@router.post("/{action_id}/confirm")
async def confirm_labour_request_action(
    action_id: UUID,
    input: ConfirmProposedActionInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = input.model_dump(mode="json")

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            """
            select action.id, action.action_type, action.state, action.payload,
                   action.channel_event_id, event.occurred_at
            from public.proposed_actions as action
            join public.channel_events as event on event.id = action.channel_event_id
            where action.id = %s for update of action
            """,
            (action_id,),
        )
        action = await result.fetchone()
        if action is None:
            raise ProblemDetail(
                404, "NOT_FOUND", "Not found", "Proposed Action was not found."
            )
        if action["state"] != "pending":
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "Only pending Proposed Actions can be confirmed.",
            )
        if action["action_type"] == "labour_request":
            if input.labour_request is None:
                raise ProblemDetail(
                    422,
                    "INVALID_PAYLOAD",
                    "Invalid payload",
                    "A Labour Request payload is required.",
                )
            mutation = await create_labour_request_mutation(
                connection,
                actor,
                input.labour_request,
                "whatsapp",
                action["channel_event_id"],
                action_id,
            )
        elif action["action_type"] == "assignment_confirmation":
            if input.assignment_confirmation is None:
                raise ProblemDetail(
                    422,
                    "INVALID_PAYLOAD",
                    "Invalid payload",
                    "An assignment confirmation payload is required.",
                )
            assignment_input = ContractorConfirmationInput(
                confirmed=input.assignment_confirmation.confirmed,
                expected_version=input.assignment_confirmation.expected_version,
            )
            await connection.execute(
                "select set_config('app.source_channel_event_id', %s, true)",
                (str(action["channel_event_id"]),),
            )
            await connection.execute(
                "select set_config('app.source_proposed_action_id', %s, true)",
                (str(action_id),),
            )
            mutation = await confirm_assignment_mutation(
                connection,
                actor,
                input.assignment_confirmation.assignment_id,
                assignment_input,
            )
        elif action["action_type"] == "assignment_cancellation":
            if input.assignment_cancellation is None:
                raise ProblemDetail(
                    422,
                    "INVALID_PAYLOAD",
                    "Invalid payload",
                    "An assignment cancellation payload is required.",
                )
            await connection.execute(
                "select set_config('app.source_channel_event_id', %s, true)",
                (str(action["channel_event_id"]),),
            )
            await connection.execute(
                "select set_config('app.source_proposed_action_id', %s, true)",
                (str(action_id),),
            )
            cancellation_input = CancelAssignmentInput(
                reason_code=input.assignment_cancellation.reason_code,
                reason_text=input.assignment_cancellation.reason_text,
                expected_version=input.assignment_cancellation.expected_version,
            )
            mutation = await cancel_assignment_mutation(
                connection,
                actor,
                input.assignment_cancellation.assignment_id,
                cancellation_input,
            )
        elif action["action_type"] == "payment_issue":
            if input.payment_issue is None:
                raise ProblemDetail(
                    422,
                    "INVALID_PAYLOAD",
                    "Invalid payload",
                    "A payment issue payload is required.",
                )
            bound_payment = _bound_payment_issue(action["payload"], input.payment_issue)
            payment_input = _payment_issue_exception_input(bound_payment)
            mutation = await open_exception_mutation(
                connection,
                actor,
                bound_payment.assignment_id,
                payment_input,
                source_channel="whatsapp",
                source_channel_event_id=action["channel_event_id"],
                source_proposed_action_id=action_id,
                occurred_at=action["occurred_at"],
            )
        elif action["action_type"] == "work_completion":
            if input.work_completion is None:
                raise ProblemDetail(
                    422,
                    "INVALID_PAYLOAD",
                    "Invalid payload",
                    "A work completion payload is required.",
                )
            bound = _bound_work_completion(
                action["payload"], input.work_completion
            )
            mutation = await submit_assignment_stamp_mutation(
                connection,
                actor,
                bound.assignment_id,
                bound.stamp,
                source="whatsapp",
                source_channel_event_id=action["channel_event_id"],
                source_proposed_action_id=action_id,
                occurred_at=action["occurred_at"],
            )
        else:
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "This Proposed Action type is not supported by this command.",
            )
        await connection.execute(
            "update public.proposed_actions set state = 'executed' where id = %s",
            (action_id,),
        )
        return mutation

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "ConfirmProposedAction",
        idempotency_key,
        {"action_id": str(action_id), **payload},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/{action_id}/approve")
async def approve_proposed_action(
    action_id: UUID,
    input: ApprovalInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    edited_payload = {
        "actionType": input.action_type,
        "fields": input.fields,
        "entityIds": input.entity_ids,
    }

    async def handler(connection: Any) -> MutationResult:
        existing_result = await connection.execute(
            """
            select proposed_actions.action_type, proposed_actions.state,
                   proposed_actions.ambiguity, proposed_actions.risk_tier,
                   proposed_actions.confidence, proposed_actions.payload,
                   proposed_actions.channel_event_id, event.occurred_at
            from public.proposed_actions
            join public.channel_events event
              on event.id = proposed_actions.channel_event_id
            where proposed_actions.id = %s
            """,
            (action_id,),
        )
        existing = await existing_result.fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Proposed action was not found")
        if existing["action_type"] != input.action_type:
            raise HTTPException(
                status_code=409, detail="Proposed action type cannot be changed"
            )
        if existing["state"] != "pending":
            raise HTTPException(
                status_code=409, detail="Only pending proposed actions can be approved"
            )
        resolves_ambiguity = existing["ambiguity"] == "clear" or (
            input.resolve_ambiguity and bool(input.fields or input.entity_ids)
        )
        if not resolves_ambiguity:
            raise HTTPException(
                status_code=409,
                detail="Ambiguous proposed actions require edited fields or entities",
            )
        if existing["risk_tier"] in {"trust", "economic"} and (
            existing["confidence"] is None or existing["confidence"] < 0.9
        ):
            raise HTTPException(
                status_code=409,
                detail="High-trust proposed actions require confidence >= 0.9",
            )
        payload = edited_payload if input.fields or input.entity_ids else None
        result = await connection.execute(
            """
            select * from public.approve_proposed_action(
              %s::uuid, %s::jsonb, %s::boolean
            )
            """,
            (
                action_id,
                Jsonb(payload) if payload is not None else None,
                input.resolve_ambiguity,
            ),
        )
        row = await result.fetchone()
        if input.action_type == "payment_issue":
            payment_input = _payment_issue_from_approval(dict(existing), input)
            mutation = await open_exception_mutation(
                connection,
                actor,
                payment_input.assignment_id,
                _payment_issue_exception_input(payment_input),
                source_channel="whatsapp",
                source_channel_event_id=existing["channel_event_id"],
                source_proposed_action_id=action_id,
                occurred_at=existing["occurred_at"],
            )
            await connection.execute(
                "update public.proposed_actions set state = 'executed' where id = %s",
                (action_id,),
            )
            return replace(
                mutation,
                related_events=mutation.related_events
                + (
                    RelatedDomainEvent(
                        "ProposedActionApproved",
                        "proposed_action",
                        action_id,
                        None,
                        {"action_id": str(action_id), "state": "executed"},
                    ),
                ),
            )
        body = {
            "action_id": str(action_id),
            "state": "approved",
            "record": jsonable_encoder(dict(row)),
        }
        return MutationResult(
            200,
            body,
            "ProposedActionApproved",
            "proposed_action",
            action_id,
            {"action_id": str(action_id), "payload": payload},
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "approve_proposed_action",
        idempotency_key,
        {
            "action_id": str(action_id),
            **edited_payload,
            "resolve_ambiguity": input.resolve_ambiguity,
        },
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )


@router.post("/{action_id}/reject")
async def reject_proposed_action(
    action_id: UUID,
    input: RejectionInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            "select * from public.reject_proposed_action(%s::uuid, %s::text)",
            (action_id, input.reason),
        )
        row = await result.fetchone()
        body = {
            "action_id": str(action_id),
            "state": "rejected",
            "record": jsonable_encoder(dict(row)),
        }
        return MutationResult(
            200,
            body,
            "ProposedActionRejected",
            "proposed_action",
            action_id,
            {"action_id": str(action_id), "reason": input.reason},
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "reject_proposed_action",
        idempotency_key,
        {"action_id": str(action_id), "reason": input.reason},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )
