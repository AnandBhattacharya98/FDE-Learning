import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .admin import load_assignments, load_build_log, router as admin_router
from .api import router
from .coach import get_index, router as coach_router
from .cohort import router as cohort_router
from .course import router as course_router
from .google_auth import router as google_router
from .grading import load_grading, router as grading_router
from .teacher import router as teacher_router
from .voice import router as voice_router
from .config import get_settings
from .content import load_course, load_glossary, load_weeks
from .db import init_db

API_PREFIX = "/api/fde"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Independent startup work runs in threads at once; any failure still aborts startup.
    await asyncio.gather(*(asyncio.to_thread(f) for f in (
        load_weeks, load_course, load_glossary, load_assignments,
        load_build_log, load_grading, get_index, init_db)))
    yield


def create_app() -> FastAPI:
    local = get_settings().database_url.startswith("sqlite")
    # The API docs are a full route map; keep them to local development.
    docs = {} if local else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="FDE Learning", lifespan=lifespan, **docs)
    max_body = (get_settings().material_max_mb + 1) * 1024 * 1024

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        # Uploads are parsed before the login check runs, so cap request size up front.
        size = request.headers.get("content-length")
        if size and size.isdigit() and int(size) > max_body:
            return JSONResponse({"detail": "That upload is too big."}, status_code=413)
        return await call_next(request)

    app.add_middleware(GZipMiddleware, minimum_size=1000)
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
    app.include_router(coach_router, prefix=API_PREFIX)
    app.include_router(cohort_router, prefix=API_PREFIX)
    app.include_router(grading_router, prefix=API_PREFIX)
    app.include_router(voice_router, prefix=API_PREFIX)
    app.include_router(teacher_router, prefix=API_PREFIX)

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
