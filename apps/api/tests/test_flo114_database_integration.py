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
from app.integrations.language import ExtractedIntent
from app.main import create_app
from app.workers.whatsapp import _try_execute_worker_action
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


async def _closeout_state(database: Database, assignment_id: UUID) -> dict[str, Any]:
    async with database.service_transaction() as connection:
        result = await connection.execute(
            """
            select assignment.lifecycle, assignment.version as assignment_version,
                   workmark.id as workmark_id, workmark.version as workmark_version,
                   workmark.evidence_state::text,
                   workmark.lifecycle as workmark_lifecycle,
                   workmark.attendance::text, workmark.completion::text,
                   (select count(*) from public.assignment_stamps
                    where assignment_id = assignment.id)::integer as stamp_count
            from public.assignments as assignment
            left join public.workmarks as workmark
              on workmark.assignment_id = assignment.id
            where assignment.id = %s
            """,
            (assignment_id,),
        )
        row = await result.fetchone()
        assert row is not None
        return dict(row)


async def _make_travel_ready(database: Database, assignment_id: UUID) -> None:
    async with database.service_transaction() as connection:
        await connection.execute(
            """
            update public.assignments
            set worker_response = 'accepted', contractor_confirmation = 'confirmed',
                reporting_mode = 'site', reporting_place_text = 'Test site',
                reporting_at = '2026-09-20T06:00:00Z',
                travel_authorised_at = '2026-09-20T05:00:00Z'
            where id = %s
            """,
            (assignment_id,),
        )


async def _cleanup_closeout(
    database: Database, fixture: dict[str, UUID | str | None]
) -> None:
    assignment_id = fixture["assignment_id"]
    actor_id = fixture["actor_id"]
    connection = await AsyncConnection.connect(LOCAL_SUPABASE_DB_URL)
    try:
        async with connection.transaction():
            await connection.execute("set local session_replication_role = 'replica'")
            await connection.execute(
                """
                delete from private.outbox_messages
                where domain_event_id in (
                  select event.id from private.domain_events as event
                  join private.command_executions as command
                    on command.id = event.command_execution_id
                  where command.actor_user_id = %s
                )
                """,
                (actor_id,),
            )
            await connection.execute(
                """
                delete from private.domain_events
                where command_execution_id in (
                  select id from private.command_executions where actor_user_id = %s
                )
                """,
                (actor_id,),
            )
            await connection.execute(
                "delete from private.command_executions where actor_user_id = %s",
                (actor_id,),
            )
            await connection.execute(
                """
                delete from public.audit_events
                where actor_id = %s
                   or record_id = %s
                   or record_id in (
                     select id from public.workmarks where assignment_id = %s
                   )
                   or record_id in (
                     select action.id
                     from public.proposed_actions as action
                     join public.channel_events as event
                       on event.id = action.channel_event_id
                     where event.provider_event_id like %s
                   )
                """,
                (
                    actor_id,
                    assignment_id,
                    assignment_id,
                    f"flo114-{fixture['test_id']}%",
                ),
            )
            await connection.execute(
                """
                delete from public.workmark_corrections
                where workmark_id in (
                  select id from public.workmarks where assignment_id = %s
                )
                """,
                (assignment_id,),
            )
            await connection.execute(
                "delete from public.assignment_stamps where assignment_id = %s",
                (assignment_id,),
            )
            await connection.execute(
                "delete from public.workmarks where assignment_id = %s",
                (assignment_id,),
            )
            await connection.execute(
                """
                delete from public.proposed_actions
                where channel_event_id in (
                  select id from public.channel_events
                  where provider_event_id like %s
                )
                """,
                (f"flo114-{fixture['test_id']}%",),
            )
            await connection.execute(
                "delete from public.channel_events where provider_event_id like %s",
                (f"flo114-{fixture['test_id']}%",),
            )
            hirer_phone_id = fixture.get("hirer_phone_id")
            if hirer_phone_id is not None:
                await connection.execute(
                    "delete from public.person_phone_numbers where id = %s",
                    (hirer_phone_id,),
                )
    finally:
        await connection.close()
    await _cleanup(database, fixture)


async def test_flo114_reconciles_closeout_without_losing_conflict_or_history(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    assignment_id = UUID(str(fixture["assignment_id"]))
    await _make_travel_ready(local_database, assignment_id)
    actor_id = UUID(str(fixture["actor_id"]))
    worker_id = UUID(str(fixture["worker_id"]))
    async with local_database.service_transaction() as connection:
        result = await connection.execute(
            """
            select contact.person_id
            from public.assignments as assignment
            join public.organisation_contacts as contact
              on contact.organisation_id = assignment.organisation_id
             and contact.archived_at is null
            where assignment.id = %s
            order by contact.is_primary desc, contact.created_at
            limit 1
            """,
            (assignment_id,),
        )
        contact = await result.fetchone()
        assert contact is not None
        hirer_id = UUID(str(contact["person_id"]))

    worker_actor = CurrentActor(
        user_id=actor_id,
        claims={
            "participant_person_id": str(worker_id),
            "worker_scope": True,
            "contractor_contacts": [],
        },
    )
    operator_actor = CurrentActor(
        user_id=actor_id,
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )
    actor_box = {"actor": worker_actor}
    application = create_app(Settings(supabase_db_url=LOCAL_SUPABASE_DB_URL))
    application.dependency_overrides[get_database] = lambda: local_database
    application.dependency_overrides[get_labour_command_actor] = lambda: actor_box[
        "actor"
    ]

    try:
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            worker_payload = {
                "attendance": "attended",
                "completion": "completed",
                "reuse_preference": "yes",
                "payment": {"state": "unknown"},
                "expected_version": 1,
            }
            first = await client.post(
                f"/api/v1/assignments/{assignment_id}/stamps",
                headers={"Idempotency-Key": f"flo114-worker-{assignment_id}"},
                json=worker_payload,
            )
            replay = await client.post(
                f"/api/v1/assignments/{assignment_id}/stamps",
                headers={"Idempotency-Key": f"flo114-worker-{assignment_id}"},
                json=worker_payload,
            )
            assert first.status_code == 201, first.text
            assert replay.status_code == 201, replay.text
            assert replay.headers["x-idempotent-replay"] == "true"
            assert replay.json() == first.json()
            assert (await _closeout_state(local_database, assignment_id))[
                "stamp_count"
            ] == 1

            actor_box["actor"] = operator_actor
            conflicting = await client.post(
                f"/api/v1/assignments/{assignment_id}/stamps",
                headers={"Idempotency-Key": f"flo114-hirer-{assignment_id}"},
                json={
                    "attendance": "no_show",
                    "completion": "completed",
                    "payment": {"state": "unknown"},
                    "asserted_by": str(hirer_id),
                    "asserted_role": "hirer",
                    "expected_version": 1,
                },
            )
            assert conflicting.status_code == 201, conflicting.text
            state = await _closeout_state(local_database, assignment_id)
            assert state["stamp_count"] == 2
            assert state["evidence_state"] == "conflicted"
            assert state["attendance"] == "unknown"
            assert state["completion"] == "completed"
            assert state["lifecycle"] == "active"

            unrelated = await client.post(
                f"/api/v1/workmarks/{state['workmark_id']}/corrections",
                headers={"Idempotency-Key": f"flo114-payment-{assignment_id}"},
                json={
                    "reason": "Payment follow-up only",
                    "changes": {"payment_state": "pending"},
                    "expected_version": state["workmark_version"],
                },
            )
            assert unrelated.status_code == 200, unrelated.text
            state = await _closeout_state(local_database, assignment_id)
            assert state["lifecycle"] == "active"
            assert state["evidence_state"] == "conflicted"

            resolved = await client.post(
                f"/api/v1/workmarks/{state['workmark_id']}/corrections",
                headers={"Idempotency-Key": f"flo114-attendance-{assignment_id}"},
                json={
                    "reason": "Ops verified attendance from source evidence",
                    "changes": {"attendance": "attended"},
                    "expected_version": state["workmark_version"],
                },
            )
            assert resolved.status_code == 200, resolved.text

        state = await _closeout_state(local_database, assignment_id)
        assert state["lifecycle"] == "completed"
        assert state["workmark_lifecycle"] == "corrected"
        assert state["evidence_state"] == "operator_resolved"
        async with local_database.service_transaction() as connection:
            evidence = await connection.execute(
                """
                select asserted_role, asserted_by_person_id, recorded_by_user_id
                from public.assignment_stamps
                where assignment_id = %s
                order by created_at, id
                """,
                (assignment_id,),
            )
            rows = [dict(row) for row in await evidence.fetchall()]
            events = await connection.execute(
                """
                select event_type
                from private.domain_events
                where command_execution_id in (
                  select id from private.command_executions
                  where actor_user_id = %s
                )
                order by occurred_at, event_type
                """,
                (actor_id,),
            )
            event_types = [row["event_type"] for row in await events.fetchall()]
        assert rows == [
            {
                "asserted_role": "worker",
                "asserted_by_person_id": worker_id,
                "recorded_by_user_id": actor_id,
            },
            {
                "asserted_role": "hirer",
                "asserted_by_person_id": hirer_id,
                "recorded_by_user_id": actor_id,
            },
        ]
        assert event_types.count("workmark.created") == 1
        assert event_types.count("workmark.updated") == 1
        assert event_types.count("workmark.corrected") == 2
        assert event_types.count("assignment.completed") == 1
    finally:
        await _cleanup_closeout(local_database, fixture)


async def test_flo114_whatsapp_closeout_confirmation_uses_canonical_command(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    assignment_id = UUID(str(fixture["assignment_id"]))
    await _make_travel_ready(local_database, assignment_id)
    actor_id = UUID(str(fixture["actor_id"]))
    worker_id = UUID(str(fixture["worker_id"]))
    marker = f"flo114-{fixture['test_id']}-closeout"
    occurred_at = datetime(2026, 9, 20, 15, 30, tzinfo=UTC)
    operator_actor = CurrentActor(
        user_id=actor_id,
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )

    try:
        async with local_database.service_transaction() as connection:
            result = await connection.execute(
                """
                insert into public.channel_events(
                  channel, provider_event_id, provider_message_id,
                  sender_phone_number, event_type, occurred_at, payload
                )
                select 'whatsapp', %s, %s, phone_number, 'message', %s, '{}'::jsonb
                from public.person_phone_numbers
                where person_id = %s and archived_at is null and is_primary
                returning id, provider_message_id, occurred_at
                """,
                (marker, f"{marker}-message", occurred_at, worker_id),
            )
            event = await result.fetchone()
            assert event is not None
            event_record = dict(event)
            outcome, entity_ids = await _try_execute_worker_action(
                local_database,
                connection,
                event_record,
                ExtractedIntent(
                    "work_completion",
                    {"attendance": "attended", "completion": "completed"},
                    0.82,
                    "clear",
                ),
                str(event["id"]),
                exact_assignment_response=False,
            )
            assert outcome is None
            assert entity_ids == {
                "workerId": str(worker_id),
                "assertedById": str(worker_id),
                "assertedRole": "worker",
                "assignmentId": str(assignment_id),
            }
            proposed_result = await connection.execute(
                """
                insert into public.proposed_actions(
                  channel_event_id, action_type, ambiguity, confidence,
                  entity_resolution, interpretation, model_provider, model_name,
                  payload, risk_tier
                ) values (
                  %s, 'work_completion', 'clear', 0.82, '{}'::jsonb,
                  '{}'::jsonb, 'test-provider', 'test-model', %s::jsonb, 'trust'
                )
                returning id
                """,
                (
                    event["id"],
                    '{"actionType":"work_completion","fields":{},'
                    f'"entityIds":{{"workerId":"{worker_id}",'
                    f'"assignmentId":"{assignment_id}"}}}}',
                ),
            )
            proposed_action = await proposed_result.fetchone()
            assert proposed_action is not None
            action_id = UUID(str(proposed_action["id"]))

        application = create_app(Settings(supabase_db_url=LOCAL_SUPABASE_DB_URL))
        application.dependency_overrides[get_database] = lambda: local_database
        application.dependency_overrides[get_operator_actor] = lambda: operator_actor
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            payload = {
                "work_completion": {
                    "assignment_id": str(assignment_id),
                    "stamp": {
                        "attendance": "attended",
                        "completion": "completed",
                        "reuse_preference": "unknown",
                        "payment": {"state": "unknown"},
                        "asserted_by": str(worker_id),
                        "asserted_role": "worker",
                    },
                }
            }
            confirmed = await client.post(
                f"/api/v1/proposed-actions/{action_id}/confirm",
                headers={"Idempotency-Key": f"flo114-confirm-{action_id}"},
                json=payload,
            )
            replay = await client.post(
                f"/api/v1/proposed-actions/{action_id}/confirm",
                headers={"Idempotency-Key": f"flo114-confirm-{action_id}"},
                json=payload,
            )
        assert confirmed.status_code == 201, confirmed.text
        assert replay.status_code == 201, replay.text
        assert replay.headers["x-idempotent-replay"] == "true"
        async with local_database.service_transaction() as connection:
            result = await connection.execute(
                """
                select action.state::text, stamp.source,
                       stamp.source_channel_event_id,
                       stamp.source_proposed_action_id, stamp.occurred_at,
                       stamp.asserted_by_person_id, stamp.recorded_by_user_id,
                       count(*) over ()::integer as stamp_count
                from public.proposed_actions as action
                join public.assignment_stamps as stamp
                  on stamp.source_proposed_action_id = action.id
                where action.id = %s
                """,
                (action_id,),
            )
            evidence = await result.fetchone()
        assert evidence is not None
        assert evidence["state"] == "executed"
        assert evidence["source"] == "whatsapp"
        assert evidence["source_channel_event_id"] == event["id"]
        assert evidence["source_proposed_action_id"] == action_id
        assert evidence["occurred_at"] == occurred_at
        assert evidence["asserted_by_person_id"] == worker_id
        assert evidence["recorded_by_user_id"] == actor_id
        assert evidence["stamp_count"] == 1
    finally:
        await _cleanup_closeout(local_database, fixture)


async def test_flo114_whatsapp_hirer_closeout_resolves_attributable_assignment(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    assignment_id = UUID(str(fixture["assignment_id"]))
    await _make_travel_ready(local_database, assignment_id)
    hirer_phone_id = uuid4()
    fixture["hirer_phone_id"] = hirer_phone_id
    marker = f"flo114-{fixture['test_id']}-hirer-closeout"
    phone_number = f"+2784{str(hirer_phone_id.int)[-7:]}"

    try:
        async with local_database.service_transaction() as connection:
            contact_result = await connection.execute(
                """
                select contact.person_id, contact.organisation_id
                from public.assignments as assignment
                join public.organisation_contacts as contact
                  on contact.organisation_id = assignment.organisation_id
                 and contact.archived_at is null
                where assignment.id = %s
                order by contact.is_primary desc, contact.created_at
                limit 1
                """,
                (assignment_id,),
            )
            contact = await contact_result.fetchone()
            assert contact is not None
            await connection.execute(
                """
                insert into public.person_phone_numbers(
                  id, person_id, phone_number, is_primary
                ) values (%s, %s, %s, true)
                """,
                (hirer_phone_id, contact["person_id"], phone_number),
            )
            event_result = await connection.execute(
                """
                insert into public.channel_events(
                  channel, provider_event_id, provider_message_id,
                  sender_phone_number, event_type, occurred_at, payload
                ) values ('whatsapp', %s, %s, %s, 'message', %s, '{}'::jsonb)
                returning id, provider_message_id, occurred_at
                """,
                (
                    marker,
                    f"{marker}-message",
                    phone_number,
                    datetime(2026, 9, 20, 16, 0, tzinfo=UTC),
                ),
            )
            event = await event_result.fetchone()
            assert event is not None
            outcome, entity_ids = await _try_execute_worker_action(
                local_database,
                connection,
                dict(event),
                ExtractedIntent(
                    "work_completion",
                    {"attendance": "attended", "completion": "completed"},
                    0.87,
                    "clear",
                ),
                str(event["id"]),
                exact_assignment_response=False,
            )

        assert outcome is None
        assert entity_ids == {
            "assertedById": str(contact["person_id"]),
            "assertedRole": "hirer",
            "organisationId": str(contact["organisation_id"]),
            "assignmentId": str(assignment_id),
        }
    finally:
        await _cleanup_closeout(local_database, fixture)
