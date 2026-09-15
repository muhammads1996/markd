from uuid import UUID, uuid4

from fastapi import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def correlation_id_from_request(request: Request) -> UUID:
    value = request.headers.get("X-Correlation-Id")
    if value:
        try:
            return UUID(value)
        except ValueError:
            pass
    return uuid4()


class CorrelationMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        raw_value = headers.get(b"x-correlation-id", b"").decode("latin-1")
        try:
            correlation_id = UUID(raw_value) if raw_value else uuid4()
        except ValueError:
            correlation_id = uuid4()

        scope.setdefault("state", {})["correlation_id"] = str(correlation_id)

        async def send_with_correlation(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = list(message.get("headers", []))
                response_headers.append(
                    (b"x-correlation-id", str(correlation_id).encode("ascii"))
                )
                message = {**message, "headers": response_headers}
            await send(message)

        await self.app(scope, receive, send_with_correlation)