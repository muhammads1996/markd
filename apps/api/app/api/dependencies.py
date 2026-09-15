from fastapi import Depends, HTTPException, Request

from app.core.auth import CurrentActor, get_current_actor
from app.integrations.database import Database


def get_database(request: Request) -> Database:
    return request.app.state.database


def get_correlation_id(request: Request) -> str:
    return request.state.correlation_id


async def get_operator_actor(
    actor: CurrentActor = Depends(get_current_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> CurrentActor:
    async with database.read_transaction(actor.user_id, correlation_id) as connection:
        result = await connection.execute(
            """
            select user_id, role::text as role, person_id
            from public.operator_accounts
            where user_id = %s and archived_at is null
            """,
            (actor.user_id,),
        )
        operator = await result.fetchone()
    if operator is None:
        raise HTTPException(status_code=403, detail="An active operator is required")
    return CurrentActor(
        user_id=actor.user_id,
        claims={**actor.claims, "operator": dict(operator)},
    )