from dataclasses import dataclass
from functools import lru_cache
from typing import Any, cast
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentActor:
    user_id: UUID
    claims: dict[str, Any]


@lru_cache(maxsize=4)
def _jwks_url(supabase_url: str) -> str:
    return f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


async def _decode_token(token: str, settings: Settings) -> dict[str, Any]:
    header = jwt.get_unverified_header(token)
    algorithm = header.get("alg")
    if algorithm == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 signing secret is not configured")
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
        )

    if algorithm not in {"ES256", "RS256"}:
        raise jwt.InvalidAlgorithmError("unsupported signing algorithm")
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(_jwks_url(settings.supabase_url))
        response.raise_for_status()
        keys = response.json().get("keys", [])

    key_data = next((key for key in keys if key.get("kid") == header.get("kid")), None)
    if key_data is None:
        raise jwt.InvalidTokenError("signing key was not found")
    key = (
        jwt.algorithms.ECAlgorithm.from_jwk(key_data)
        if algorithm.startswith("ES")
        else jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
    )
    return jwt.decode(
        token,
        cast(Any, key),
        algorithms=[algorithm],
        audience=settings.supabase_jwt_audience,
    )


async def get_current_actor(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> CurrentActor:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication is required")
    try:
        claims = await _decode_token(credentials.credentials, settings)
        user_id = UUID(str(claims["sub"]))
    except (KeyError, ValueError, httpx.HTTPError, jwt.PyJWTError) as error:
        raise HTTPException(
            status_code=401, detail="Authentication is invalid"
        ) from error
    return CurrentActor(user_id=user_id, claims=claims)
