"""Conservative WhatsApp session eligibility from persisted provider evidence."""

from datetime import UTC, datetime, timedelta
from typing import Any


class CommunicationFallbackRequired(Exception):
    """No permitted WhatsApp send form exists; Ops must arrange contact."""


class ConversationWindowPolicy:
    # Leave time for database work and provider latency near the Meta boundary.
    duration = timedelta(hours=24)
    send_margin = timedelta(minutes=5)

    def is_open(self, inbound_at: datetime, now: datetime) -> bool:
        if inbound_at.tzinfo is None or now.tzinfo is None:
            return False
        age = now - inbound_at
        return timedelta(0) <= age < self.duration - self.send_margin

    async def is_open_for(
        self, connection: Any, recipient_phone_number: str, now: datetime | None = None
    ) -> bool:
        checked_at = now or datetime.now(UTC)
        result = await connection.execute(
            """
            select occurred_at, payload, provider_message_id
            from public.channel_events
            where channel = 'whatsapp' and event_type = 'message'
              and sender_phone_number = %s and provider_message_id is not null
              and occurred_at > %s and occurred_at <= %s
            order by occurred_at desc limit 50
            """,
            (
                recipient_phone_number,
                checked_at - self.duration + self.send_margin,
                checked_at,
            ),
        )
        for row in await result.fetchall():
            if self.is_open(row["occurred_at"], checked_at) and (
                self._has_valid_provider_time(
                    row["payload"],
                    row["provider_message_id"],
                    recipient_phone_number,
                    row["occurred_at"],
                )
            ):
                return True
        return False

    @staticmethod
    def _has_valid_provider_time(
        payload: Any, message_id: str, sender: str, occurred_at: datetime
    ) -> bool:
        if not isinstance(payload, dict):
            return False
        for entry in payload.get("entry", []):
            if not isinstance(entry, dict):
                continue
            for change in entry.get("changes", []):
                value = change.get("value") if isinstance(change, dict) else None
                if not isinstance(value, dict):
                    continue
                for message in value.get("messages", []):
                    if not isinstance(message, dict):
                        continue
                    raw_sender = message.get("from")
                    raw_time = message.get("timestamp")
                    if (
                        message.get("id") != message_id
                        or not isinstance(raw_sender, str)
                        or "+" + raw_sender.lstrip("+") != sender
                        or not isinstance(raw_time, str)
                        or not raw_time.isdecimal()
                    ):
                        continue
                    try:
                        provider_time = datetime.fromtimestamp(int(raw_time), UTC)
                    except (ValueError, OverflowError, OSError):
                        continue
                    if provider_time == occurred_at.astimezone(UTC):
                        return True
        return False
