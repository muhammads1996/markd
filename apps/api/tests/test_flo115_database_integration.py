import asyncio
import os
import sys
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from psycopg import AsyncConnection

from app.api.dependencies import (
    get_database,
    get_labour_command_actor,
    get_operator_actor,
)
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.integrations.database import Database
from app.main import create_app
from tests.test_flo130_database_integration import (
    LOCAL_SUPABASE_DB_URL,
    _cleanup,
    _provision_worker_assignment,
)

pytestmark = pytest.mark.asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@pytest.fixture
async def local_database() -> Database:
    database = Database(
        Settings(supabase_db_url=os.getenv("SUPABASE_DB_URL", LOCAL_SUPABASE_DB_URL))
    )
    try:
        await database.open()
        if not await database.check():
            pytest.skip("Local Supabase is unavailable; start it with `pnpm db:start`.")
    except Exception:
        await database.close()
        pytest.skip("Local Supabase is unavailable; start it with `pnpm db:start`.")
    try:
        yield database
    finally:
        await database.close()


async def _exception_state(database: Database, assignment_id: UUID) -> dict[str, Any]:
    async with database.service_transaction() as connection:
        result = await connection.execute(
            """
            select exception_case.id, exception_case.state::text,
                   exception_case.category, exception_case.recorded_by_user_id,
                   exception_case.resolution_outcome,
                   (select count(*)::integer from public.exception_claims claim
                    where claim.exception_case_id = exception_case.id) as claim_count
            from public.exception_cases exception_case
            where exception_case.assignment_id = %s
              and exception_case.category = 'payment_dispute'
            """,
            (assignment_id,),
        )
        case = await result.fetchone()
        assert case is not None
        return dict(case)


async def _cleanup_exceptions(
    database: Database, fixture: dict[str, UUID | str | None]
) -> None:
    connection = await AsyncConnection.connect(LOCAL_SUPABASE_DB_URL)
    try:
        async with connection.transaction():
            await connection.execute("set local session_replication_role = 'replica'")
            await connection.execute(
                """
                delete from public.exception_claims where exception_case_id in (
                  select id from public.exception_cases where assignment_id = %s
                )
                """,
                (fixture["assignment_id"],),
            )
            await connection.execute(
                "delete from public.exception_cases where assignment_id = %s",
                (fixture["assignment_id"],),
            )
            await connection.execute(
                "delete from public.assignment_stamps where assignment_id = %s",
                (fixture["assignment_id"],),
            )
            await connection.execute(
                """
                delete from public.workmark_corrections where workmark_id in (
                  select id from public.workmarks where assignment_id = %s
                )
                """,
                (fixture["assignment_id"],),
            )
            await connection.execute(
                "delete from public.workmarks where assignment_id = %s",
                (fixture["assignment_id"],),
            )
            await connection.execute(
                "delete from public.audit_events where operator_account_id = %s",
                (fixture["actor_id"],),
            )
            await connection.execute(
                "delete from public.operator_accounts where user_id = %s",
                (fixture["actor_id"],),
            )
    finally:
        await connection.close()
    await _cleanup(database, fixture)


async def test_flo115_preserves_bilateral_claims_history_and_workmark_evidence(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    assignment_id = UUID(str(fixture["assignment_id"]))
    actor_id = UUID(str(fixture["actor_id"]))
    worker_id = UUID(str(fixture["worker_id"]))
    actor = CurrentActor(
        user_id=actor_id,
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )
    application = create_app(Settings(supabase_db_url=LOCAL_SUPABASE_DB_URL))
    application.dependency_overrides[get_database] = lambda: local_database
    application.dependency_overrides[get_labour_command_actor] = lambda: actor

    try:
        async with local_database.service_transaction() as connection:
            await connection.execute(
                """
                update public.assignments
                set worker_response = 'accepted', contractor_confirmation = 'confirmed',
                    reporting_mode = 'site', reporting_place_text = 'Test site',
                    reporting_at = '2026-09-20T06:00:00Z',
                    travel_authorised_at = '2026-09-20T05:00:00Z',
                    cancelled_after_travel_authorised = true
                where id = %s
                """,
                (assignment_id,),
            )
            contact_result = await connection.execute(
                """
                select contact.person_id
                from public.assignments assignment
                join public.organisation_contacts contact
                  on contact.organisation_id = assignment.organisation_id
                 and contact.archived_at is null
                where assignment.id = %s order by contact.is_primary desc limit 1
                """,
                (assignment_id,),
            )
            contact = await contact_result.fetchone()
            assert contact is not None
            hirer_id = UUID(str(contact["person_id"]))

        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            stamp = await client.post(
                f"/api/v1/assignments/{assignment_id}/stamps",
                headers={"Idempotency-Key": f"flo115-stamp-{assignment_id}"},
                json={
                    "attendance": "attended",
                    "completion": "completed",
                    "payment": {"state": "unknown"},
                    "asserted_by": str(worker_id),
                    "asserted_role": "worker",
                },
            )
            assert stamp.status_code == 201, stamp.text
            workmark_id = UUID(stamp.json()["resource"]["id"])

            async with local_database.service_transaction() as connection:
                result = await connection.execute(
                    """
                    select version, evidence_state::text, attendance::text,
                           completion::text, payment::text
                    from public.workmarks where id = %s
                    """,
                    (workmark_id,),
                )
                workmark_before = dict(await result.fetchone())  # type: ignore[arg-type]

            open_payload = {
                "type": "payment_dispute",
                "summary": "Worker reports payment remains outstanding.",
                "statement": "I completed the work but have not been paid.",
                "assertion": {"payment": "unpaid"},
                "asserted_by": str(worker_id),
                "asserted_role": "worker",
                "source": "call",
                "workmark_id": str(workmark_id),
            }
            opened = await client.post(
                f"/api/v1/assignments/{assignment_id}/exceptions",
                headers={"Idempotency-Key": f"flo115-open-{assignment_id}"},
                json=open_payload,
            )
            replayed_open = await client.post(
                f"/api/v1/assignments/{assignment_id}/exceptions",
                headers={"Idempotency-Key": f"flo115-open-{assignment_id}"},
                json=open_payload,
            )
            assert opened.status_code == 201, opened.text
            assert replayed_open.headers["x-idempotent-replay"] == "true"
            exception_id = UUID(opened.json()["resource"]["id"])
            assert (await _exception_state(local_database, assignment_id))[
                "claim_count"
            ] == 1

            # The populated queue remains private to operators; this check uses
            # the fixture's worker participant account before it is promoted to
            # an operator for the rest of the command-flow assertions.
            participant_connection = await AsyncConnection.connect(
                LOCAL_SUPABASE_DB_URL
            )
            try:
                async with participant_connection.transaction():
                    await participant_connection.execute("set local role authenticated")
                    await participant_connection.execute(
                        "select set_config('request.jwt.claim.sub', %s, true)",
                        (str(actor_id),),
                    )
                    result = await participant_connection.execute(
                        "select count(*) from public.operator_exception_queue"
                    )
                    participant_count = await result.fetchone()
                    assert participant_count is not None
                    assert participant_count[0] == 0
            finally:
                await participant_connection.close()

            async with local_database.service_transaction() as connection:
                await connection.execute(
                    """
                    insert into public.operator_accounts(user_id, role)
                    values (%s, 'ops_user')
                    """,
                    (actor_id,),
                )

            counterclaim_payload = {
                "statement": "The worker was paid in full.",
                "assertion": {"payment": "paid"},
                "asserted_by": str(hirer_id),
                "asserted_role": "hirer",
                "source": "operator_ui",
            }
            claimed = await client.post(
                f"/api/v1/exceptions/{exception_id}/claims",
                headers={"Idempotency-Key": f"flo115-claim-{exception_id}"},
                json=counterclaim_payload,
            )
            replayed_claim = await client.post(
                f"/api/v1/exceptions/{exception_id}/claims",
                headers={"Idempotency-Key": f"flo115-claim-{exception_id}"},
                json=counterclaim_payload,
            )
            assert claimed.status_code == 201, claimed.text
            assert replayed_claim.headers["x-idempotent-replay"] == "true"

            resolution_payload = {
                "outcome": "payment_evidence_inconclusive",
                "reason": (
                    "Both attributable claims are retained pending external proof."
                ),
                "expected_version": 2,
                "evidence": {"reviewed_claims": 2},
            }
            resolved = await client.post(
                f"/api/v1/exceptions/{exception_id}/resolve",
                headers={"Idempotency-Key": f"flo115-resolve-{exception_id}"},
                json=resolution_payload,
            )
            replayed_resolution = await client.post(
                f"/api/v1/exceptions/{exception_id}/resolve",
                headers={"Idempotency-Key": f"flo115-resolve-{exception_id}"},
                json=resolution_payload,
            )
            assert resolved.status_code == 200, resolved.text
            assert replayed_resolution.headers["x-idempotent-replay"] == "true"

            closed_claim = await client.post(
                f"/api/v1/exceptions/{exception_id}/claims",
                headers={"Idempotency-Key": f"flo115-closed-{exception_id}"},
                json={"statement": "Late allegation", "asserted_role": "operator"},
            )
            assert closed_claim.status_code == 409

            for category, statement in (
                ("attendance_dispute", "Worker says they arrived; hirer says no-show."),
                (
                    "cancelled_after_travel_authorisation",
                    "Work was cancelled after travel approval.",
                ),
                ("ambiguous_completion", "The completion outcome remains ambiguous."),
            ):
                response = await client.post(
                    f"/api/v1/assignments/{assignment_id}/exceptions",
                    headers={"Idempotency-Key": f"flo115-{category}-{assignment_id}"},
                    json={
                        "type": category,
                        "summary": statement,
                        "statement": statement,
                        "asserted_by": str(worker_id),
                        "asserted_role": "worker",
                    },
                )
                assert response.status_code == 201, response.text

        state = await _exception_state(local_database, assignment_id)
        assert state == {
            "id": exception_id,
            "state": "resolved",
            "category": "payment_dispute",
            "recorded_by_user_id": actor_id,
            "resolution_outcome": "payment_evidence_inconclusive",
            "claim_count": 2,
        }
        async with local_database.service_transaction() as connection:
            claims_result = await connection.execute(
                """
                select asserted_by_person_id, recorded_by_user_id, asserted_role,
                       assertion, statement, source
                from public.exception_claims where exception_case_id = %s
                order by created_at, id
                """,
                (exception_id,),
            )
            claims = [dict(row) for row in await claims_result.fetchall()]
            workmark_result = await connection.execute(
                """
                select version, evidence_state::text, attendance::text,
                       completion::text, payment::text
                from public.workmarks where id = %s
                """,
                (workmark_id,),
            )
            workmark_after = dict(await workmark_result.fetchone())  # type: ignore[arg-type]
            category_result = await connection.execute(
                """
                select category from public.exception_cases
                where assignment_id = %s order by category
                """,
                (assignment_id,),
            )
            categories = {row["category"] for row in await category_result.fetchall()}
            event_result = await connection.execute(
                """
                select event_type, count(*)::integer as count
                from private.domain_events where aggregate_id = %s
                group by event_type
                """,
                (exception_id,),
            )
            events = {
                row["event_type"]: row["count"] for row in await event_result.fetchall()
            }
            audit_result = await connection.execute(
                """
                select changes::text as changes
                from public.audit_events
                where table_name in ('exception_cases', 'exception_claims')
                  and operator_account_id = %s
                """,
                (actor_id,),
            )
            exception_audits = [
                row["changes"] for row in await audit_result.fetchall()
            ]

        assert [
            (claim["asserted_role"], claim["asserted_by_person_id"]) for claim in claims
        ] == [
            ("worker", worker_id),
            ("hirer", hirer_id),
        ]
        assert all(claim["recorded_by_user_id"] == actor_id for claim in claims)
        assert claims[0]["assertion"] == {"payment": "unpaid"}
        assert claims[1]["assertion"] == {"payment": "paid"}
        assert workmark_after == workmark_before
        assert categories >= {
            "payment_dispute",
            "attendance_dispute",
            "cancelled_after_travel_authorisation",
            "ambiguous_completion",
        }
        assert events == {
            "exception.opened": 1,
            "exception.claim_added": 2,
            "exception.status_changed": 2,
            "exception.resolved": 1,
        }
        assert exception_audits
        assert all(
            "I completed the work but have not been paid." not in audit
            and "The worker was paid in full." not in audit
            and "evidence_refs" not in audit
            and "assertion" not in audit
            and "statement" not in audit
            for audit in exception_audits
        )

        async with local_database.read_transaction(
            actor_id, "flo115-operator-queue"
        ) as connection:
            queue_result = await connection.execute(
                """
                select state::text, claims, workmark_evidence, resolution_outcome
                from public.operator_exception_queue where exception_id = %s
                """,
                (exception_id,),
            )
            queue = await queue_result.fetchone()
        assert queue is not None
        assert queue["state"] == "resolved"
        assert len(queue["claims"]) == 2
        assert queue["workmark_evidence"]["id"] == str(workmark_id)
        async with local_database.read_transaction(
            actor_id, "flo115-assignment-workmark-fallback"
        ) as connection:
            fallback_result = await connection.execute(
                """
                select queue.workmark_evidence
                from public.operator_exception_queue queue
                where queue.assignment_id = %s
                  and queue.category = 'attendance_dispute'
                """,
                (assignment_id,),
            )
            fallback = await fallback_result.fetchone()
        assert fallback is not None
        assert fallback["workmark_evidence"]["id"] == str(workmark_id)

        # A case can rely on its Assignment Workmark evidence without pinning a
        # Workmark ID at open time. A FLO-114 correction for that Assignment
        # must still be referenceable by the terminal exception resolution.
        async with local_database.service_transaction() as connection:
            attendance_result = await connection.execute(
                """
                select id, version from public.exception_cases
                where assignment_id = %s and category = 'attendance_dispute'
                """,
                (assignment_id,),
            )
            attendance_case = await attendance_result.fetchone()
            workmark_version_result = await connection.execute(
                "select version from public.workmarks where id = %s",
                (workmark_id,),
            )
            workmark_version = await workmark_version_result.fetchone()
        assert attendance_case is not None
        assert workmark_version is not None
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            attendance_claim = await client.post(
                f"/api/v1/exceptions/{attendance_case['id']}/claims",
                headers={"Idempotency-Key": f"flo115-attendance-claim-{assignment_id}"},
                json={
                    "statement": "Ops recorded the attendance counterclaim.",
                    "asserted_role": "operator",
                },
            )
            assert attendance_claim.status_code == 201, attendance_claim.text
            correction = await client.post(
                f"/api/v1/workmarks/{workmark_id}/corrections",
                headers={"Idempotency-Key": f"flo115-correction-{assignment_id}"},
                json={
                    "reason": "Correction reviewed during attendance exception.",
                    "changes": {"payment_state": "paid"},
                    "expected_version": workmark_version["version"],
                },
            )
            assert correction.status_code == 200, correction.text
            resolved_fallback = await client.post(
                f"/api/v1/exceptions/{attendance_case['id']}/resolve",
                headers={
                    "Idempotency-Key": f"flo115-attendance-resolve-{assignment_id}"
                },
                json={
                    "outcome": "attendance_evidence_reviewed",
                    "reason": "The linked Assignment Workmark correction was reviewed.",
                    "expected_version": attendance_claim.json()["resource"]["version"],
                    "workmark_correction_id": correction.json()["correction_id"],
                },
            )
        assert resolved_fallback.status_code == 200, resolved_fallback.text
        async with local_database.service_transaction() as connection:
            fallback_resolution_result = await connection.execute(
                """
                select workmark_id, workmark_correction_id, state::text
                from public.exception_cases where id = %s
                """,
                (attendance_case["id"],),
            )
            fallback_resolution = await fallback_resolution_result.fetchone()
        assert fallback_resolution is not None
        assert fallback_resolution["workmark_id"] is None
        assert fallback_resolution["workmark_correction_id"] == UUID(
            correction.json()["correction_id"]
        )
        assert fallback_resolution["state"] == "resolved"
    finally:
        await _cleanup_exceptions(local_database, fixture)


async def test_flo115_whatsapp_payment_issue_uses_canonical_exception_command(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    assignment_id = UUID(str(fixture["assignment_id"]))
    actor_id = UUID(str(fixture["actor_id"]))
    worker_id = UUID(str(fixture["worker_id"]))
    marker = f"flo115-{fixture['test_id']}-payment"
    occurred_at = datetime(2026, 9, 20, 16, 0, tzinfo=UTC)
    operator_actor = CurrentActor(
        user_id=actor_id,
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )

    try:
        async with local_database.service_transaction() as connection:
            await connection.execute(
                """
                insert into public.operator_accounts(user_id, role)
                values (%s, 'ops_user')
                """,
                (actor_id,),
            )
            event_result = await connection.execute(
                """
                insert into public.channel_events(
                  channel, provider_event_id, provider_message_id,
                  sender_phone_number, event_type, occurred_at, payload
                )
                select 'whatsapp', %s, %s, phone_number, 'message', %s,
                       '{"text":"I have not been paid"}'::jsonb
                from public.person_phone_numbers
                where person_id = %s and archived_at is null and is_primary
                returning id
                """,
                (marker, f"{marker}-message", occurred_at, worker_id),
            )
            event = await event_result.fetchone()
            assert event is not None
            action_result = await connection.execute(
                """
                insert into public.proposed_actions(
                  channel_event_id, action_type, ambiguity, confidence,
                  entity_resolution, interpretation, model_provider, model_name,
                  payload, risk_tier
                ) values (
                  %s, 'payment_issue', 'clear', 0.91, '{}'::jsonb,
                  '{}'::jsonb, 'test-provider', 'test-model', %s::jsonb, 'trust'
                ) returning id
                """,
                (
                    event["id"],
                    '{"actionType":"payment_issue","fields":{},'
                    f'"entityIds":{{"workerId":"{worker_id}",'
                    f'"assertedById":"{worker_id}","assertedRole":"worker",'
                    f'"assignmentId":"{assignment_id}"}}}}',
                ),
            )
            action = await action_result.fetchone()
            assert action is not None
            action_id = UUID(str(action["id"]))

        application = create_app(Settings(supabase_db_url=LOCAL_SUPABASE_DB_URL))
        application.dependency_overrides[get_database] = lambda: local_database
        application.dependency_overrides[get_operator_actor] = lambda: operator_actor
        payload = {
            "payment_issue": {
                "assignment_id": str(assignment_id),
                "summary": "Worker reports payment remains outstanding.",
                "statement": "I completed the work but have not been paid.",
                "assertion": {"payment": "unpaid"},
                "asserted_by": str(worker_id),
                "asserted_role": "worker",
            }
        }
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            confirmed = await client.post(
                f"/api/v1/proposed-actions/{action_id}/confirm",
                headers={"Idempotency-Key": f"flo115-confirm-{action_id}"},
                json=payload,
            )
            replay = await client.post(
                f"/api/v1/proposed-actions/{action_id}/confirm",
                headers={"Idempotency-Key": f"flo115-confirm-{action_id}"},
                json=payload,
            )

        assert confirmed.status_code == 201, confirmed.text
        assert replay.status_code == 201, replay.text
        assert replay.headers["x-idempotent-replay"] == "true"
        async with local_database.service_transaction() as connection:
            evidence_result = await connection.execute(
                """
                select action.state::text, exception_case.state::text as case_state,
                       exception_case.source, exception_case.source_channel_event_id,
                       exception_case.source_proposed_action_id,
                       claim.source as claim_source, claim.asserted_role,
                       claim.asserted_by_person_id, claim.recorded_by_user_id,
                       claim.occurred_at,
                       count(*) over ()::integer as claim_count
                from public.proposed_actions action
                join public.exception_cases exception_case
                  on exception_case.source_proposed_action_id = action.id
                join public.exception_claims claim
                  on claim.exception_case_id = exception_case.id
                where action.id = %s
                """,
                (action_id,),
            )
            evidence = await evidence_result.fetchone()
        assert evidence is not None
        assert evidence["state"] == "executed"
        assert evidence["case_state"] == "open"
        assert evidence["source"] == "whatsapp"
        assert evidence["claim_source"] == "whatsapp"
        assert evidence["source_channel_event_id"] == event["id"]
        assert evidence["source_proposed_action_id"] == action_id
        assert evidence["asserted_role"] == "worker"
        assert evidence["asserted_by_person_id"] == worker_id
        assert evidence["recorded_by_user_id"] == actor_id
        assert evidence["occurred_at"] == occurred_at
        assert evidence["claim_count"] == 1
    finally:
        await _cleanup_exceptions(local_database, fixture)
