import asyncio
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, str(Path(__file__).resolve().parent))


if __name__ == "__main__":
    import uvicorn

    class MarkdConfig(uvicorn.Config):
        def get_loop_factory(self):
            return asyncio.SelectorEventLoop

    uvicorn.Server(
        MarkdConfig("app.main:app", host="0.0.0.0", port=8000)
    ).run()