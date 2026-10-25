"""App server: static UI and the stateless /v1 API."""

import shutil
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

BUILD = Path(__file__).resolve().parents[2] / "web" / "build"

app = FastAPI(title="Open Book Reader")


@app.get("/v1/health")
def health() -> dict[str, object]:
    return {
        "version": "0.1.0",
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "maxBodyBytes": 32 * 1024 * 1024,
    }


class SinglePage(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            response = await super().get_response("index.html", scope)
        if response.status_code == 404:
            response = await super().get_response("index.html", scope)
        return response


def mount_ui() -> None:
    if not (BUILD / "index.html").is_file():
        raise RuntimeError(f"Web build is missing at {BUILD}. Run npm run build in apps/web.")
    app.mount("/", SinglePage(directory=BUILD), name="ui")


mount_ui()
