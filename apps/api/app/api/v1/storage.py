from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.application.dispatcher import MutationResult, execute_command
from app.core.auth import CurrentActor
from app.core.config import Settings, get_settings
from app.integrations.database import Database
from app.integrations.storage import delete_private_object, upload_private_object

router = APIRouter(prefix="/onboarding/workers", tags=["Onboarding media"])


@router.post("/{worker_id}/portrait")
async def upload_portrait(
    worker_id: UUID,
    asset_id: UUID = Form(),
    object_path: str = Form(),
    portrait: UploadFile = File(),
    idempotency_key: str = Header(alias="Idempotency-Key"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    settings: Settings = Depends(get_settings),
    correlation_id: str = Depends(get_correlation_id),
) -> Any:
    content = await portrait.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        from fastapi import HTTPException

        raise HTTPException(status_code=413, detail="Portrait must be at most 5 MB")
    content_type = portrait.content_type or "application/octet-stream"
    payload = {
        "worker_id": str(worker_id),
        "asset_id": str(asset_id),
        "object_path": object_path,
        "content_type": content_type,
    }

    uploaded_object: tuple[str, str] | None = None

    async def handler(connection: Any) -> MutationResult:
        nonlocal uploaded_object
        result = await connection.execute(
            """
            select bucket_id, object_path
            from public.worker_media_assets
            where id = %s and worker_id = %s and media_kind = 'portrait'
              and archived_at is null
            """,
            (asset_id, worker_id),
        )
        asset = await result.fetchone()
        if asset is None or asset["object_path"] != object_path:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Portrait draft was not found")
        await upload_private_object(
            settings,
            asset["bucket_id"],
            asset["object_path"],
            content,
            content_type,
        )
        uploaded_object = (asset["bucket_id"], asset["object_path"])
        body = {"worker_id": str(worker_id), "asset_id": str(asset_id)}
        return MutationResult(
            200,
            body,
            "WorkerPortraitUploaded",
            "worker",
            worker_id,
            body,
        )

    try:
        execution = await execute_command(
            database,
            actor,
            correlation_id,
            "upload_worker_portrait",
            idempotency_key,
            payload,
            handler,
        )
    except Exception:
        if uploaded_object is not None:
            try:
                await delete_private_object(settings, *uploaded_object)
            except Exception:
                pass
        raise
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=execution.status_code,
        content={**execution.body, "command_id": str(execution.command_id)},
        headers={
            "X-Command-Id": str(execution.command_id),
            "X-Idempotent-Replay": str(execution.replayed).lower(),
        },
    )