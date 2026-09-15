from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.encoders import jsonable_encoder
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.api.v1.labour_requests import (
    CreateLabourRequestInput,
    create_labour_request_mutation,
)
from app.application.dispatcher import MutationResult, execute_command
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail
from app.integrations.database import Database

router = APIRouter(prefix="/proposed-actions", tags=["Proposed actions"])


class ApprovalInput(BaseModel):
    action_type: Literal[
        "worker_availability",
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


class ConfirmLabourRequestActionInput(BaseModel):
    labour_request: CreateLabourRequestInput


def _headers(command_id: UUID, replayed: bool) -> dict[str, str]:
    return {
        "X-Command-Id": str(command_id),
        "X-Idempotent-Replay": str(replayed).lower(),
    }


@router.post("/{action_id}/confirm")
async def confirm_labour_request_action(
    action_id: UUID,
    input: ConfirmLabourRequestActionInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = input.model_dump(mode="json")

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            """
            select id, action_type, state, channel_event_id
            from public.proposed_actions
            where id = %s for update
            """,
            (action_id,),
        )
        action = await result.fetchone()
        if action is None:
            raise ProblemDetail(
                404, "NOT_FOUND", "Not found", "Proposed Action was not found."
            )
        if action["action_type"] != "labour_request":
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "Only Labour Request actions can create a Labour Request.",
            )
        if action["state"] != "pending":
            raise ProblemDetail(
                409,
                "INVALID_STATE",
                "Invalid state transition",
                "Only pending Proposed Actions can be confirmed.",
            )
        mutation = await create_labour_request_mutation(
            connection,
            actor,
            input.labour_request,
            "whatsapp",
            action["channel_event_id"],
            action_id,
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
            select action_type, state, ambiguity, risk_tier, confidence
            from public.proposed_actions
            where id = %s
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
        resolves_ambiguity = (
            existing["ambiguity"] == "clear"
            or (
                input.resolve_ambiguity
                and bool(input.fields or input.entity_ids)
            )
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