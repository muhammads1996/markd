import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.main import create_app

pytestmark = pytest.mark.asyncio


async def test_liveness_and_correlation_header() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.get(
            "/health/live",
            headers={"X-Correlation-Id": "00000000-0000-4000-8000-000000000001"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["x-correlation-id"] == (
        "00000000-0000-4000-8000-000000000001"
    )


async def test_readiness_is_unavailable_without_database_configuration() -> None:
    application = create_app(Settings(supabase_db_url=None))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


async def test_local_playwright_origin_can_preflight_authenticated_commands() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.options(
            "/api/v1/assignments/00000000-0000-4000-8000-000000000001/confirm",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": (
                    "authorization,content-type,idempotency-key,x-correlation-id"
                ),
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
