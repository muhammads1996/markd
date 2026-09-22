# ruff: noqa: E501
# The SQL projection is kept in vertically aligned canonical-query form; wrapping
# SQL tokens mechanically makes the hot read path less reviewable.
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.core.auth import CurrentActor
from app.integrations.database import Database

router = APIRouter(prefix="/operator", tags=["Operator projections"])


async def _tomorrow_rows(connection: Any, target_date: date | None) -> list[dict[str, Any]]:
    """Read canonical fulfilment facts once; this deliberately stores no dashboard state."""
    result = await connection.execute(
        """
        with target as (
          select coalesce(%s::date, (timezone('Africa/Johannesburg', now())::date + 1)) as work_date
        ), requests as (
          select lr.id, lr.needed_from, lr.needed_to, lr.needed_at, lr.site_area,
                 lr.site_text, lr.rate_cents, lr.currency, lr.terms, lr.timezone,
                 coalesce(org.display_name, hirer.display_name, 'Unknown hirer') as hirer_name
          from public.labour_requests lr
          cross join target
          left join public.organisations org on org.id = lr.organisation_id
          left join public.people hirer on hirer.id = lr.requester_person_id
          where lr.archived_at is null and lr.lifecycle = 'active'
            and lr.needed_from <= target.work_date and lr.needed_to >= target.work_date
        ), requirement_counts as (
          select requirement.id, requirement.labour_request_id, requirement.work_type,
                 requirement.headcount,
                 count(assignment.id) filter (
                   where assignment.lifecycle = 'active'
                     and assignment.worker_response = 'accepted'
                     and not exists (
                       select 1 from public.exception_cases exception_case
                       where exception_case.assignment_id = assignment.id
                         and exception_case.archived_at is null
                         and exception_case.state in ('open', 'under_review')
                     )
                 )::integer as covered_headcount
          from public.labour_requirements requirement
          join requests on requests.id = requirement.labour_request_id
          left join public.assignments assignment
            on assignment.labour_requirement_id = requirement.id
           and assignment.archived_at is null
          where requirement.archived_at is null
          group by requirement.id, requirement.labour_request_id, requirement.work_type, requirement.headcount
        ), assignment_rows as (
          select assignment.id, assignment.labour_request_id, assignment.labour_requirement_id,
                 assignment.lifecycle::text as lifecycle, assignment.offered_at,
                 assignment.worker_response::text as worker_response,
                 assignment.contractor_confirmation::text as contractor_confirmation,
                 assignment.travel_authorised_at, assignment.travel_revoked_at,
                 assignment.reporting_mode::text as reporting_mode,
                 assignment.reporting_place_text, assignment.reporting_at,
                 to_char(assignment.reporting_at at time zone coalesce(requests.timezone, 'Africa/Johannesburg'), 'HH24:MI') as reporting_time,
                 assignment.pickup_point_id, assignment.landmark, assignment.instructions,
                 assignment.contact, assignment.version,
                 worker.display_name as worker_name,
                 exists (
                   select 1 from public.exception_cases exception_case
                   where exception_case.assignment_id = assignment.id
                     and exception_case.archived_at is null
                     and exception_case.state in ('open', 'under_review')
                 ) as has_open_exception,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', outbox.id, 'state', outbox.state,
                     'message_kind', domain_event.event_type,
                     'failure_reason', outbox.last_error,
                     'created_at', outbox.created_at
                   ) order by outbox.created_at desc)
                   from private.outbox_messages outbox
                   join private.domain_events domain_event on domain_event.id = outbox.domain_event_id
                   where domain_event.aggregate_type = 'assignment'
                     and domain_event.aggregate_id = assignment.id
                     and outbox.state = 'failed'
                 ), '[]'::jsonb) as failed_deliveries,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', action.id, 'action_type', action.action_type,
                     'state', action.state::text, 'payload', action.payload,
                     'channel_event_id', action.channel_event_id,
                     'original_text', coalesce(event.payload ->> 'text', event.payload ->> 'body'),
                     'interpretation', action.interpretation,
                     'confidence', action.confidence,
                     'provider', action.model_provider, 'model', action.model_name,
                     'semantic_mode', decision.mode::text,
                     'policy_outcome', decision.policy_outcome,
                     'policy_reason', decision.policy_reason,
                     'decision_provider', decision.decision_provider,
                     'model_version', decision.model_version
                   ) order by action.created_at desc)
                   from public.proposed_actions action
                   left join public.semantic_decisions decision on decision.proposed_action_id = action.id
                   left join public.channel_events event on event.id = action.channel_event_id
                   where action.archived_at is null and action.state = 'pending'
                     and (action.ambiguity = 'unresolved' or decision.policy_outcome in ('confirmation_or_ops', 'ops'))
                     and (
                       action.payload ->> 'assignment_id' = assignment.id::text
                       or action.channel_event_id = assignment.source_channel_event_id
                     )
                 ), '[]'::jsonb) as review_evidence
          from public.assignments assignment
          join requests on requests.id = assignment.labour_request_id
          left join public.people worker on worker.id = assignment.worker_id
          where assignment.archived_at is null
        )
        select (select work_date from target) as work_date,
               request.id as labour_request_id, request.hirer_name, request.site_area,
               request.site_text, request.needed_at, request.rate_cents, request.currency,
               request.terms, request.timezone,
               coalesce(jsonb_agg(distinct jsonb_build_object(
                 'id', requirement_counts.id, 'work_type', requirement_counts.work_type,
                 'required_headcount', requirement_counts.headcount,
                 'covered_headcount', requirement_counts.covered_headcount,
                 'remaining_gap', greatest(requirement_counts.headcount - requirement_counts.covered_headcount, 0)
               )) filter (where requirement_counts.id is not null), '[]'::jsonb) as requirements,
               coalesce(jsonb_agg(distinct to_jsonb(assignment_rows)) filter (where assignment_rows.id is not null), '[]'::jsonb) as assignments
        from requests request
        left join requirement_counts on requirement_counts.labour_request_id = request.id
        left join assignment_rows on assignment_rows.labour_request_id = request.id
        group by request.id, request.hirer_name, request.site_area, request.site_text,
                 request.needed_at, request.rate_cents, request.currency, request.terms, request.timezone
        order by request.needed_at nulls last, request.hirer_name
        """,
        (target_date,),
    )
    return [dict(row) for row in await result.fetchall()]


def _projection(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Classify canonical rows in the server read layer, never in the browser."""
    summary = {
        "labour_requests": len(rows), "positions_required": 0, "covered_positions": 0,
        "travel_ready": 0, "waiting_worker_response": 0,
        "waiting_hirer_confirmation": 0, "logistics_gap": 0,
        "open_exceptions": 0, "communication_failures": 0, "review_required": 0,
    }
    for request in rows:
        requirements = request.get("requirements") or []
        assignments = request.get("assignments") or []
        summary["positions_required"] += sum(item["required_headcount"] for item in requirements)
        summary["covered_positions"] += sum(item["covered_headcount"] for item in requirements)
        for assignment in assignments:
            active = assignment.get("lifecycle") == "active"
            logistics_complete = (
                assignment.get("reporting_mode") in {"site", "pickup"}
                and assignment.get("reporting_at") is not None
                and (
                    assignment.get("reporting_place_text") is not None
                    or assignment.get("pickup_point_id") is not None
                )
            )
            travel_ready = (
                active
                and assignment.get("travel_authorised_at") is not None
                and assignment.get("travel_revoked_at") is None
            )
            blockers: list[str] = []
            if active and assignment.get("worker_response") == "accepted" and not travel_ready:
                if assignment.get("contractor_confirmation") != "confirmed":
                    blockers.append("Waiting for hirer confirmation")
                    summary["waiting_hirer_confirmation"] += 1
                if not logistics_complete:
                    blockers.append("Reporting or pickup details required")
                    summary["logistics_gap"] += 1
                if not blockers:
                    blockers.append("Travel authorisation required")
                bucket = "accepted_waiting"
            elif active and assignment.get("offered_at") is not None and assignment.get("worker_response") in {"pending", "call_me"}:
                bucket = "awaiting_worker_response"
                summary["waiting_worker_response"] += 1
            elif travel_ready:
                bucket = "travel_ready"
                summary["travel_ready"] += 1
            elif assignment.get("lifecycle") == "cancelled":
                bucket = "cancelled"
            else:
                bucket = "informational"
            assignment["bucket"] = bucket
            assignment["travel_ready"] = travel_ready
            assignment["blockers"] = blockers
            assignment["logistics_complete"] = logistics_complete
            if assignment.get("has_open_exception"):
                summary["open_exceptions"] += 1
            summary["communication_failures"] += len(assignment.get("failed_deliveries") or [])
            summary["review_required"] += len(assignment.get("review_evidence") or [])
    return {"summary": summary, "requests": rows}


@router.get("/tomorrow")
async def get_tomorrow(
    target_date: date | None = Query(default=None, alias="date"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> dict[str, Any]:
    """Private, derived Tomorrow projection. The date override is for controlled Ops/test navigation."""
    async with database.read_transaction(actor.user_id, correlation_id) as connection:
        rows = await _tomorrow_rows(connection, target_date)
    resolved_date = target_date or (
        datetime.now(ZoneInfo("Africa/Johannesburg")).date() + timedelta(days=1)
    )
    return {"date": resolved_date.isoformat(), **_projection(rows)}
