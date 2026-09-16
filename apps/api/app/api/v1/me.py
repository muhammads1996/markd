from typing import Any

from fastapi import APIRouter, Depends

from app.api.dependencies import get_labour_command_actor
from app.core.auth import CurrentActor

router = APIRouter(prefix="/me", tags=["Identity"])


@router.get("")
async def get_me(
    actor: CurrentActor = Depends(get_labour_command_actor),
) -> dict[str, Any]:
    operator = actor.claims.get("operator")
    participant_person_id = actor.claims.get("participant_person_id")
    contractor_contacts = actor.claims.get("contractor_contacts", [])
    response: dict[str, Any] = {
        "auth_user_id": str(actor.user_id),
        "person_id": (
            str(operator["person_id"])
            if operator is not None and operator["person_id"]
            else str(participant_person_id)
            if participant_person_id is not None
            else None
        ),
        "actor_kind": "operator" if operator is not None else "worker",
        "participant_scopes": [
            "worker",
            *(["contractor"] if contractor_contacts else []),
        ]
        if participant_person_id is not None
        else [],
        "organisation_contacts": contractor_contacts,
    }
    if operator is not None:
        response["role"] = operator["role"]
    return response