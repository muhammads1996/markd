"""Operator-controlled PWA access for existing Work Graph participants."""

from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.core.auth import CurrentActor
from app.core.config import Settings, get_settings
from app.integrations.database import Database

router = APIRouter(prefix="/participant-access", tags=["Participant access"])


class ProvisionInput(BaseModel):
    scope_kind: Literal["worker", "contractor"]
    subject_id: UUID


class ParticipantAccessResponse(BaseModel):
    person_id: UUID
    status: Literal["pending", "active", "disabled"]
    scope_kind: Literal["worker", "contractor"]
    phone_last_four: str


async def _create_auth_user(settings: Settings, phone: str, person_id: UUID) -> UUID:
    key = settings.supabase_service_role_key
    if not key:
        raise HTTPException(
            status_code=503, detail="Participant provisioning is not configured"
        )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                json={
                    "phone": phone,
                    "phone_confirm": False,
                    "app_metadata": {"markd_participant_person_id": str(person_id)},
                },
            )
            response.raise_for_status()
            return UUID(response.json()["id"])
    except (httpx.HTTPError, KeyError, ValueError) as error:
        # An Auth user may have been created even if the response was lost.
        # A retry resolves only an admin-tagged user for the same Person.
        raise HTTPException(
            status_code=503,
            detail="Participant Auth provisioning could not be confirmed",
        ) from error


@router.post("/provision", response_model=ParticipantAccessResponse)
async def provision_participant(
    input: ProvisionInput,
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
    settings: Settings = Depends(get_settings),
) -> ParticipantAccessResponse:
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=503, detail="Participant provisioning is not configured"
        )
    target_sql = (
        """
        select person.id as person_id, phone.phone_number as phone
        from public.worker_profiles as worker
        join public.people as person on person.id = worker.person_id
        join public.person_phone_numbers as phone on phone.person_id = person.id
        where worker.person_id = %s and worker.archived_at is null
          and person.archived_at is null and phone.is_primary
          and phone.archived_at is null
        for update of person
        """
        if input.scope_kind == "worker"
        else """
        select person.id as person_id, phone.phone_number as phone
        from public.organisation_contacts as contact
        join public.organisations as organisation
          on organisation.id = contact.organisation_id
        join public.people as person on person.id = contact.person_id
        join public.person_phone_numbers as phone on phone.person_id = person.id
        where contact.id = %s and contact.archived_at is null
          and organisation.archived_at is null and person.archived_at is null
          and phone.is_primary and phone.archived_at is null
        for update of person
        """
    )
    async with database.transaction(actor.user_id, correlation_id) as connection:
        result = await connection.execute(target_sql, (input.subject_id,))
        target = await result.fetchone()
        if target is None:
            raise HTTPException(
                status_code=404, detail="Active participant record or phone not found"
            )
        person_id = UUID(str(target["person_id"]))
        phone = str(target["phone"])
        result = await connection.execute(
            """select account.auth_user_id, account.status::text as status,
                      auth_user.phone as auth_phone
               from public.participant_accounts as account
               join auth.users as auth_user on auth_user.id = account.auth_user_id
               where account.person_id = %s for update of account""",
            (person_id,),
        )
        account = await result.fetchone()
        if account:
            auth_user_id = UUID(str(account["auth_user_id"]))
            if account["status"] == "disabled":
                raise HTTPException(status_code=409, detail="PWA account is disabled")
            if account["auth_phone"] and (
                str(account["auth_phone"]).lstrip("+") != phone.lstrip("+")
            ):
                raise HTTPException(
                    status_code=409, detail="PWA phone binding has changed"
                )
        else:
            result = await connection.execute(
                """select id, raw_app_meta_data from auth.users
                   where phone in (%s, ltrim(%s, '+')) for update""",
                (phone, phone),
            )
            existing_auth = await result.fetchone()
            if existing_auth:
                metadata = existing_auth["raw_app_meta_data"] or {}
                if metadata.get("markd_participant_person_id") != str(person_id):
                    raise HTTPException(
                        status_code=409,
                        detail="Phone already belongs to a different Auth account",
                    )
                auth_user_id = UUID(str(existing_auth["id"]))
            else:
                auth_user_id = await _create_auth_user(settings, phone, person_id)
            await connection.execute(
                """insert into public.participant_accounts(
                     auth_user_id, person_id, status, activation_requested_at
                   ) values (%s, %s, 'pending', timezone('utc', now()))""",
                (auth_user_id, person_id),
            )
            account = {"status": "pending"}
        await connection.execute(
            """insert into public.participant_account_scopes(
                 auth_user_id, scope_kind, organisation_contact_id
               ) values (%s, %s, %s) on conflict do nothing""",
            (
                auth_user_id,
                input.scope_kind,
                input.subject_id if input.scope_kind == "contractor" else None,
            ),
        )
    return ParticipantAccessResponse(
        person_id=person_id,
        status=account["status"],
        scope_kind=input.scope_kind,
        phone_last_four=phone[-4:],
    )


@router.post("/{person_id}/disable", status_code=204)
async def disable_participant(
    person_id: UUID,
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> None:
    async with database.transaction(actor.user_id, correlation_id) as connection:
        result = await connection.execute(
            """update public.participant_accounts set status = 'disabled'
               where person_id = %s and status <> 'disabled' returning auth_user_id""",
            (person_id,),
        )
        if await result.fetchone() is None:
            result = await connection.execute(
                "select 1 from public.participant_accounts where person_id = %s",
                (person_id,),
            )
            if await result.fetchone() is None:
                raise HTTPException(status_code=404, detail="PWA account not found")
