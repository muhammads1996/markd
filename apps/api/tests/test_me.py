import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_labour_command_actor
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.main import create_app

pytestmark = pytest.mark.asyncio


async def test_me_derives_worker_and_contractor_scopes_from_actor_claims() -> None:
    application = create_app(Settings(supabase_db_url="postgresql://test"))
    application.dependency_overrides[get_labour_command_actor] = lambda: CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={
            "operator": None,
            "participant_person_id": "99999999-9999-4999-8999-999999999999",
            "contractor_contacts": [
                {
                    "organisation_contact_id": (
                        "55555555-5555-4555-8555-555555555555"
                    ),
                    "organisation_id": "66666666-6666-4666-8666-666666666666",
                }
            ],
        },
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/me")

    assert response.status_code == 200
    assert response.json() == {
        "auth_user_id": "44444444-4444-4444-8444-444444444444",
        "person_id": "99999999-9999-4999-8999-999999999999",
        "actor_kind": "worker",
        "participant_scopes": ["worker", "contractor"],
        "organisation_contacts": [
            {
                "organisation_contact_id": "55555555-5555-4555-8555-555555555555",
                "organisation_id": "66666666-6666-4666-8666-666666666666",
            }
        ],
    }