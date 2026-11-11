from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings
from .content import load_weeks
from .db import init_db

API_PREFIX = "/api/fde"


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_weeks()  # fail fast if a content file is invalid
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="FDE Learning", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix=API_PREFIX)

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
