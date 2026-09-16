from datetime import date
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.dependencies import (
    get_correlation_id,
    get_database,
    get_labour_command_actor,
)
from app.api.v1.labour_requests import _command_body, _headers
from app.application.dispatcher import MutationResult, execute_command
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail
from app.integrations.database import Database

router = APIRouter(prefix="/workers", tags=["Workers"])

AvailabilitySource = Literal["ops", "pwa", "whatsapp"]


class SetWorkerAvailabilityInput(BaseModel):
    status: Literal["available", "unavailable", "unknown"]
    note: str | None = Field(default=None, max_length=2000)
    expected_version: int | None = Field(default=None, ge=1)


def _is_operator(actor: CurrentActor) -> bool:
    return actor.claims.get("operator") is not None


def _require_availability_actor(actor: CurrentActor, worker_id: UUID) -> None:
    if _is_operator(actor):
        return
    if actor.claims.get("contractor_contacts"):
        raise ProblemDetail(
            403,
            "FORBIDDEN",
            "Forbidden",
            "Contractors cannot record worker availability.",
        )
    if (
        actor.claims.get("worker_scope") is not True
        or str(actor.claims.get("participant_person_id")) != str(worker_id)
    ):
        raise ProblemDetail(
            403,
            "FORBIDDEN",
            "Forbidden",
            "Workers can only record their own availability.",
        )


def _check_version(
    signal: dict[str, Any], expected_version: int | None
) -> None:
    if expected_version is not None and signal["version"] != expected_version:
        raise ProblemDetail(
            409,
            "STALE_VERSION",
            "Stale version",
            "The availability signal changed before this command was applied.",
        )


async def set_worker_availability_mutation(
    connection: Any,
    actor: CurrentActor,
    worker_id: UUID,
    work_date: date,
    input: SetWorkerAvailabilityInput,
    *,
    source: AvailabilitySource = "pwa",
    source_channel_event_id: UUID | None = None,
    source_proposed_action_id: UUID | None = None,
) -> MutationResult:
    _require_availability_actor(actor, worker_id)
    current_result = await connection.execute(
        """
        select id, status, note, version
        from public.availability_signals
        where worker_id = %s
          and available_from = %s
          and available_to = %s
          and archived_at is null
        for update
        """,
        (worker_id, work_date, work_date),
    )
    current = await current_result.fetchone()
    if current is not None:
        current = dict(current)
        _check_version(current, input.expected_version)
        if current["status"] == input.status and current["note"] == input.note:
            return MutationResult(
                200,
                _command_body(
                    "availability_signal",
                    current["id"],
                    current["version"],
                    "already_applied",
                ),
                None,
                "availability_signal",
                current["id"],
                {},
            )
        await connection.execute(
            """
            update public.availability_signals
            set archived_at = timezone('utc', now())
            where id = %s and archived_at is null
            """,
            (current["id"],),
        )

    created_result = await connection.execute(
        """
        insert into public.availability_signals(
          worker_id, available_from, available_to, status, note, source,
          recorded_by_user_id, source_channel_event_id, source_proposed_action_id
        ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        returning id, version
        """,
        (
            worker_id,
            work_date,
            work_date,
            input.status,
            input.note,
            source,
            actor.user_id,
            source_channel_event_id,
            source_proposed_action_id,
        ),
    )
    created = await created_result.fetchone()
    if created is None:
        raise ProblemDetail(
            503,
            "AVAILABILITY_NOT_RECORDED",
            "Availability not recorded",
            "The availability signal could not be recorded.",
        )
    body = _command_body("availability_signal", created["id"], created["version"])
    return MutationResult(
        200,
        body,
        "worker.availability_set",
        "availability_signal",
        created["id"],
        body,
        source,
        source_channel_event_id,
        source_proposed_action_id,
    )


@router.put("/{worker_id}/availability/{work_date}")
async def set_worker_availability(
    worker_id: UUID,
    work_date: date,
    input: SetWorkerAvailabilityInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_labour_command_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> JSONResponse:
    source: AvailabilitySource = "ops" if _is_operator(actor) else "pwa"

    async def handler(connection: Any) -> MutationResult:
        return await set_worker_availability_mutation(
            connection,
            actor,
            worker_id,
            work_date,
            input,
            source=source,
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "SetWorkerAvailability",
        idempotency_key,
        {
            "worker_id": str(worker_id),
            "work_date": work_date.isoformat(),
            **input.model_dump(mode="json"),
        },
        handler,
    )
    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_headers(execution.command_id, execution.replayed),
    )