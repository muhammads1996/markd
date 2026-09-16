import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from psycopg import AsyncConnection

from app.core.auth import CurrentActor
from app.integrations.database import Database


@dataclass(frozen=True)
class CommandExecution:
    command_id: UUID
    replayed: bool
    status_code: int
    body: dict[str, Any]


@dataclass(frozen=True)
class MutationResult:
    status_code: int
    body: dict[str, Any]
    event_type: str | None
    aggregate_type: str
    aggregate_id: UUID | None
    event_payload: dict[str, Any]
    source_channel: str | None = None
    source_channel_event_id: UUID | None = None
    source_proposed_action_id: UUID | None = None


CommandHandler = Callable[[AsyncConnection[Any]], Awaitable[MutationResult]]


def request_hash(command_name: str, payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        {"command": command_name, "payload": payload},
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def execute_command(
    database: Database,
    actor: CurrentActor,
    correlation_id: str,
    command_name: str,
    idempotency_key: str,
    payload: dict[str, Any],
    handler: CommandHandler,
) -> CommandExecution:
    if not idempotency_key.strip():
        raise HTTPException(status_code=400, detail="Idempotency-Key is required")
    payload_hash = request_hash(command_name, payload)
    async with database.transaction(actor.user_id, correlation_id) as connection:
        result = await connection.execute(
            """
            insert into private.command_executions
              (actor_user_id, command_name, idempotency_key, request_hash)
            values (%s, %s, %s, %s)
            on conflict (actor_user_id, idempotency_key) do nothing
            returning id
            """,
            (actor.user_id, command_name, idempotency_key, payload_hash),
        )
        created = await result.fetchone()
        if created is None:
            result = await connection.execute(
                """
                select id, command_name, request_hash, state,
                       response_status, response_body
                from private.command_executions
                where actor_user_id = %s and idempotency_key = %s
                for update
                """,
                (actor.user_id, idempotency_key),
            )
            existing = await result.fetchone()
            if existing is None:
                raise HTTPException(
                    status_code=503, detail="Command could not be claimed"
                )
            if (
                existing["command_name"] != command_name
                or existing["request_hash"] != payload_hash
            ):
                raise HTTPException(
                    status_code=409,
                    detail="IDEMPOTENCY_KEY_REUSE",
                )
            if existing["state"] == "completed":
                return CommandExecution(
                    command_id=existing["id"],
                    replayed=True,
                    status_code=existing["response_status"],
                    body=existing["response_body"],
                )
            raise HTTPException(status_code=409, detail="COMMAND_IN_PROGRESS")

        command_id = created["id"]
        mutation = await handler(connection)
        if mutation.event_type is not None:
            resource = mutation.body.get("resource", {})
            aggregate_version = resource.get("version")
            event_payload = {
                **mutation.event_payload,
                "provenance": {
                    "command_id": command_id,
                    "actor_user_id": actor.user_id,
                    "correlation_id": correlation_id,
                    "source_channel": mutation.source_channel,
                    "source_channel_event_id": mutation.source_channel_event_id,
                    "source_proposed_action_id": mutation.source_proposed_action_id,
                    "aggregate_version": aggregate_version,
                },
            }
            event_result = await connection.execute(
                """
                insert into private.domain_events
                  (command_execution_id, event_type, aggregate_type, aggregate_id,
                   payload, actor_user_id, correlation_id, source_channel,
                   source_channel_event_id, source_proposed_action_id,
                   aggregate_version)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    command_id,
                    mutation.event_type,
                    mutation.aggregate_type,
                    mutation.aggregate_id,
                    json.dumps(jsonable_encoder(event_payload)),
                    actor.user_id,
                    correlation_id,
                    mutation.source_channel,
                    mutation.source_channel_event_id,
                    mutation.source_proposed_action_id,
                    aggregate_version,
                ),
            )
            event = await event_result.fetchone()
            if event is None:
                raise HTTPException(
                    status_code=503, detail="Domain event was not recorded"
                )
            await connection.execute(
                """
                insert into private.outbox_messages (domain_event_id)
                values (%s)
                """,
                (event["id"],),
            )
        await connection.execute(
            """
            update private.command_executions
            set state = 'completed', response_status = %s,
                response_body = %s, completed_at = timezone('utc', now())
            where id = %s
            """,
            (
                mutation.status_code,
                json.dumps(jsonable_encoder(mutation.body)),
                command_id,
            ),
        )
        return CommandExecution(
            command_id=command_id,
            replayed=False,
            status_code=mutation.status_code,
            body=mutation.body,
        )