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


async def get_labour_command_actor(
    actor: CurrentActor = Depends(get_current_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> CurrentActor:
    async with database.read_transaction(actor.user_id, correlation_id) as connection:
        result = await connection.execute(
            """
                        select
                            (
                                select jsonb_build_object(
                                    'role', role::text, 'person_id', person_id
                                )
                                from public.operator_accounts
                                where user_id = %s and archived_at is null
                            ) as operator,
                            (
                                select person_id
                                from public.participant_accounts
                                where auth_user_id = %s and status = 'active'
              ) as participant_person_id,
                            exists(
                                select 1
                                from public.participant_account_scopes as scope
                                where scope.auth_user_id = %s
                                    and scope.scope_kind = 'worker'
                            ) as worker_scope,
                            coalesce((
                                select jsonb_agg(jsonb_build_object(
                                    'organisation_contact_id',
                                    scope.organisation_contact_id,
                                    'organisation_id', contact.organisation_id
                                ))
                                from public.participant_account_scopes as scope
                                join public.organisation_contacts as contact
                                    on contact.id = scope.organisation_contact_id
                                where scope.auth_user_id = %s
                                    and scope.scope_kind = 'contractor'
                                    and contact.archived_at is null
                            ), '[]'::jsonb) as contractor_contacts
                        """,
            (actor.user_id, actor.user_id, actor.user_id, actor.user_id),
        )
        resolved = await result.fetchone()
    if resolved is None or (
        resolved["operator"] is None and resolved["participant_person_id"] is None
    ):
        raise HTTPException(status_code=403, detail="An authorised actor is required")
    return CurrentActor(
        user_id=actor.user_id,
        claims={
            **actor.claims,
            "operator": resolved["operator"],
            "participant_person_id": resolved["participant_person_id"],
            "worker_scope": resolved["worker_scope"],
            "contractor_contacts": resolved["contractor_contacts"],
        },
    )
