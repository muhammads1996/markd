from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime
from uuid import UUID

import pytest

from app.application.channel_actors import ChannelPrincipal, resolve_channel_principal
from app.application.dispatcher import MutationResult, execute_command
from app.workers.whatsapp import _resolve_closeout_entities

pytestmark = pytest.mark.asyncio

EVENT_ID = UUID("10000000-0000-4000-8000-000000000001")
PERSON_ID = UUID("20000000-0000-4000-8000-000000000002")
CONTACT_ID = UUID("30000000-0000-4000-8000-000000000003")
ORG_ID = UUID("40000000-0000-4000-8000-000000000004")
ASSIGNMENT_ID = UUID("50000000-0000-4000-8000-000000000005")
COMMAND_ID = UUID("60000000-0000-4000-8000-000000000006")
DOMAIN_EVENT_ID = UUID("70000000-0000-4000-8000-000000000007")


class RowsResult:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    async def fetchall(self) -> list[dict[str, object]]:
        return self.rows

    async def fetchone(self) -> dict[str, object] | None:
        return self.rows[0] if self.rows else None


class ResolverConnection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    async def execute(self, *_: object) -> RowsResult:
        return RowsResult(self.rows)


def principal_row(**overrides: object) -> dict[str, object]:
    return {
        "event_id": EVENT_ID,
        "person_id": PERSON_ID,
        "worker_id": PERSON_ID,
        "organisation_contact_id": None,
        "organisation_id": None,
        **overrides,
    }


async def test_resolves_whatsapp_only_worker_without_auth_account() -> None:
    principal = await resolve_channel_principal(
        ResolverConnection([principal_row()]), str(EVENT_ID)
    )

    assert principal == ChannelPrincipal(EVENT_ID, PERSON_ID, "worker")
    actor = principal.command_actor()
    assert actor.user_id is None
    assert actor.channel_event_id == EVENT_ID
    assert actor.person_id == PERSON_ID
    assert actor.claims["worker_scope"] is True


async def test_resolves_unique_hirer_contact_and_organisation() -> None:
    principal = await resolve_channel_principal(
        ResolverConnection(
            [
                principal_row(
                    worker_id=None,
                    organisation_contact_id=CONTACT_ID,
                    organisation_id=ORG_ID,
                )
            ]
        ),
        str(EVENT_ID),
    )

    assert principal == ChannelPrincipal(
        EVENT_ID, PERSON_ID, "hirer", CONTACT_ID, ORG_ID
    )
    actor = principal.command_actor()
    assert actor.user_id is None
    assert actor.organisation_contact_id == CONTACT_ID
    assert actor.claims["contractor_contacts"] == [
        {
            "organisation_contact_id": str(CONTACT_ID),
            "organisation_id": str(ORG_ID),
        }
    ]


@pytest.mark.parametrize(
    "rows",
    [
        [principal_row(), principal_row()],
        [
            principal_row(
                organisation_contact_id=CONTACT_ID,
                organisation_id=ORG_ID,
            )
        ],
        [principal_row(worker_id=None)],
        [],
    ],
    ids=[
        "ambiguous-owners",
        "worker-and-hirer-dual-role",
        "inactive-role",
        "missing-owner",
    ],
)
async def test_refuses_ambiguous_or_unusable_phone_ownership(
    rows: list[dict[str, object]],
) -> None:
    assert (
        await resolve_channel_principal(ResolverConnection(rows), str(EVENT_ID)) is None
    )


class CommandConnection:
    def __init__(self) -> None:
        self.executions: dict[str, dict[str, object]] = {}
        self.params: list[tuple[object, ...] | None] = []
        self.domain_event_params: tuple[object, ...] | None = None
        self.mutation_calls = 0

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> RowsResult:
        self.params.append(params)
        if "insert into private.command_executions" in query:
            assert params is not None
            self.assert_channel_audit_params(params)
            key = str(params[5])
            if key in self.executions:
                return RowsResult([])
            self.executions[key] = {
                "id": COMMAND_ID,
                "command_name": params[4],
                "request_hash": params[6],
                "state": "running",
            }
            return RowsResult([{"id": COMMAND_ID}])
        if "select id, command_name, request_hash, state" in query:
            assert params is not None
            existing = self.executions[str(params[0])]
            return RowsResult([existing])
        if "insert into private.domain_events" in query:
            self.domain_event_params = params
            return RowsResult([{"id": DOMAIN_EVENT_ID}])
        if "update private.command_executions" in query:
            assert params is not None
            record = next(
                value for value in self.executions.values() if value["id"] == params[2]
            )
            record.update(
                state="completed",
                response_status=params[0],
                response_body=json.loads(str(params[1])),
            )
        return RowsResult([])

    @staticmethod
    def assert_channel_audit_params(params: tuple[object, ...]) -> None:
        assert params[:4] == (None, PERSON_ID, None, EVENT_ID)


class CommandDatabase:
    def __init__(self) -> None:
        self.connection = CommandConnection()
        self.transaction_actor_user_ids: list[object] = []

    @asynccontextmanager
    async def transaction(self, actor_user_id: object, _correlation_id: str):
        self.transaction_actor_user_ids.append(actor_user_id)
        yield self.connection


async def test_channel_command_replay_is_idempotent_and_audited_without_auth_user() -> (
    None
):
    principal = ChannelPrincipal(EVENT_ID, PERSON_ID, "worker")
    actor = principal.command_actor()
    database = CommandDatabase()

    async def handler(_connection: object) -> MutationResult:
        database.connection.mutation_calls += 1
        return MutationResult(
            status_code=200,
            body={"ok": True},
            event_type="assignment.accepted",
            aggregate_type="assignment",
            aggregate_id=ASSIGNMENT_ID,
            event_payload={"state": "WAITING"},
            source_channel="whatsapp",
            source_channel_event_id=EVENT_ID,
        )

    first = await execute_command(
        database,
        actor,
        "correlation-1",
        "RespondToAssignmentOffer",
        "wa-message-1",
        {"assignmentId": str(ASSIGNMENT_ID)},
        handler,
    )
    replay = await execute_command(
        database,
        actor,
        "correlation-1",
        "RespondToAssignmentOffer",
        "wa-message-1",
        {"assignmentId": str(ASSIGNMENT_ID)},
        handler,
    )

    assert first.replayed is False
    assert replay.replayed is True
    assert replay.body == {"ok": True}
    assert database.connection.mutation_calls == 1
    assert database.transaction_actor_user_ids == [None, None]
    params = database.connection.domain_event_params
    assert params is not None
    assert params[5:12] == (
        None,
        PERSON_ID,
        None,
        "correlation-1",
        "whatsapp",
        EVENT_ID,
        None,
    )


async def test_hirer_closeout_entities_bind_contact_org_and_assignment() -> None:
    principal = ChannelPrincipal(EVENT_ID, PERSON_ID, "hirer", CONTACT_ID, ORG_ID)

    class AssignmentConnection:
        async def execute(self, query: str, params: tuple[object, ...]) -> RowsResult:
            assert "where organisation_id = %s" in query
            assert params[0] == ORG_ID
            return RowsResult([{"id": ASSIGNMENT_ID}])

    entities = await _resolve_closeout_entities(
        AssignmentConnection(),
        {"occurred_at": datetime.now().astimezone()},
        str(EVENT_ID),
        principal,
    )

    assert entities == {
        "assertedById": str(PERSON_ID),
        "assertedRole": "hirer",
        "organisationId": str(ORG_ID),
        "organisationContactId": str(CONTACT_ID),
        "assignmentId": str(ASSIGNMENT_ID),
    }
