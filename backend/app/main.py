from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .admin import load_assignments, load_build_log, router as admin_router
from .api import router
from .course import router as course_router
from .google_auth import router as google_router
from .grading import load_grading, router as grading_router
from .config import get_settings
from .content import load_course, load_weeks
from .db import init_db

API_PREFIX = "/api/fde"


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_weeks()  # fail fast if a content file is invalid
    load_course()
    load_assignments()
    load_build_log()
    load_grading()
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
    app.include_router(course_router, prefix=API_PREFIX)
    app.include_router(google_router, prefix=API_PREFIX)
    app.include_router(admin_router, prefix=API_PREFIX)
    app.include_router(grading_router, prefix=API_PREFIX)

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
