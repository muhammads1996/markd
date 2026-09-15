from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.encoders import jsonable_encoder
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.application.dispatcher import MutationResult, execute_command
from app.core.auth import CurrentActor
from app.integrations.database import Database

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])
worker_router = APIRouter(prefix="/workers", tags=["Workers"])
organisation_router = APIRouter(prefix="/organisations", tags=["Organisations"])


class OrganisationInput(BaseModel):
    organisation_name: str | None = None
    contact_name: str
    whatsapp_phone: str
    operating_area_ids: list[UUID] = Field(default_factory=list)
    typical_skill_ids: list[UUID] = Field(default_factory=list)
    record_status: Literal["active", "inactive"]


class WorkerInput(BaseModel):
    display_name: str
    whatsapp_phone: str
    preferred_language_id: UUID
    preferred_communication_mode: Literal["text", "voice", "call"]
    base_area_id: UUID
    primary_skill_ids: list[UUID]
    record_status: Literal["active", "inactive"]
    app_participation: Literal["unknown", "whatsapp_only", "interested", "using"]
    read_aloud_enabled: bool = False
    familiar_area_ids: list[UUID] = Field(default_factory=list)
    willing_to_travel_area_ids: list[UUID] = Field(default_factory=list)


class WorkerBeginResponse(BaseModel):
    worker_id: UUID
    portrait_asset_id: UUID
    bucket_id: str
    object_path: str


class WorkerCompleteInput(BaseModel):
    portrait_asset_id: UUID
    object_path: str
    target_status: Literal["active", "inactive"]


class OrganisationUpdateInput(OrganisationInput):
    pass


def _worker_payload(input: WorkerInput) -> dict[str, Any]:
    familiar = set(input.familiar_area_ids)
    travel = set(input.willing_to_travel_area_ids)
    return {
        "app_participation": input.app_participation,
        "base_area_id": str(input.base_area_id),
        "display_name": input.display_name,
        "familiar_area_ids": [str(value) for value in input.familiar_area_ids],
        "area_preferences": [
            {
                "area_id": str(area_id),
                "is_familiar": area_id in familiar,
                "willing_to_travel": area_id in travel,
            }
            for area_id in familiar | travel
        ],
        "language_ids": [str(input.preferred_language_id)],
        "phone_number": input.whatsapp_phone,
        "preferred_communication_mode": input.preferred_communication_mode,
        "preferred_language_id": str(input.preferred_language_id),
        "read_aloud_enabled": input.read_aloud_enabled,
        "record_status": input.record_status,
        "skill_ids": [str(value) for value in input.primary_skill_ids],
        "willing_to_travel_area_ids": [
            str(value) for value in input.willing_to_travel_area_ids
        ],
    }


def _organisation_payload(input: OrganisationInput) -> dict[str, Any]:
    name = input.organisation_name or input.contact_name
    return {
        "contact_display_name": input.contact_name,
        "contact_phone_number": input.whatsapp_phone,
        "display_name": name,
        "legal_name": name,
        "operating_area_ids": [str(value) for value in input.operating_area_ids],
        "record_status": input.record_status,
        "typical_skill_ids": [str(value) for value in input.typical_skill_ids],
    }


def _response_headers(command_id: UUID, replayed: bool) -> dict[str, str]:
    return {
        "X-Command-Id": str(command_id),
        "X-Idempotent-Replay": str(replayed).lower(),
    }


@router.post("/organisations", status_code=status.HTTP_201_CREATED)
async def create_organisation(
    input: OrganisationInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = input.model_dump(mode="json")

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            """
            select public.onboard_organisation(
              %s::text, %s::text, %s::text, %s::text, null::text,
              %s::uuid[], %s::uuid[], %s::text
            ) as id
            """,
            (
                payload["contact_display_name"],
                payload["display_name"],
                payload["contact_display_name"],
                payload["contact_phone_number"],
                payload["operating_area_ids"],
                payload["typical_skill_ids"],
                payload["record_status"],
            ),
        )
        row = await result.fetchone()
        organisation_id = row["id"]
        body = {"organisation_id": str(organisation_id)}
        return MutationResult(
            201,
            body,
            "OrganisationOnboarded",
            "organisation",
            organisation_id,
            body,
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "onboard_organisation",
        idempotency_key,
        payload,
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_response_headers(execution.command_id, execution.replayed),
    )


@router.post("/workers/{requested_worker_id}/begin", response_model=WorkerBeginResponse)
async def begin_worker(
    requested_worker_id: UUID,
    input: WorkerInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = _worker_payload(input)

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            "select * from public.begin_worker_onboarding(%s::uuid, %s::jsonb)",
            (requested_worker_id, Jsonb(payload)),
        )
        row = await result.fetchone()
        if row is None:
            raise HTTPException(status_code=500, detail="Worker draft was not created")
        body = jsonable_encoder(dict(row))
        return MutationResult(
            200,
            body,
            "WorkerOnboardingBegan",
            "worker",
            row["worker_id"],
            body,
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "begin_worker_onboarding",
        idempotency_key,
        {"requested_worker_id": str(requested_worker_id), **payload},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_response_headers(execution.command_id, execution.replayed),
    )


@router.post("/workers/{worker_id}/complete")
async def complete_worker(
    worker_id: UUID,
    input: WorkerCompleteInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = input.model_dump(mode="json")

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            """
            select public.complete_worker_onboarding(
              %s::uuid, %s::uuid, %s::text, %s::text
            ) as id
            """,
            (
                worker_id,
                input.portrait_asset_id,
                input.object_path,
                input.target_status,
            ),
        )
        row = await result.fetchone()
        body = {"worker_id": str(row["id"])}
        return MutationResult(
            200, body, "WorkerOnboardingCompleted", "worker", worker_id, body
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "complete_worker_onboarding",
        idempotency_key,
        {"worker_id": str(worker_id), **payload},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_response_headers(execution.command_id, execution.replayed),
    )


@router.post("/workers/{worker_id}/cancel")
async def cancel_worker(
    worker_id: UUID,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            "select public.cancel_worker_onboarding(%s::uuid) as id", (worker_id,)
        )
        row = await result.fetchone()
        body = {"worker_id": str(row["id"])}
        return MutationResult(
            200, body, "WorkerOnboardingCancelled", "worker", worker_id, body
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "cancel_worker_onboarding",
        idempotency_key,
        {"worker_id": str(worker_id)},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_response_headers(execution.command_id, execution.replayed),
    )


@worker_router.patch("/{worker_id}")
async def update_worker(
    worker_id: UUID,
    input: WorkerInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = _worker_payload(input)

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            "select public.update_worker_record(%s::uuid, %s::jsonb) as id",
            (worker_id, Jsonb(payload)),
        )
        row = await result.fetchone()
        body = {"worker_id": str(row["id"])}
        return MutationResult(200, body, "WorkerUpdated", "worker", worker_id, body)

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "update_worker_record",
        idempotency_key,
        {"worker_id": str(worker_id), **payload},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_response_headers(execution.command_id, execution.replayed),
    )


@organisation_router.patch("/{organisation_id}")
async def update_organisation(
    organisation_id: UUID,
    input: OrganisationUpdateInput,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    payload = _organisation_payload(input)

    async def handler(connection: Any) -> MutationResult:
        result = await connection.execute(
            "select public.update_organisation_record(%s::uuid, %s::jsonb) as id",
            (organisation_id, Jsonb(payload)),
        )
        row = await result.fetchone()
        body = {"organisation_id": str(row["id"])}
        return MutationResult(
            200, body, "OrganisationUpdated", "organisation", organisation_id, body
        )

    execution = await execute_command(
        database,
        actor,
        correlation_id,
        "update_organisation_record",
        idempotency_key,
        {"organisation_id": str(organisation_id), **payload},
        handler,
    )
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers=_response_headers(execution.command_id, execution.replayed),
    )