from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings


class Database:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._pool: AsyncConnectionPool[AsyncConnection[Any]] | None = None

    @property
    def configured(self) -> bool:
        return bool(self._settings.supabase_db_url)

    async def open(self) -> None:
        if not self._settings.supabase_db_url:
            return
        self._pool = AsyncConnectionPool(
            conninfo=self._settings.supabase_db_url,
            min_size=self._settings.api_database_min_size,
            max_size=self._settings.api_database_max_size,
            open=False,
            kwargs={"row_factory": dict_row},
        )
        await self._pool.open()

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()

    async def check(self) -> bool:
        if self._pool is None:
            return False
        try:
            async with self._pool.connection() as connection:
                await connection.execute("select 1")
            return True
        except Exception:
            return False

    @asynccontextmanager
    async def transaction(
        self,
        actor_user_id: UUID,
        correlation_id: str,
    ) -> AsyncIterator[AsyncConnection[Any]]:
        if self._pool is None:
            raise RuntimeError("API database is not configured")
        async with self._pool.connection() as connection:
            async with connection.transaction():
                await connection.execute(
                    "select set_config('request.jwt.claim.sub', %s, true)",
                    (str(actor_user_id),),
                )
                await connection.execute(
                    "select set_config('app.correlation_id', %s, true)",
                    (correlation_id,),
                )
                yield connection

    @asynccontextmanager
    async def read_transaction(
        self,
        actor_user_id: UUID,
        correlation_id: str,
    ) -> AsyncIterator[AsyncConnection[Any]]:
        async with self.transaction(actor_user_id, correlation_id) as connection:
            yield connection