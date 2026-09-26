from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx

DeliveryState = Literal["sent", "delivered", "failed"]
MediaType = Literal["image", "audio", "video", "document", "sticker", "unknown"]


class WhatsAppProviderError(Exception):
    def __init__(self, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class InboundMedia:
    provider_media_id: str
    media_type: MediaType
    mime_type: str | None


@dataclass(frozen=True)
class InboundMessage:
    provider_event_id: str
    provider_message_id: str
    sender_phone_number: str
    occurred_at: datetime
    text: str | None
    media: list[InboundMedia]
    raw_payload: dict[str, Any]


@dataclass(frozen=True)
class DeliveryStatus:
    provider_event_id: str
    provider_message_id: str
    occurred_at: datetime
    state: DeliveryState
    failure_reason: str | None
    raw_payload: dict[str, Any]


@dataclass(frozen=True)
class RetrievedMedia:
    bytes: bytes
    mime_type: str


@dataclass(frozen=True)
class ApprovedTemplate:
    name: str
    language_code: str
    components: list[dict[str, Any]] | None = None


def verify_webhook_signature(
    body: bytes, signature: str | None, app_secret: str
) -> bool:
    if not signature or not app_secret or not signature.startswith("sha256="):
        return False
    expected = (
        "sha256=" + hmac.new(app_secret.encode("utf-8"), body, sha256).hexdigest()
    )
    return hmac.compare_digest(signature, expected)


def verify_webhook_token(
    mode: str | None,
    token: str | None,
    challenge: str | None,
    expected_token: str,
) -> str | None:
    if mode != "subscribe" or not expected_token:
        return None
    if not hmac.compare_digest(token or "", expected_token):
        return None
    return challenge


def normalize_inbound_messages(payload: dict[str, Any]) -> list[InboundMessage]:
    results: list[InboundMessage] = []
    for value in _webhook_values(payload):
        messages = value.get("messages")
        if not isinstance(messages, list):
            continue
        for candidate in messages:
            message = _record(candidate)
            if message is None:
                continue
            sender = message.get("from")
            message_id = message.get("id")
            if not isinstance(sender, str) or not isinstance(message_id, str):
                continue
            text = _message_text(message)
            results.append(
                InboundMessage(
                    provider_event_id=(
                        payload["id"]
                        if isinstance(payload.get("id"), str)
                        else message_id
                    ),
                    provider_message_id=message_id,
                    sender_phone_number=(
                        sender if sender.startswith("+") else f"+{sender}"
                    ),
                    occurred_at=_occurred_at(message.get("timestamp")),
                    text=text,
                    media=_normalize_media(message),
                    raw_payload=payload,
                )
            )
    return results


def normalize_delivery_statuses(payload: dict[str, Any]) -> list[DeliveryStatus]:
    results: list[DeliveryStatus] = []
    for value in _webhook_values(payload):
        statuses = value.get("statuses")
        if not isinstance(statuses, list):
            continue
        for candidate in statuses:
            status = _record(candidate)
            if status is None or not isinstance(status.get("id"), str):
                continue
            state = _delivery_state(status.get("status"))
            if state is None:
                continue
            occurred_at = _occurred_at(status.get("timestamp"))
            provider_message_id = status["id"]
            results.append(
                DeliveryStatus(
                    provider_event_id=(
                        f"{provider_message_id}:{state}:{occurred_at.isoformat()}"
                    ),
                    provider_message_id=provider_message_id,
                    occurred_at=occurred_at,
                    state=state,
                    failure_reason=(
                        _status_failure_reason(status) if state == "failed" else None
                    ),
                    raw_payload=payload,
                )
            )
    return results


class MetaWhatsAppCloudProvider:
    def __init__(
        self,
        access_token: str,
        phone_number_id: str,
        api_version: str = "v24.0",
        base_url: str = "https://graph.facebook.com",
        max_media_bytes: int = 12 * 1024 * 1024,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not access_token.strip() or not phone_number_id.strip():
            raise ValueError("WhatsApp access token and phone number ID are required")
        if not api_version.startswith("v") or "." not in api_version:
            raise ValueError("WhatsApp API version must use the vNN.N format")
        if max_media_bytes < 1:
            raise ValueError("WhatsApp max media bytes must be positive")
        self._access_token = access_token
        self._phone_number_id = phone_number_id
        self._api_version = api_version
        self._base_url = base_url.rstrip("/")
        self._max_media_bytes = max_media_bytes
        self._client = client or httpx.AsyncClient(timeout=30)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_text(self, recipient_phone_number: str, body: str) -> str:
        if not _is_e164(recipient_phone_number):
            raise WhatsAppProviderError("WhatsApp recipient must be E.164", False)
        if not body.strip() or len(body) > 4096:
            raise WhatsAppProviderError(
                "WhatsApp text must be 1 to 4096 characters", False
            )
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient_phone_number[1:],
            "type": "text",
            "text": {"body": body, "preview_url": False},
        }
        return await self._send(payload)

    async def send_template(
        self, recipient_phone_number: str, template: ApprovedTemplate
    ) -> str:
        if not _is_e164(recipient_phone_number):
            raise WhatsAppProviderError("WhatsApp recipient must be E.164", False)
        if not template.name.strip() or not template.language_code.strip():
            raise WhatsAppProviderError("An approved template is required", False)
        template_payload: dict[str, Any] = {
            "name": template.name,
            "language": {"code": template.language_code},
        }
        if template.components:
            template_payload["components"] = template.components
        return await self._send(
            {
                "messaging_product": "whatsapp",
                "to": recipient_phone_number[1:],
                "type": "template",
                "template": template_payload,
            }
        )

    async def get_media(self, provider_media_id: str) -> RetrievedMedia:
        if not provider_media_id.strip():
            raise WhatsAppProviderError("WhatsApp media ID is required", False)
        metadata = await self._request("GET", f"/{quote(provider_media_id, safe='')}")
        payload = _response_record(metadata)
        media_url = payload.get("url")
        mime_type = payload.get("mime_type")
        file_size = payload.get("file_size")
        if not isinstance(media_url, str) or not isinstance(mime_type, str):
            raise WhatsAppProviderError("WhatsApp media metadata was incomplete", True)
        if urlparse(media_url).scheme != "https":
            raise WhatsAppProviderError("WhatsApp media URL was invalid", True)
        if isinstance(file_size, (int, float)) and file_size > self._max_media_bytes:
            raise WhatsAppProviderError("WhatsApp media exceeds size limit", False)
        try:
            response = await self._client.get(
                media_url, headers={"Authorization": f"Bearer {self._access_token}"}
            )
        except httpx.HTTPError as error:
            raise WhatsAppProviderError(
                "WhatsApp media download failed", True
            ) from error
        if response.status_code >= 400:
            raise WhatsAppProviderError(
                f"WhatsApp media download failed with status {response.status_code}",
                _retryable_status(response.status_code),
            )
        content_length = response.headers.get("content-length")
        if (
            content_length
            and content_length.isdigit()
            and int(content_length) > self._max_media_bytes
        ):
            raise WhatsAppProviderError("WhatsApp media exceeds size limit", False)
        if len(response.content) > self._max_media_bytes:
            raise WhatsAppProviderError("WhatsApp media exceeds size limit", False)
        return RetrievedMedia(bytes=response.content, mime_type=mime_type)

    async def _send(self, payload: dict[str, Any]) -> str:
        response = await self._request(
            "POST", f"/{self._phone_number_id}/messages", json=payload
        )
        response_payload = _response_record(response)
        messages = response_payload.get("messages")
        first_message = (
            _record(messages[0]) if isinstance(messages, list) and messages else None
        )
        provider_message_id = first_message.get("id") if first_message else None
        if not isinstance(provider_message_id, str) or not provider_message_id.strip():
            raise WhatsAppProviderError("WhatsApp response had no message ID", True)
        return provider_message_id

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}/{self._api_version}{path}",
                headers={"Authorization": f"Bearer {self._access_token}"},
                **kwargs,
            )
        except httpx.HTTPError as error:
            raise WhatsAppProviderError(
                "WhatsApp provider request failed", True
            ) from error
        if response.status_code >= 400:
            raise WhatsAppProviderError(
                f"WhatsApp provider request failed with status {response.status_code}",
                _retryable_status(response.status_code),
            )
        return response


def _webhook_values(payload: dict[str, Any]) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    entries = payload.get("entry")
    if not isinstance(entries, list):
        return values
    for entry_value in entries:
        entry = _record(entry_value)
        changes = entry.get("changes") if entry else None
        if not isinstance(changes, list):
            continue
        for change_value in changes:
            change = _record(change_value)
            value = _record(change.get("value")) if change else None
            if value:
                values.append(value)
    return values


def _normalize_media(message: dict[str, Any]) -> list[InboundMedia]:
    for media_type in ("image", "audio", "video", "document", "sticker"):
        media = _record(message.get(media_type))
        media_id = media.get("id") if media else None
        if media is not None and isinstance(media_id, str):
            mime_type = media.get("mime_type")
            return [
                InboundMedia(
                    provider_media_id=media_id,
                    media_type=media_type,
                    mime_type=mime_type if isinstance(mime_type, str) else None,
                )
            ]
    return []


def _delivery_state(value: Any) -> DeliveryState | None:
    if value == "sent":
        return "sent"
    if value in {"delivered", "read"}:
        return "delivered"
    if value == "failed":
        return "failed"
    return None


def _message_text(message: dict[str, Any]) -> str | None:
    text_data = _record(message.get("text"))
    text = text_data.get("body") if text_data else None
    if isinstance(text, str):
        return text
    button = _record(message.get("button"))
    button_payload = button.get("payload") if button else None
    if isinstance(button_payload, str) and button_payload.strip():
        return button_payload
    interactive = _record(message.get("interactive"))
    if interactive is None:
        return None
    for reply_type in ("button_reply", "list_reply"):
        reply = _record(interactive.get(reply_type))
        if reply is None:
            continue
        value = reply.get("id")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _status_failure_reason(status: dict[str, Any]) -> str | None:
    errors = status.get("errors")
    error = _record(errors[0]) if isinstance(errors, list) and errors else None
    reason = (error.get("title") or error.get("message")) if error else None
    return reason[:500] if isinstance(reason, str) else None


def _occurred_at(value: Any) -> datetime:
    try:
        seconds = float(value)
        if seconds > 0:
            return datetime.fromtimestamp(seconds, tz=UTC)
    except (TypeError, ValueError, OverflowError):
        pass
    return datetime.now(tz=UTC)


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _response_record(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as error:
        raise WhatsAppProviderError("WhatsApp response was invalid", True) from error
    record = _record(payload)
    if record is None:
        raise WhatsAppProviderError("WhatsApp response was invalid", True)
    return record


def _is_e164(value: str) -> bool:
    return len(value) <= 16 and value.startswith("+") and value[1:].isdigit()


def _retryable_status(status: int) -> bool:
    return status in {408, 429} or status >= 500
