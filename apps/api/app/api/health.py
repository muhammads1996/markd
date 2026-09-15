from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from app.api.dependencies import get_database
from app.core.config import Settings, get_settings
from app.integrations.database import Database

router = APIRouter(tags=["System"])


@router.get("/health/live", operation_id="getLiveness")
async def get_liveness(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
    }


@router.get("/health/ready", operation_id="getReadiness")
async def get_readiness(
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> JSONResponse:
    database_status = "ok" if await database.check() else "degraded"
    ready = database_status == "ok"
    body = {
        "status": "ready" if ready else "degraded",
        "dependencies": [
            {"name": "configuration", "status": "ok", "detail": None},
            {
                "name": "supabase_database",
                "status": database_status,
                "detail": None if ready else "database configuration is missing",
            },
        ],
    }
    return JSONResponse(
        status_code=(
            status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE
        ),
        content=body,
    )