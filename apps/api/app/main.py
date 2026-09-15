from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1.labour_requests import (
    assignment_router,
)
from app.api.v1.labour_requests import (
    router as labour_requests_router,
)
from app.api.v1.me import router as me_router
from app.api.v1.onboarding import (
    organisation_router,
    worker_router,
)
from app.api.v1.onboarding import (
    router as onboarding_router,
)
from app.api.v1.proposed_actions import router as proposed_actions_router
from app.api.v1.storage import router as storage_router
from app.api.whatsapp import router as whatsapp_router
from app.core.config import Settings, get_settings
from app.core.correlation import CorrelationMiddleware
from app.core.problems import (
    ProblemDetail,
    problem_exception_handler,
    validation_exception_handler,
)
from app.integrations.database import Database


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    database = Database(resolved_settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        await database.open()
        application.state.database = database
        yield
        await database.close()

    application = FastAPI(
        title="MARKD Application API",
        version=resolved_settings.app_version,
        description=(
            "The authoritative FastAPI application boundary for MARKD commands "
            "and integrations. Supabase remains the canonical data platform."
        ),
        docs_url="/docs" if resolved_settings.environment != "production" else None,
        redoc_url="/redoc" if resolved_settings.environment != "production" else None,
        lifespan=lifespan,
    )
    application.state.database = database
    application.add_middleware(CorrelationMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-Correlation-Id",
        ],
    )
    application.add_exception_handler(ProblemDetail, problem_exception_handler)
    application.add_exception_handler(
        RequestValidationError, validation_exception_handler
    )
    application.dependency_overrides[get_settings] = lambda: resolved_settings
    application.include_router(health_router)
    application.include_router(whatsapp_router)
    application.include_router(me_router, prefix="/api/v1")
    application.include_router(labour_requests_router, prefix="/api/v1")
    application.include_router(assignment_router, prefix="/api/v1")
    application.include_router(onboarding_router, prefix="/api/v1")
    application.include_router(worker_router, prefix="/api/v1")
    application.include_router(organisation_router, prefix="/api/v1")
    application.include_router(storage_router, prefix="/api/v1")
    application.include_router(proposed_actions_router, prefix="/api/v1")
    return application


app = create_app()
