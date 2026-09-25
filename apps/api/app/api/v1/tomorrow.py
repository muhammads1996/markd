# ruff: noqa: E501
# The SQL projection is kept in vertically aligned canonical-query form; wrapping
# SQL tokens mechanically makes the hot read path less reviewable.
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.dependencies import get_correlation_id, get_database, get_operator_actor
from app.core.auth import CurrentActor
from app.integrations.database import Database

router = APIRouter(prefix="/operator", tags=["Operator projections"])


class TomorrowSummary(BaseModel):
    labour_requests: int
    positions_required: int
    covered_positions: int
    open_positions: int
    travel_ready: int
    waiting_worker_response: int
    waiting_hirer_confirmation: int
    logistics_gap: int
    open_exceptions: int
    communication_failures: int
    review_required: int
    availability_conflicts: int


class TomorrowRequirement(BaseModel):
    id: UUID
    work_type: str
    required_headcount: int
    covered_headcount: int
    remaining_gap: int


class TomorrowExceptionEvidence(BaseModel):
    id: UUID
    category: str
    state: str
    created_at: datetime


class TomorrowCommunicationEvidence(BaseModel):
    id: UUID
    state: str
    message_kind: str
    failure_reason: str | None = None
    created_at: datetime


class TomorrowReviewEvidence(BaseModel):
    id: UUID
    action_type: str
    state: str
    original_text: str | None = None
    interpretation: dict[str, Any]
    confidence: float | None = None
    provider: str | None = None
    model: str | None = None
    semantic_mode: str | None = None
    policy_outcome: str | None = None
    policy_reason: str | None = None
    decision_provider: str | None = None
    model_version: str | None = None
    semantic_status: str | None = None


class TomorrowAssignment(BaseModel):
    id: UUID
    labour_requirement_id: UUID | None = None
    lifecycle: str
    offered_at: datetime | None = None
    worker_response: str
    contractor_confirmation: str
    travel_authorised_at: datetime | None = None
    agreed_rate_cents: int | None = None
    currency: str | None = None
    version: int
    reporting_mode: str | None = None
    reporting_place_text: str | None = None
    reporting_at: datetime | None = None
    reporting_time: str | None = None
    landmark: str | None = None
    instructions: str | None = None
    worker_name: str | None = None
    availability_status: str | None = None
    availability_conflict: bool
    worker_on_my_way: bool
    bucket: str
    travel_ready: bool
    blockers: list[str]
    has_open_exception: bool
    open_exceptions: list[TomorrowExceptionEvidence]
    communication_evidence: list[TomorrowCommunicationEvidence]
    failed_deliveries: list[TomorrowCommunicationEvidence]
    review_evidence: list[TomorrowReviewEvidence]


class TomorrowRequest(BaseModel):
    labour_request_id: UUID
    lifecycle: str
    hirer_name: str
    site_area: str | None = None
    site_text: str | None = None
    needed_at: time | None = None
    rate_cents: int | None = None
    currency: str | None = None
    terms: str | None = None
    timezone: str
    requirements: list[TomorrowRequirement]
    assignments: list[TomorrowAssignment]


class TomorrowReadModel(BaseModel):
    date: date
    summary: TomorrowSummary
    requests: list[TomorrowRequest]


async def _tomorrow_rows(connection: Any, target_date: date) -> list[dict[str, Any]]:
    """Read canonical fulfilment facts once; this deliberately stores no dashboard state."""
    result = await connection.execute(
        """
        with target as (
          select %s::date as work_date
        ), requests as (
          select lr.id, lr.lifecycle, lr.needed_from, lr.needed_to, lr.needed_at, lr.site_area,
                 lr.site_text, lr.rate_cents, lr.currency, lr.terms, lr.timezone,
                 coalesce(org.display_name, hirer.display_name, 'Unknown hirer') as hirer_name
          from public.labour_requests lr
          cross join target
          left join public.organisations org on org.id = lr.organisation_id
          left join public.people hirer on hirer.id = lr.requester_person_id
          where lr.archived_at is null
            and lr.needed_from <= target.work_date and lr.needed_to >= target.work_date
            and (
              lr.lifecycle = 'active'
              or (lr.lifecycle = 'cancelled' and exists (
                select 1 from public.assignments affected
                join private.domain_events domain_event
                  on domain_event.aggregate_type = 'labour_request'
                 and domain_event.aggregate_id = lr.id
                 and domain_event.event_type = 'labour_request.cancelled'
                left join public.channel_deliveries delivery
                  on delivery.idempotency_key = 'domain-event:' || domain_event.id::text || ':' || affected.id::text
                left join private.outbox_messages outbox on outbox.domain_event_id = domain_event.id
                where affected.labour_request_id = lr.id
                  and (delivery.state = 'failed' or (outbox.last_error is not null and outbox.state in ('pending', 'failed')))
              ))
            )
        ), assignment_event_ids as materialized (
          select domain_event.* from private.domain_events domain_event
          join public.assignments affected on affected.id = domain_event.aggregate_id
          join requests on requests.id = affected.labour_request_id
          where domain_event.aggregate_type = 'assignment'
            and domain_event.event_type in (
              'assignment.offered', 'assignment.travel_authorised',
              'assignment.travel_revoked', 'assignment.cancelled'
            )
            and affected.starts_on <= (select work_date from target)
            and affected.ends_on >= (select work_date from target)
        ), request_event_ids as materialized (
          select domain_event.* from private.domain_events domain_event
          join requests on requests.id = domain_event.aggregate_id
          where domain_event.aggregate_type = 'labour_request'
            and domain_event.event_type = 'labour_request.cancelled'
        ), requirement_counts as (
          select requirement.id, requirement.labour_request_id, requirement.work_type,
                 requirement.headcount,
                 least(requirement.headcount, count(assignment.id) filter (
                   where assignment.lifecycle = 'active'
                     and assignment.offered_at is not null
                     and assignment.worker_response <> 'declined'
                     and assignment.contractor_confirmation <> 'rejected'
                 ))::integer as covered_headcount
          from public.labour_requirements requirement
          join requests on requests.id = requirement.labour_request_id
          left join public.assignments assignment
            on assignment.labour_requirement_id = requirement.id
           and assignment.archived_at is null
           and assignment.starts_on <= (select work_date from target)
           and assignment.ends_on >= (select work_date from target)
          where requirement.archived_at is null
          group by requirement.id, requirement.labour_request_id, requirement.work_type, requirement.headcount
        ), assignment_rows as (
          select assignment.id, assignment.labour_request_id, assignment.labour_requirement_id,
                 assignment.lifecycle::text as lifecycle, assignment.offered_at,
                 assignment.worker_response::text as worker_response,
                 assignment.contractor_confirmation::text as contractor_confirmation,
                 assignment.travel_authorised_at, assignment.travel_revoked_at,
                 assignment.agreed_rate_cents, assignment.currency,
                 assignment.reporting_mode::text as reporting_mode,
                 assignment.reporting_place_text, assignment.reporting_at,
                 to_char(assignment.reporting_at at time zone coalesce(requests.timezone, 'Africa/Johannesburg'), 'HH24:MI') as reporting_time,
                 assignment.pickup_point_id, assignment.landmark, assignment.instructions,
                 assignment.contact, assignment.version,
                 worker.display_name as worker_name,
                 (
                   select signal.status from public.availability_signals signal
                   where signal.worker_id = assignment.worker_id
                     and signal.archived_at is null
                     and signal.available_from <= (select work_date from target)
                     and (signal.available_to is null or signal.available_to >= (select work_date from target))
                   order by signal.created_at desc, signal.id desc limit 1
                 ) as availability_status,
                 exists (
                   select 1 from public.assignment_acknowledgements acknowledgement
                   where acknowledgement.assignment_id = assignment.id
                     and acknowledgement.kind = 'on_my_way'
                 ) as worker_on_my_way,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', exception_case.id, 'category', exception_case.category,
                     'state', exception_case.state::text, 'created_at', exception_case.created_at
                   ) order by exception_case.created_at)
                   from public.exception_cases exception_case
                   where exception_case.assignment_id = assignment.id
                     and exception_case.archived_at is null
                     and exception_case.state in ('open', 'under_review')
                 ), '[]'::jsonb) as open_exceptions,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', evidence.id, 'state', evidence.state,
                     'message_kind', evidence.message_kind,
                     'failure_reason', evidence.failure_reason,
                     'created_at', evidence.created_at
                   ) order by evidence.created_at desc)
                   from (
                     select distinct on (domain_event.event_type)
                       delivery.id, delivery.state::text as state,
                       domain_event.event_type as message_kind,
                       delivery.failure_reason, delivery.created_at
                     from assignment_event_ids domain_event
                     join public.channel_deliveries delivery
                       on delivery.idempotency_key = 'domain-event:' || domain_event.id::text
                     where domain_event.aggregate_type = 'assignment'
                       and domain_event.aggregate_id = assignment.id
                       and domain_event.event_type in (
                         'assignment.offered', 'assignment.travel_authorised',
                         'assignment.travel_revoked', 'assignment.cancelled'
                       )
                     order by domain_event.event_type, domain_event.occurred_at desc
                   ) evidence
                 ), '[]'::jsonb) as communication_evidence,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', outbox.id, 'state', 'retrying',
                     'message_kind', domain_event.event_type,
                     'failure_reason', outbox.last_error,
                     'created_at', outbox.created_at
                   ) order by outbox.created_at desc)
                   from assignment_event_ids domain_event
                   join private.outbox_messages outbox on outbox.domain_event_id = domain_event.id
                   where domain_event.aggregate_type = 'assignment'
                     and domain_event.aggregate_id = assignment.id
                     and domain_event.event_type in (
                       'assignment.offered', 'assignment.travel_authorised',
                       'assignment.travel_revoked', 'assignment.cancelled'
                     )
                     and outbox.last_error is not null and outbox.state in ('pending', 'failed')
                     and not exists (
                       select 1 from public.channel_deliveries delivery
                       where delivery.idempotency_key = 'domain-event:' || domain_event.id::text
                     )
                 ), '[]'::jsonb) as outbox_followups,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', delivery.id, 'state', delivery.state::text,
                     'message_kind', domain_event.event_type,
                     'failure_reason', delivery.failure_reason,
                     'created_at', delivery.created_at
                   ) order by delivery.created_at desc)
                   from request_event_ids domain_event
                   join public.channel_deliveries delivery
                     on delivery.idempotency_key = 'domain-event:' || domain_event.id::text || ':' || assignment.id::text
                   where domain_event.aggregate_type = 'labour_request'
                     and domain_event.aggregate_id = assignment.labour_request_id
                     and domain_event.event_type = 'labour_request.cancelled'
                     and delivery.state = 'failed'
                 ), '[]'::jsonb) as request_cancellation_failures,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', outbox.id, 'state', 'retrying',
                     'message_kind', domain_event.event_type,
                     'failure_reason', outbox.last_error,
                     'created_at', outbox.created_at
                   ) order by outbox.created_at desc)
                   from request_event_ids domain_event
                   join private.outbox_messages outbox on outbox.domain_event_id = domain_event.id
                   where domain_event.aggregate_type = 'labour_request'
                     and domain_event.aggregate_id = assignment.labour_request_id
                     and domain_event.event_type = 'labour_request.cancelled'
                     and outbox.last_error is not null and outbox.state in ('pending', 'failed')
                     and not exists (
                       select 1 from public.channel_deliveries delivery
                       where delivery.idempotency_key = 'domain-event:' || domain_event.id::text || ':' || assignment.id::text
                     )
                 ), '[]'::jsonb) as request_cancellation_outbox_followups,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', action.id, 'action_type', action.action_type,
                     'state', action.state::text, 'payload', action.payload,
                     'channel_event_id', action.channel_event_id,
                     'original_text', coalesce(action.interpretation ->> 'originalText', action.interpretation ->> 'transcript'),
                     'interpretation', action.interpretation,
                     'confidence', action.confidence,
                     'provider', action.model_provider, 'model', action.model_name,
                     'semantic_mode', decision.mode::text,
                     'policy_outcome', decision.policy_outcome,
                     'policy_reason', decision.policy_reason,
                     'decision_provider', decision.decision_provider,
                     'model_version', decision.model_version,
                     'semantic_status', decision.status::text
                   ) order by action.created_at desc)
                   from public.proposed_actions action
                   left join lateral (
                     select semantic.* from public.semantic_decisions semantic
                     where semantic.proposed_action_id = action.id
                     order by semantic.created_at desc limit 1
                   ) decision on true
                   where action.archived_at is null and action.state = 'pending'
                     and (action.ambiguity = 'unresolved' or decision.policy_outcome in ('confirmation_or_ops', 'ops'))
                     and (
                       action.payload ->> 'assignment_id' = assignment.id::text
                       or action.payload #>> '{entityIds,assignmentId}' = assignment.id::text
                       or action.channel_event_id = assignment.source_channel_event_id
                     )
                 ), '[]'::jsonb) as review_evidence
          from public.assignments assignment
          join requests on requests.id = assignment.labour_request_id
          left join public.people worker on worker.id = assignment.worker_id
          where assignment.archived_at is null
            and assignment.starts_on <= (select work_date from target)
            and assignment.ends_on >= (select work_date from target)
        )
        select (select work_date from target) as work_date,
               request.id as labour_request_id, request.lifecycle, request.hirer_name, request.site_area,
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
        group by request.id, request.lifecycle, request.hirer_name, request.site_area, request.site_text,
                 request.needed_at, request.rate_cents, request.currency, request.terms, request.timezone
        order by request.needed_at nulls last, request.hirer_name
        """,
        (target_date,),
    )
    return [dict(row) for row in await result.fetchall()]


def _projection(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Classify canonical rows in the server read layer, never in the browser."""
    summary = {
        "labour_requests": 0, "positions_required": 0, "covered_positions": 0,
        "open_positions": 0,
        "travel_ready": 0, "waiting_worker_response": 0,
        "waiting_hirer_confirmation": 0, "logistics_gap": 0,
        "open_exceptions": 0, "communication_failures": 0, "review_required": 0,
        "availability_conflicts": 0,
    }
    for request in rows:
        requirements = request.get("requirements") or []
        assignments = request.get("assignments") or []
        if request.get("lifecycle", "active") == "active":
            summary["labour_requests"] += 1
            summary["positions_required"] += sum(item["required_headcount"] for item in requirements)
            summary["covered_positions"] += sum(item["covered_headcount"] for item in requirements)
            summary["open_positions"] += sum(item["remaining_gap"] for item in requirements)
        for assignment in assignments:
            active = assignment.get("lifecycle") == "active"
            logistics_complete = (
                assignment.get("reporting_mode") in {"site", "pickup"}
                and assignment.get("reporting_at") is not None
                and bool((assignment.get("reporting_place_text") or "").strip())
            )
            travel_ready = (
                active
                and assignment.get("travel_authorised_at") is not None
                and assignment.get("travel_revoked_at") is None
            )
            assignment["has_open_exception"] = bool(assignment.get("open_exceptions"))
            assignment["availability_conflict"] = (
                active and assignment.get("availability_status") == "unavailable"
            )
            if assignment["availability_conflict"]:
                summary["availability_conflicts"] += 1
            blockers: list[str] = []
            if active and assignment.get("worker_response") == "accepted" and not travel_ready:
                if assignment.get("contractor_confirmation") == "rejected":
                    blockers.append("Hirer rejected - replace worker")
                elif assignment.get("contractor_confirmation") != "confirmed":
                    blockers.append("Waiting for hirer confirmation")
                    summary["waiting_hirer_confirmation"] += 1
                if not logistics_complete:
                    blockers.append("Reporting or pickup details required")
                    summary["logistics_gap"] += 1
                if assignment.get("open_exceptions"):
                    blockers.append("Open operational exception")
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
            assignment["failed_deliveries"] = [
                evidence for evidence in assignment.get("communication_evidence") or []
                if evidence.get("state") == "failed"
            ] + (assignment.get("request_cancellation_failures") or []) \
                + (assignment.get("outbox_followups") or []) \
                + (assignment.get("request_cancellation_outbox_followups") or [])
            summary["open_exceptions"] += len(assignment.get("open_exceptions") or [])
            summary["communication_failures"] += len(assignment["failed_deliveries"])
            summary["review_required"] += len(assignment.get("review_evidence") or [])
    return {"summary": summary, "requests": rows}


@router.get("/tomorrow", response_model=TomorrowReadModel)
async def get_tomorrow(
    target_date: date | None = Query(default=None, alias="date"),
    actor: CurrentActor = Depends(get_operator_actor),
    database: Database = Depends(get_database),
    correlation_id: str = Depends(get_correlation_id),
) -> dict[str, Any]:
    """Private, derived Tomorrow projection. The date override is for controlled Ops/test navigation."""
    resolved_date = target_date or (
        datetime.now(ZoneInfo("Africa/Johannesburg")).date() + timedelta(days=1)
    )
    async with database.read_transaction(actor.user_id, correlation_id) as connection:
        rows = await _tomorrow_rows(connection, resolved_date)
    return {"date": resolved_date.isoformat(), **_projection(rows)}
