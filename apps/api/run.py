import asyncio
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, str(Path(__file__).resolve().parent))


async def run_worker() -> None:
    from app.core.config import get_settings
    from app.integrations.database import Database
    from app.workers.whatsapp import run_delivery_jobs, run_processing_jobs

    settings = get_settings()
    database = Database(settings)
    await database.open()
    try:
        await run_processing_jobs(database, settings)
        await run_delivery_jobs(database, settings)
    finally:
        await database.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "worker":
        asyncio.run(run_worker())
        raise SystemExit(0)

    import uvicorn

    class MarkdConfig(uvicorn.Config):
        def get_loop_factory(self):
            return asyncio.SelectorEventLoop

    uvicorn.Server(
        MarkdConfig("app.main:app", host="0.0.0.0", port=8000)
    ).run()