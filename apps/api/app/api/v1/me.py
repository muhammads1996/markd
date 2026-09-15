from typing import Any

from fastapi import APIRouter, Depends

from app.api.dependencies import get_operator_actor
from app.core.auth import CurrentActor

router = APIRouter(prefix="/me", tags=["Identity"])


@router.get("")
async def get_me(
    actor: CurrentActor = Depends(get_operator_actor),
) -> dict[str, Any]:
    operator = actor.claims["operator"]
    return {
        "auth_user_id": str(actor.user_id),
        "actor_kind": "operator",
        "participant_scopes": ["operator"],
        "person_id": str(operator["person_id"]) if operator["person_id"] else None,
        "organisation_contacts": [],
        "role": operator["role"],
    }