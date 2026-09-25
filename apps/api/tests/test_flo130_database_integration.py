import asyncio
import os
import sys
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.api.v1.availability import (
    SetWorkerAvailabilityInput,
    set_worker_availability_mutation,
)
from app.api.v1.labour_requests import (
    RespondToAssignmentInput,
    respond_to_assignment_mutation,
)
from app.application.channel_actors import resolve_channel_principal
from app.application.dispatcher import execute_command
from app.core.auth import CurrentActor
from app.core.config import Settings
from app.integrations.database import Database
from app.integrations.language import ExtractedIntent
from app.workers.whatsapp import _try_execute_worker_action, run_command_outbox_jobs

LOCAL_SUPABASE_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

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


async def _fetchone(
    connection: Any, query: str, params: tuple[Any, ...]
) -> dict[str, Any]:
    result = await connection.execute(query, params)
    row = await result.fetchone()
    assert row is not None
    return dict(row)


async def _provision_worker_assignment(
    database: Database, test_id: UUID
) -> dict[str, UUID | str | None]:
    worker_id = uuid4()
    actor_id = uuid4()
    organisation_id = uuid4()
    contact_person_id = uuid4()
    contact_id = uuid4()
    labour_request_id = uuid4()
    labour_requirement_id = uuid4()
    assignment_id = uuid4()
    phone_id = uuid4()
    scope_id = uuid4()
    instance_id = uuid4()
    marker = f"flo130-{test_id}"
    phone_number = f"+278{test_id.int % 10**9:09d}"

    async with database.service_transaction() as connection:
        result = await connection.execute(
            """
            select id from auth.instances
            order by created_at asc nulls last, id asc
            limit 1
            """
        )
        instance = await result.fetchone()
        if instance is None:
            await connection.execute(
                """
                insert into auth.instances (id, uuid, raw_base_config)
                values (%s, %s, '{}'::jsonb)
                """,
                (instance_id, str(instance_id)),
            )
            selected_instance_id = instance_id
            created_instance_id: UUID | None = instance_id
        else:
            selected_instance_id = UUID(str(instance["id"]))
            created_instance_id = None

        await connection.execute(
            """
            insert into auth.users (
              instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data
                        ) values (
                            %s, %s, 'authenticated', 'authenticated', %s,
                            '{}'::jsonb, '{}'::jsonb
                        )
            """,
            (selected_instance_id, actor_id, f"{marker}@example.test"),
        )
        await connection.execute(
            "insert into public.people (id, display_name) values (%s, %s)",
            (worker_id, f"Worker {marker}"),
        )
        await connection.execute(
            "insert into public.worker_profiles (person_id) values (%s)",
            (worker_id,),
        )
        await connection.execute(
            """
                        insert into public.person_phone_numbers (
                            id, person_id, phone_number, is_primary
                        )
            values (%s, %s, %s, true)
            """,
            (phone_id, worker_id, phone_number),
        )
        await connection.execute(
            """
            insert into public.participant_accounts (auth_user_id, person_id, status)
            values (%s, %s, 'active')
            """,
            (actor_id, worker_id),
        )
        await connection.execute(
            """
            insert into public.participant_account_scopes (id, auth_user_id, scope_kind)
            values (%s, %s, 'worker')
            """,
            (scope_id, actor_id),
        )
        await connection.execute(
            "insert into public.people (id, display_name) values (%s, %s)",
            (contact_person_id, f"Contact {marker}"),
        )
        await connection.execute(
            """
            insert into public.organisations (id, legal_name, display_name)
            values (%s, %s, %s)
            """,
            (organisation_id, f"Organisation {marker}", f"Organisation {marker}"),
        )
        await connection.execute(
            """
            insert into public.organisation_contacts (
              id, organisation_id, person_id, is_primary
            ) values (%s, %s, %s, true)
            """,
            (contact_id, organisation_id, contact_person_id),
        )
        await connection.execute(
            """
            insert into public.labour_requests (
              id, organisation_id, requested_by_contact_id, needed_from, needed_to,
              headcount, rate_cents, currency, source, site_area, lifecycle
                        ) values (
                            %s, %s, %s, %s, %s, 1, 25000, 'ZAR', 'test',
                            'Test area', 'active'
                        )
            """,
            (
                labour_request_id,
                organisation_id,
                contact_id,
                date(2026, 9, 20),
                date(2026, 9, 20),
            ),
        )
        await connection.execute(
            """
            insert into public.labour_requirements (
              id, labour_request_id, headcount, work_type
            ) values (%s, %s, 1, 'General labour')
            """,
            (labour_requirement_id, labour_request_id),
        )
        await connection.execute(
            """
            insert into public.assignments (
              id, labour_request_id, labour_requirement_id, worker_id, organisation_id,
              starts_on, ends_on, lifecycle, offered_at, source
                        ) values (
                            %s, %s, %s, %s, %s, %s, %s, 'active',
                            timezone('utc', now()), 'test'
                        )
            """,
            (
                assignment_id,
                labour_request_id,
                labour_requirement_id,
                worker_id,
                organisation_id,
                date(2026, 9, 20),
                date(2026, 9, 20),
            ),
        )

    return {
        "actor_id": actor_id,
        "assignment_id": assignment_id,
        "created_instance_id": created_instance_id,
        "phone_id": phone_id,
        "phone_number": phone_number,
        "test_id": str(test_id),
        "worker_id": worker_id,
    }


async def _cleanup(database: Database, fixture: dict[str, UUID | str | None]) -> None:
    marker = f"flo130-{fixture['test_id']}"
    async with database.service_transaction() as connection:
        await connection.execute(
            """
            delete from public.channel_processing_jobs
            where channel_event_id in (
              select id from public.channel_events where provider_event_id like %s
            )
            """,
            (f"{marker}%",),
        )
        await connection.execute(
            """
            delete from public.channel_deliveries
            where idempotency_key in (
              select 'domain-event:' || event.id::text
              from private.domain_events as event
              join private.command_executions as command
                on command.id = event.command_execution_id
              where command.actor_user_id = %s
            )
            """,
            (fixture["actor_id"],),
        )
        await connection.execute(
            """
            delete from private.outbox_messages
            where domain_event_id in (
              select event.id
              from private.domain_events as event
              join private.command_executions as command
                on command.id = event.command_execution_id
              where command.actor_user_id = %s
            )
            """,
            (fixture["actor_id"],),
        )
        await connection.execute(
            """
            delete from private.domain_events
            where command_execution_id in (
              select id from private.command_executions where actor_user_id = %s
            )
            """,
            (fixture["actor_id"],),
        )
        await connection.execute(
            "delete from private.command_executions where actor_user_id = %s",
            (fixture["actor_id"],),
        )
        await connection.execute(
            """
            delete from private.outbox_messages
            where domain_event_id in (
              select event.id from private.domain_events as event
              join private.command_executions as command
                on command.id = event.command_execution_id
              join public.channel_events as source
                on source.id = command.source_channel_event_id
              where source.provider_event_id like %s
            )
            """,
            (f"{marker}%",),
        )
        await connection.execute(
            """
            delete from private.domain_events
            where command_execution_id in (
              select command.id from private.command_executions as command
              join public.channel_events as source
                on source.id = command.source_channel_event_id
              where source.provider_event_id like %s
            )
            """,
            (f"{marker}%",),
        )
        await connection.execute(
            """
            delete from private.command_executions
            where source_channel_event_id in (
              select id from public.channel_events where provider_event_id like %s
            )
            """,
            (f"{marker}%",),
        )
        await connection.execute(
            "delete from public.availability_signals where worker_id = %s",
            (fixture["worker_id"],),
        )
        await connection.execute(
            "delete from public.assignments where id = %s",
            (fixture["assignment_id"],),
        )
        await connection.execute(
            """
            delete from public.labour_requirements
            where labour_request_id in (
              select id from public.labour_requests where source = 'test'
                and organisation_id in (
                  select id from public.organisations where legal_name = %s
                )
            )
            """,
            (f"Organisation {marker}",),
        )
        await connection.execute(
            """
            delete from public.labour_requests
            where source = 'test' and organisation_id in (
              select id from public.organisations where legal_name = %s
            )
            """,
            (f"Organisation {marker}",),
        )
        await connection.execute(
            """
            update public.organisation_contacts as contact
            set archived_at = timezone('utc', now())
            where contact.organisation_id in (
              select id from public.organisations where legal_name = %s
            )
            and exists (
              select 1 from private.channel_actor_evidence as evidence
              where evidence.organisation_contact_id = contact.id
            )
            """,
            (f"Organisation {marker}",),
        )
        await connection.execute(
            """
            delete from public.organisation_contacts as contact
            where contact.organisation_id in (
              select id from public.organisations where legal_name = %s
            ) and not exists (
              select 1 from private.channel_actor_evidence as evidence
              where evidence.organisation_contact_id = contact.id
            )
            """,
            (f"Organisation {marker}",),
        )
        await connection.execute(
            """
            update public.organisations as organisation
            set archived_at = timezone('utc', now())
            where organisation.legal_name = %s and exists (
              select 1 from private.channel_actor_evidence as evidence
              where evidence.organisation_id = organisation.id
            )
            """,
            (f"Organisation {marker}",),
        )
        await connection.execute(
            """
            delete from public.organisations as organisation
            where organisation.legal_name = %s and not exists (
              select 1 from private.channel_actor_evidence as evidence
              where evidence.organisation_id = organisation.id
            )
            """,
            (f"Organisation {marker}",),
        )
        await connection.execute(
            "delete from public.participant_account_scopes where auth_user_id = %s",
            (fixture["actor_id"],),
        )
        await connection.execute(
            "delete from public.participant_accounts where auth_user_id = %s",
            (fixture["actor_id"],),
        )
        await connection.execute(
            "delete from public.person_phone_numbers where id = %s",
            (fixture["phone_id"],),
        )
        await connection.execute(
            "delete from public.worker_participation_preferences where worker_id = %s",
            (fixture["worker_id"],),
        )
        await connection.execute(
            "delete from public.worker_profiles where person_id = %s",
            (fixture["worker_id"],),
        )
        await connection.execute(
            "delete from auth.users where id = %s", (fixture["actor_id"],)
        )
        if fixture["created_instance_id"] is not None:
            await connection.execute(
                "delete from auth.instances where id = %s",
                (fixture["created_instance_id"],),
            )


async def _insert_channel_event(
    database: Database,
    fixture: dict[str, UUID | str | None],
    provider_suffix: str,
) -> dict[str, Any]:
    provider_event_id = f"flo130-{fixture['test_id']}-{provider_suffix}-event"
    provider_message_id = f"flo130-{fixture['test_id']}-{provider_suffix}-message"
    async with database.service_transaction() as connection:
        row = await _fetchone(
            connection,
            """
            insert into public.channel_events (
              channel, provider_event_id, provider_message_id, sender_phone_number,
              event_type, occurred_at, payload
            ) values ('whatsapp', %s, %s, %s, 'message', %s, '{}'::jsonb)
            returning id, provider_message_id, occurred_at
            """,
            (
                provider_event_id,
                provider_message_id,
                fixture["phone_number"],
                datetime(2026, 9, 16, 12, 0, tzinfo=UTC),
            ),
        )
    return row


async def test_flo130_worker_commands_against_local_supabase(
    local_database: Database,
) -> None:
    test_id = uuid4()
    fixture = await _provision_worker_assignment(local_database, test_id)
    actor = CurrentActor(
        user_id=UUID(str(fixture["actor_id"])),
        claims={
            "participant_person_id": str(fixture["worker_id"]),
            "worker_scope": True,
            "contractor_contacts": [],
        },
    )
    assignment_id = UUID(str(fixture["assignment_id"]))
    assignment_correlation_id = f"flo130-pwa-{test_id}"

    try:

        async def respond_handler(connection: Any) -> Any:
            return await respond_to_assignment_mutation(
                connection,
                actor,
                assignment_id,
                RespondToAssignmentInput(response="accepted"),
                source_channel="pwa",
            )

        execution = await execute_command(
            local_database,
            actor,
            assignment_correlation_id,
            "RespondToAssignment",
            f"flo130-respond-{test_id}",
            {"assignment_id": str(assignment_id), "response": "accepted"},
            respond_handler,
        )
        assert execution.replayed is False
        assert execution.body["resource"]["version"] == 2

        async with local_database.service_transaction() as connection:
            result = await connection.execute(
                """
                select event.*, outbox.id as outbox_id, outbox.state as outbox_state
                from private.domain_events as event
                                join private.outbox_messages as outbox
                                    on outbox.domain_event_id = event.id
                where event.command_execution_id = %s
                """,
                (execution.command_id,),
            )
            assignment_events = [dict(row) for row in await result.fetchall()]
        assert len(assignment_events) == 1
        assignment_event = assignment_events[0]
        assert assignment_event["event_type"] == "assignment.worker_responded"
        assert assignment_event["aggregate_type"] == "assignment"
        assert assignment_event["aggregate_id"] == assignment_id
        assert assignment_event["actor_user_id"] == actor.user_id
        assert assignment_event["correlation_id"] == assignment_correlation_id
        assert assignment_event["source_channel"] == "pwa"
        assert assignment_event["source_channel_event_id"] is None
        assert assignment_event["aggregate_version"] == 2
        provenance = assignment_event["payload"]["provenance"]
        assert provenance == {
            "command_id": str(execution.command_id),
            "actor_user_id": str(actor.user_id),
            "actor_person_id": None,
            "actor_organisation_contact_id": None,
            "correlation_id": assignment_correlation_id,
            "source_channel": "pwa",
            "source_channel_event_id": None,
            "source_proposed_action_id": None,
            "aggregate_version": 2,
        }

        accepted_event = await _insert_channel_event(
            local_database, fixture, "accepted"
        )
        assert accepted_event["occurred_at"] == datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
        async with local_database.service_transaction() as connection:
            outcome, entity_ids = await _try_execute_worker_action(
                local_database,
                connection,
                accepted_event,
                ExtractedIntent(
                    "assignment_response", {"response": "accepted"}, 1.0, "clear"
                ),
                str(accepted_event["id"]),
                exact_assignment_response=True,
            )
        assert outcome == "executed"
        assert entity_ids == {
            "workerId": str(fixture["worker_id"]),
            "assignmentId": str(assignment_id),
        }

        declined_event = await _insert_channel_event(
            local_database, fixture, "declined"
        )
        async with local_database.service_transaction() as connection:
            outcome, entity_ids = await _try_execute_worker_action(
                local_database,
                connection,
                declined_event,
                ExtractedIntent(
                    "assignment_response", {"response": "declined"}, 1.0, "clear"
                ),
                str(declined_event["id"]),
                exact_assignment_response=True,
            )
            assignment = await _fetchone(
                connection,
                "select worker_response, version from public.assignments where id = %s",
                (assignment_id,),
            )
            event_counts = await _fetchone(
                connection,
                """
                select count(*) as event_count,
                       count(outbox.id) as outbox_count
                from private.domain_events as event
                                left join private.outbox_messages as outbox
                                    on outbox.domain_event_id = event.id
                where event.aggregate_id = %s
                """,
                (assignment_id,),
            )
        assert outcome == "conflicted"
        assert entity_ids == {
            "workerId": str(fixture["worker_id"]),
            "assignmentId": str(assignment_id),
        }
        assert assignment == {"worker_response": "accepted", "version": 2}
        assert event_counts == {"event_count": 1, "outbox_count": 1}

        availability_date = date(2026, 9, 21)

        async def availability_handler(connection: Any) -> Any:
            return await set_worker_availability_mutation(
                connection,
                actor,
                UUID(str(fixture["worker_id"])),
                availability_date,
                SetWorkerAvailabilityInput(status="available"),
                source="pwa",
            )

        availability_execution = await execute_command(
            local_database,
            actor,
            f"flo130-availability-{test_id}",
            "SetWorkerAvailability",
            f"flo130-availability-{test_id}",
            {
                "worker_id": str(fixture["worker_id"]),
                "work_date": availability_date.isoformat(),
                "status": "available",
            },
            availability_handler,
        )
        availability_id = UUID(str(availability_execution.body["resource"]["id"]))
        async with local_database.service_transaction() as connection:
            availability_outbox = await _fetchone(
                connection,
                """
                select outbox.id
                from private.outbox_messages as outbox
                join private.domain_events as event on event.id = outbox.domain_event_id
                where event.command_execution_id = %s
                """,
                (availability_execution.command_id,),
            )
            await connection.execute(
                """
                update public.person_phone_numbers
                set archived_at = timezone('utc', now())
                where id = %s
                """,
                (fixture["phone_id"],),
            )

        outcomes = await run_command_outbox_jobs(local_database, batch_size=10)
        assert {
            "outbox_id": str(availability_outbox["id"]),
            "outcome": "failed",
        } in outcomes
        async with local_database.service_transaction() as connection:
            availability_signal = await _fetchone(
                connection,
                "select id, status from public.availability_signals where id = %s",
                (availability_id,),
            )
            availability_outbox_state = await _fetchone(
                connection,
                "select state, last_error from private.outbox_messages where id = %s",
                (availability_outbox["id"],),
            )
        assert availability_signal == {"id": availability_id, "status": "available"}
        assert availability_outbox_state["state"] == "pending"
        assert availability_outbox_state["last_error"] is not None
    finally:
        await _cleanup(local_database, fixture)


async def test_whatsapp_only_worker_commands_without_auth_account(
    local_database: Database,
) -> None:
    test_id = uuid4()
    fixture = await _provision_worker_assignment(local_database, test_id)
    worker_id = UUID(str(fixture["worker_id"]))
    assignment_id = UUID(str(fixture["assignment_id"]))
    try:
        async with local_database.service_transaction() as connection:
            await connection.execute(
                "delete from public.participant_account_scopes where auth_user_id = %s",
                (fixture["actor_id"],),
            )
            await connection.execute(
                "delete from public.participant_accounts where auth_user_id = %s",
                (fixture["actor_id"],),
            )
            await connection.execute(
                "delete from auth.users where id = %s", (fixture["actor_id"],)
            )
            await connection.execute(
                """
                insert into public.worker_participation_preferences
                  (worker_id, app_participation)
                values (%s, 'whatsapp_only')
                """,
                (worker_id,),
            )
        offer_response = await _insert_channel_event(
            local_database, fixture, "app-less-accept"
        )
        for expected_outcome in ("executed", "executed"):
            async with local_database.service_transaction() as connection:
                outcome, entities = await _try_execute_worker_action(
                    local_database,
                    connection,
                    offer_response,
                    ExtractedIntent(
                        "assignment_response", {"response": "accepted"}, 1.0, "clear"
                    ),
                    str(offer_response["id"]),
                    exact_assignment_response=True,
                )
                assert outcome == expected_outcome
                assert entities["assignmentId"] == str(assignment_id)

        availability_event = await _insert_channel_event(
            local_database, fixture, "app-less-availability"
        )
        async with local_database.service_transaction() as connection:
            outcome, _ = await _try_execute_worker_action(
                local_database,
                connection,
                availability_event,
                ExtractedIntent(
                    "worker_availability",
                    {"availability": "tomorrow", "status": "available"},
                    1.0,
                    "clear",
                ),
                str(availability_event["id"]),
                exact_assignment_response=False,
                exact_availability=True,
            )
            assert outcome == "executed"
            assignment = await _fetchone(
                connection,
                """
                select worker_response, travel_authorised_at from public.assignments
                where id = %s
                """,
                (assignment_id,),
            )
            availability = await _fetchone(
                connection,
                """
                select status, source, recorded_by_user_id, source_channel_event_id
                from public.availability_signals where worker_id = %s
                """,
                (worker_id,),
            )
            result = await connection.execute(
                """
                select command.actor_user_id, command.actor_person_id,
                       command.source_channel_event_id,
                       event.actor_person_id, event.source_channel
                from private.command_executions as command
                join private.domain_events as event
                  on event.command_execution_id = command.id
                where command.source_channel_event_id = %s
                """,
                (offer_response["id"],),
            )
            command_events = await result.fetchall()
            command_count = await _fetchone(
                connection,
                """
                select count(*) as count from private.command_executions
                where source_channel_event_id = %s
                """,
                (offer_response["id"],),
            )
        assert assignment == {
            "worker_response": "accepted",
            "travel_authorised_at": None,
        }
        assert availability == {
            "status": "available",
            "source": "whatsapp",
            "recorded_by_user_id": None,
            "source_channel_event_id": availability_event["id"],
        }
        assert command_count["count"] == 1
        assert len(command_events) == 1
        assert command_events[0]["actor_user_id"] is None
        assert command_events[0]["actor_person_id"] == worker_id
        assert command_events[0]["source_channel_event_id"] == offer_response["id"]
        assert command_events[0]["source_channel"] == "whatsapp"
    finally:
        await _cleanup(local_database, fixture)


async def test_delayed_whatsapp_message_keeps_intake_owner_after_reassignment(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    new_worker_id = uuid4()
    new_phone_id = uuid4()
    event = await _insert_channel_event(local_database, fixture, "before-reassignment")
    try:
        async with local_database.service_transaction() as connection:
            await connection.execute(
                "update public.person_phone_numbers "
                "set archived_at = now() where id = %s",
                (fixture["phone_id"],),
            )
            await connection.execute(
                "insert into public.people (id, display_name) "
                "values (%s, 'Next owner')",
                (new_worker_id,),
            )
            await connection.execute(
                "insert into public.worker_profiles (person_id) values (%s)",
                (new_worker_id,),
            )
            await connection.execute(
                """
                insert into public.person_phone_numbers
                  (id, person_id, phone_number, is_primary)
                values (%s, %s, %s, true)
                """,
                (new_phone_id, new_worker_id, fixture["phone_number"]),
            )
            principal = await resolve_channel_principal(connection, str(event["id"]))
            assert principal is not None
            assert principal.person_id == fixture["worker_id"]
            outcome, entities = await _try_execute_worker_action(
                local_database,
                connection,
                event,
                ExtractedIntent(
                    "assignment_response", {"response": "accepted"}, 1.0, "clear"
                ),
                str(event["id"]),
                exact_assignment_response=True,
            )
            assignment = await _fetchone(
                connection,
                "select worker_id, worker_response "
                "from public.assignments where id = %s",
                (fixture["assignment_id"],),
            )
        assert outcome == "executed"
        assert entities["workerId"] == str(fixture["worker_id"])
        assert assignment == {
            "worker_id": fixture["worker_id"],
            "worker_response": "accepted",
        }
    finally:
        async with local_database.service_transaction() as connection:
            await connection.execute(
                "delete from public.person_phone_numbers where id = %s", (new_phone_id,)
            )
            await connection.execute(
                "delete from public.worker_profiles where person_id = %s",
                (new_worker_id,),
            )
            await connection.execute(
                "delete from public.people where id = %s", (new_worker_id,)
            )
        await _cleanup(local_database, fixture)


async def test_dual_role_phone_cannot_execute_whatsapp_command(
    local_database: Database,
) -> None:
    fixture = await _provision_worker_assignment(local_database, uuid4())
    try:
        async with local_database.service_transaction() as connection:
            assignment = await _fetchone(
                connection,
                "select organisation_id from public.assignments where id = %s",
                (fixture["assignment_id"],),
            )
            await connection.execute(
                """
                insert into public.organisation_contacts
                  (organisation_id, person_id)
                values (%s, %s)
                """,
                (assignment["organisation_id"], fixture["worker_id"]),
            )
            grants = await _fetchone(
                connection,
                """
                select has_schema_privilege('authenticated', 'private', 'USAGE')
                         as schema_usage,
                       has_table_privilege(
                         'authenticated', 'private.channel_actor_evidence', 'SELECT'
                       ) as can_read_evidence
                """,
                (),
            )
        assert grants == {"schema_usage": False, "can_read_evidence": False}

        event = await _insert_channel_event(local_database, fixture, "dual-role")
        async with local_database.service_transaction() as connection:
            principal = await resolve_channel_principal(connection, str(event["id"]))
            outcome, entities = await _try_execute_worker_action(
                local_database,
                connection,
                event,
                ExtractedIntent(
                    "assignment_response", {"response": "accepted"}, 1.0, "clear"
                ),
                str(event["id"]),
                exact_assignment_response=True,
            )
            assignment_state = await _fetchone(
                connection,
                "select worker_response from public.assignments where id = %s",
                (fixture["assignment_id"],),
            )
        assert principal is None
        assert outcome is None
        assert entities == {}
        assert assignment_state["worker_response"] == "pending"
    finally:
        await _cleanup(local_database, fixture)
