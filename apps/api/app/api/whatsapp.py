from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, PlainTextResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.api.dependencies import get_database
from app.core.config import Settings, get_settings
from app.integrations.database import Database
from app.integrations.whatsapp import (
    InboundMessage,
    normalize_delivery_statuses,
    normalize_inbound_messages,
    verify_webhook_signature,
    verify_webhook_token,
)

router = APIRouter(tags=["WhatsApp"])


class QueueDeliveryInput(BaseModel):
    recipient_phone_number: str = Field(min_length=3, max_length=16)
    body: str = Field(min_length=1, max_length=4096)
    message_kind: str = Field(min_length=1, max_length=100)
    idempotency_key: str = Field(min_length=1, max_length=255)
    source_channel_event_id: str | None = None
    source_proposed_action_id: str | None = None


class WebhookReceipt(BaseModel):
    received: bool
    inbound_messages: int
    delivery_statuses: int


class DeliveryQueueReceipt(BaseModel):
    queued: bool


@router.get(
    "/webhooks/whatsapp",
    operation_id="verifyWhatsAppWebhook",
    response_class=PlainTextResponse,
    responses={403: {"description": "Webhook verification was rejected."}},
)
async def verify_whatsapp_webhook(
    mode: str | None = Query(default=None, alias="hub.mode"),
    token: str | None = Query(default=None, alias="hub.verify_token"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
    settings: Settings = Depends(get_settings),
) -> PlainTextResponse:
    verified_challenge = verify_webhook_token(
        mode, token, challenge, settings.whatsapp_verify_token
    )
    if verified_challenge is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return PlainTextResponse(verified_challenge)


@router.post(
    "/webhooks/whatsapp",
    operation_id="receiveWhatsAppWebhook",
    response_model=WebhookReceipt,
    responses={
        400: {"description": "Webhook payload was invalid."},
        401: {"description": "Webhook signature was invalid."},
        503: {"description": "Webhook evidence could not be persisted."},
    },
)
async def receive_whatsapp_webhook(
    request: Request,
    signature: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> JSONResponse:
    body = await request.body()
    if not verify_webhook_signature(body, signature, settings.whatsapp_app_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload"
        ) from error
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload"
        )
    inbound_messages = normalize_inbound_messages(payload)
    delivery_statuses = normalize_delivery_statuses(payload)
    try:
        async with database.service_transaction() as connection:
            for inbound in inbound_messages:
                await _persist_inbound_event(connection, inbound)
            for delivery_status in delivery_statuses:
                await connection.execute(
                    """
                    insert into public.channel_events (
                      channel, event_type, occurred_at, payload, provider_event_id,
                      provider_message_id, media
                    ) values ('whatsapp', 'status', %s, %s, %s, %s, '[]'::jsonb)
                    on conflict do nothing
                    """,
                    (
                        delivery_status.occurred_at,
                        Jsonb(delivery_status.raw_payload),
                        delivery_status.provider_event_id,
                        delivery_status.provider_event_id,
                    ),
                )
                await connection.execute(
                    "select public.record_channel_delivery_status(%s, %s, %s, %s)",
                    (
                        delivery_status.provider_message_id,
                        delivery_status.state,
                        delivery_status.occurred_at,
                        delivery_status.failure_reason,
                    ),
                )
            if not inbound_messages and not delivery_statuses:
                await _persist_unsupported_event(connection, payload, body)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook evidence persistence failed",
        ) from error
    return JSONResponse(
        {
            "received": True,
            "inbound_messages": len(inbound_messages),
            "delivery_statuses": len(delivery_statuses),
        }
    )


@router.post(
    "/internal/whatsapp/deliveries",
    operation_id="queueWhatsAppDelivery",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=DeliveryQueueReceipt,
    responses={
        401: {"description": "Internal service authentication was rejected."},
        503: {"description": "Delivery queue persistence failed."},
    },
)
async def queue_whatsapp_delivery(
    input: QueueDeliveryInput,
    internal_token: str | None = Header(default=None, alias="X-Internal-Service-Token"),
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> JSONResponse:
    if not settings.internal_service_token or not hmac.compare_digest(
        internal_token or "", settings.internal_service_token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
        )
    if not _is_e164(input.recipient_phone_number):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Recipient must be E.164",
        )
    try:
        async with database.service_transaction() as connection:
            await connection.execute(
                """
                insert into public.channel_deliveries (
                  channel, recipient_phone_number, body, message_kind, idempotency_key,
                  source_channel_event_id, source_proposed_action_id, state
                ) values ('whatsapp', %s, %s, %s, %s, %s::uuid, %s::uuid, 'queued')
                on conflict (idempotency_key) do nothing
                """,
                (
                    input.recipient_phone_number,
                    input.body,
                    input.message_kind,
                    input.idempotency_key,
                    input.source_channel_event_id,
                    input.source_proposed_action_id,
                ),
            )
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Delivery queue persistence failed",
        ) from error
    return JSONResponse({"queued": True}, status_code=status.HTTP_202_ACCEPTED)


async def _persist_inbound_event(connection: Any, inbound: InboundMessage) -> None:
    result = await connection.execute(
        """
        insert into public.channel_events (
          channel, event_type, occurred_at, payload, provider_event_id,
          provider_message_id, sender_phone_number, media
        ) values ('whatsapp', 'message', %s, %s, %s, %s, %s, %s)
        on conflict (channel, provider_message_id) where provider_message_id is not null
        do nothing returning id
        """,
        (
            inbound.occurred_at,
            Jsonb(inbound.raw_payload),
            inbound.provider_event_id,
            inbound.provider_message_id,
            inbound.sender_phone_number,
            Jsonb(
                [
                    {
                        "providerMediaId": media.provider_media_id,
                        "mediaType": media.media_type,
                        "mimeType": media.mime_type,
                    }
                    for media in inbound.media
                ]
            ),
        ),
    )
    row = await result.fetchone()
    if row is None:
        result = await connection.execute(
            """
            select id from public.channel_events
            where channel = 'whatsapp' and provider_message_id = %s
            """,
            (inbound.provider_message_id,),
        )
        row = await result.fetchone()
    if row is None:
        raise RuntimeError("Webhook event persistence returned no event ID")
    event_id = row["id"]
    for media in inbound.media:
        await connection.execute(
            """
            insert into public.channel_media_assets (
              channel_event_id, provider_media_id, media_type, mime_type
            ) values (%s, %s, %s, %s)
            on conflict (channel_event_id, provider_media_id) do nothing
            """,
            (event_id, media.provider_media_id, media.media_type, media.mime_type),
        )


async def _persist_unsupported_event(
    connection: Any, payload: dict[str, Any], raw_body: bytes
) -> None:
    if not isinstance(payload.get("entry"), list):
        return
    provider_event_id = payload.get("id")
    event_key = (
        provider_event_id
        if isinstance(provider_event_id, str)
        else hashlib.sha256(raw_body).hexdigest()
    )
    await connection.execute(
        """
        insert into public.channel_events (
          channel, event_type, payload, provider_event_id, provider_message_id, media
        ) values ('whatsapp', 'unsupported', %s, %s, %s, '[]'::jsonb)
        on conflict (channel, provider_message_id) where provider_message_id is not null
        do nothing
        """,
        (Jsonb(payload), event_key, f"unsupported:{event_key}"),
    )


def _is_e164(value: str) -> bool:
    return len(value) <= 16 and value.startswith("+") and value[1:].isdigit()
