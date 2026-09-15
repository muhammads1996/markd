from pathlib import PurePosixPath

import httpx

from app.core.config import Settings


async def upload_private_object(
    settings: Settings,
    bucket_id: str,
    object_path: str,
    content: bytes,
    content_type: str,
) -> None:
    if not settings.supabase_service_role_key:
        raise RuntimeError("Supabase service role configuration is unavailable")
    safe_path = str(PurePosixPath(object_path))
    url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/"
        f"{bucket_id}/{safe_path}"
    )
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, headers=headers, content=content)
    response.raise_for_status()


async def delete_private_object(
    settings: Settings,
    bucket_id: str,
    object_path: str,
) -> None:
    if not settings.supabase_service_role_key:
        raise RuntimeError("Supabase service role configuration is unavailable")
    safe_path = str(PurePosixPath(object_path))
    url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/"
        f"{bucket_id}/{safe_path}"
    )
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.delete(url, headers=headers)
    response.raise_for_status()