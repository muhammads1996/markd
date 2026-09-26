from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import ValidationError

from app.messaging.templates import (
    ApprovedTemplatePayload,
    Locale,
    build_template_payload,
)


async def verify_template_facts(
    connection: Any,
    payload: ApprovedTemplatePayload,
    source_record_id: UUID | None,
    recipient_phone_number: str,
    fallback_locale: Locale,
) -> None:
    if source_record_id is None:
        raise HTTPException(422, "Template delivery requires a canonical source record")
    if payload.key == "payment_followup":
        result = await connection.execute(
            """
            select mark.work_started_on as work_date, mark.payment::text,
                   mark.amount_cents as amount_minor, mark.currency,
                   phone.phone_number, language.code as preferred_language_code
            from public.workmarks mark
            join public.people worker on worker.id = mark.worker_id
            left join public.languages language
              on language.id = worker.preferred_language_id
            left join public.person_phone_numbers phone
              on phone.person_id = worker.id and phone.is_primary
             and phone.archived_at is null
            where mark.id = %s::uuid and mark.archived_at is null
            for update of mark
            """,
            (source_record_id,),
        )
    elif payload.key == "exception_followup":
        result = await connection.execute(
            """
            select exception_case.id as case_reference,
                   phone.phone_number, language.code as preferred_language_code
            from public.exception_cases exception_case
            join public.assignments assignment
              on assignment.id = exception_case.assignment_id
            join public.people worker on worker.id = assignment.worker_id
            left join public.languages language
              on language.id = worker.preferred_language_id
            left join public.person_phone_numbers phone
              on phone.person_id = worker.id and phone.is_primary
             and phone.archived_at is null
            where exception_case.id = %s::uuid
            for update of exception_case
            """,
            (source_record_id,),
        )
    else:
        result = await connection.execute(
            """
            select assignment.starts_on as work_date,
                   assignment.reporting_at, assignment.reporting_place_text,
                   assignment.reporting_mode, assignment.lifecycle,
                   assignment.worker_response, assignment.offered_at,
                   assignment.travel_authorised_at,
                   assignment.travel_revoked_at,
                   request.site_area, request.timezone,
                   phone.phone_number, language.code as preferred_language_code
            from public.assignments assignment
            join public.labour_requests request
              on request.id = assignment.labour_request_id
            join public.people worker on worker.id = assignment.worker_id
            left join public.languages language
              on language.id = worker.preferred_language_id
            left join public.person_phone_numbers phone
              on phone.person_id = worker.id and phone.is_primary
             and phone.archived_at is null
            where assignment.id = %s::uuid and assignment.archived_at is null
            for update of assignment, request, worker
            """,
            (source_record_id,),
        )
    row = await result.fetchone()
    if row is None or row["phone_number"] != recipient_phone_number:
        raise HTTPException(422, "Template source or recipient is invalid")
    if payload.key == "payment_followup" and row["payment"] != "unpaid":
        raise HTTPException(422, "Workmark does not have unpaid payment state")
    if payload.key == "assignment_offer_do_not_travel" and not (
        row["lifecycle"] == "active"
        and row["offered_at"] is not None
        and row["worker_response"] == "pending"
    ):
        raise HTTPException(422, "Assignment is not awaiting an offer response")
    if payload.key == "assignment_accepted_waiting" and not (
        row["lifecycle"] == "active"
        and row["worker_response"] == "accepted"
        and row["travel_authorised_at"] is None
    ):
        raise HTTPException(422, "Assignment is not waiting for travel authorisation")
    if payload.key in {"assignment_travel_ready", "pickup_reminder"} and not (
        row["lifecycle"] == "active"
        and row["travel_authorised_at"] is not None
        and row["travel_revoked_at"] is None
    ):
        raise HTTPException(422, "Assignment travel is not authorised")
    if payload.key == "pickup_reminder" and row["reporting_mode"] != "pickup":
        raise HTTPException(422, "Assignment has no pickup")
    if payload.key == "assignment_changed" and not (
        row["lifecycle"] == "active" and row["travel_authorised_at"] is None
    ):
        raise HTTPException(
            422, "Assignment is not waiting for updated travel instructions"
        )
    if payload.key == "assignment_cancelled" and row["lifecycle"] != "cancelled":
        raise HTTPException(422, "Assignment is not cancelled")

    language = row["preferred_language_code"]
    locale: Locale = language if language in {"en", "af", "xh"} else fallback_locale
    if payload.key == "assignment_offer_do_not_travel":
        variables: dict[str, Any] = {
            "work_date": row["work_date"],
            "site_area": row["site_area"],
        }
    elif payload.key in {
        "assignment_accepted_waiting",
        "assignment_changed",
        "assignment_cancelled",
    }:
        variables = {"work_date": row["work_date"]}
    elif payload.key in {"assignment_travel_ready", "pickup_reminder"}:
        reporting_at = row["reporting_at"]
        timezone = row["timezone"]
        if not isinstance(reporting_at, datetime) or not isinstance(timezone, str):
            raise HTTPException(422, "Assignment reporting facts are incomplete")
        try:
            local_reporting_at = reporting_at.astimezone(ZoneInfo(timezone))
        except ZoneInfoNotFoundError as error:
            raise HTTPException(422, "Labour request timezone is invalid") from error
        variables = {
            "reporting_at": local_reporting_at,
            "reporting_place_text": row["reporting_place_text"],
        }
    elif payload.key == "payment_followup":
        variables = {
            "work_date": row["work_date"],
            "amount_minor": row["amount_minor"],
            "currency": row["currency"],
        }
    else:
        variables = {"case_reference": str(row["case_reference"])}
    try:
        expected = build_template_payload(payload.key, locale, variables)
    except (ValidationError, ValueError) as error:
        raise HTTPException(422, "Canonical template facts are incomplete") from error
    if expected.model_dump(mode="json") != payload.model_dump(mode="json"):
        raise HTTPException(422, "Template values do not match canonical facts")
