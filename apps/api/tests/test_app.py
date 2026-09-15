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