import asyncio
import logging
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, str(Path(__file__).resolve().parent))


async def run_worker(continuous: bool = False) -> None:
    from app.core.config import get_settings
    from app.integrations.database import Database
    from app.workers.whatsapp import (
        run_command_outbox_jobs,
        run_delivery_jobs,
        run_processing_jobs,
    )

    settings = get_settings()
    database = Database(settings)
    await database.open()
    try:
        while True:
            try:
                await run_processing_jobs(database, settings)
                await run_command_outbox_jobs(database)
                await run_delivery_jobs(database, settings)
            except Exception:
                logging.exception("FastAPI WhatsApp worker pass failed")
                if not continuous:
                    raise
            if not continuous:
                break
            await asyncio.sleep(settings.worker_poll_interval_seconds)
    finally:
        await database.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "worker":
        asyncio.run(run_worker(continuous="--continuous" in sys.argv[2:]))
        raise SystemExit(0)

    if os.getenv("MARKD_PROCESS_ROLE") == "worker":
        asyncio.run(run_worker(continuous=True))
        raise SystemExit(0)

    import uvicorn

    class MarkdConfig(uvicorn.Config):
        def get_loop_factory(self):
            return asyncio.SelectorEventLoop

    uvicorn.Server(
        MarkdConfig("app.main:app", host="0.0.0.0", port=8000, access_log=False)
    ).run()