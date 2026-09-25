import json
from typing import Any
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.core import auth
from app.core.config import Settings


@pytest.mark.asyncio
async def test_asymmetric_supabase_token_uses_jwks_even_with_legacy_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    claims = {"sub": str(uuid4()), "aud": "authenticated"}
    token = jwt.encode(claims, key, algorithm="ES256", headers={"kid": "local-key"})
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = "local-key"

    class Response:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, Any]:
            return {"keys": [jwk]}

    class Client:
        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            pass

        async def get(self, url: str) -> Response:
            assert url.endswith("/auth/v1/.well-known/jwks.json")
            return Response()

    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: Client())

    decoded = await auth._decode_token(
        token, Settings(supabase_jwt_secret="legacy-local-secret-that-is-long-enough")
    )

    assert decoded["sub"] == claims["sub"]


@pytest.mark.asyncio
async def test_hs256_token_requires_configured_secret() -> None:
    claims = {"sub": str(uuid4()), "aud": "authenticated"}
    secret = "legacy-local-secret-that-is-long-enough"
    token = jwt.encode(claims, secret, algorithm="HS256")

    assert (
        await auth._decode_token(
            token, Settings(supabase_jwt_secret=secret)
        )
    )["sub"] == claims["sub"]
    with pytest.raises(jwt.InvalidTokenError):
        await auth._decode_token(token, Settings(supabase_jwt_secret=None))
