"""Observability primitives (M0): request IDs, JSON logs, Sentry.

All three are env-gated and safe to call from `main.py` unconditionally:

  * `install_json_logging()` — replaces the root handler with a single-line
    JSON formatter. Always on; cheap. Ships log records that Render's log
    pipeline can index by field instead of regex-grepping a pretty string.

  * `install_request_id(app)` — adds an ASGI middleware that mints a
    request id (or trusts an inbound `X-Request-Id`), stuffs it into a
    contextvar so the JSON formatter can attach it to every log line for
    that request, and echoes it back in the response header so clients can
    quote it in bug reports.

  * `install_sentry()` — only fires when `SENTRY_DSN` is set. Lets us
    deploy without Sentry credentials (dev / preview branches) and turn
    error reporting on per-environment via Render env vars.

Keep this module thin — every line of glue here runs at app startup, so
broken observability shouldn't be able to break the app.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# ---- request id contextvar -------------------------------------------------

# Bound by RequestIdMiddleware before each request, read by the log formatter.
# Default empty so log calls outside a request still format cleanly (startup,
# background tasks, tests).
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")


def current_request_id() -> str:
    """Return the request id bound to the current task, or '' if none."""
    return request_id_ctx.get()


# ---- JSON log formatter ----------------------------------------------------


class JsonFormatter(logging.Formatter):
    """Single-line JSON record — one record per line, suitable for Render
    structured-log indexing. Includes the active request id when set.

    We emit exception info inline (as `exc`) so Render's log viewer doesn't
    split a single failure into N stanzas. Standard fields only — no LogRecord
    extras smuggled in via .extra to keep the schema stable across callers.
    """

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = current_request_id()
        if rid:
            payload["rid"] = rid
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def install_json_logging(level: int = logging.INFO) -> None:
    """Replace any default handlers with one JSON-emitting StreamHandler.

    Idempotent: re-running just resets the handler list. Called once from
    main.py module load; tests don't touch it (they let pytest's own handler
    swallow logs so failures don't drown in INFO noise).
    """
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


# ---- request id middleware -------------------------------------------------


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Mint (or trust) a request id, bind it to the contextvar, echo it back.

    We trust inbound `X-Request-Id` so a load balancer / client can correlate
    its own trace with ours. If absent, we mint a short uuid4 hex (12 chars
    — collision-safe for our scale, easier to copy-paste into bug reports
    than a full uuid).

    Also logs a one-line access record on completion, with method/path/status
    /duration_ms. FastAPI/uvicorn already log these in the dev console but
    not in the JSON pipeline — emitting our own keeps the structured log
    self-contained.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        token = request_id_ctx.set(rid)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            # Status may be undefined if call_next raised before producing one;
            # the exception will already be logged by FastAPI's own handler.
            try:
                status = response.status_code  # type: ignore[name-defined]
            except (NameError, UnboundLocalError):
                status = 500
            logging.getLogger("storyforge.access").info(
                "%s %s -> %s in %sms",
                request.method,
                request.url.path,
                status,
                duration_ms,
            )
            request_id_ctx.reset(token)
        response.headers["X-Request-Id"] = rid
        return response


def install_request_id(app) -> None:
    """Mount the middleware. Called once from main.py."""
    app.add_middleware(RequestIdMiddleware)


# ---- sentry ----------------------------------------------------------------


def install_sentry() -> None:
    """Initialize Sentry iff SENTRY_DSN is set.

    Silent no-op when DSN is missing so dev + preview builds never break for
    lack of Sentry creds. Uses the FastAPI integration (auto-captures
    HTTPExceptions and unhandled errors) plus the logging integration at
    ERROR-and-above (so log.exception() events also reach Sentry).
    """
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        # sentry-sdk is in requirements.txt but be defensive — a minimal dev
        # env without it shouldn't 500 the whole app.
        logging.getLogger("storyforge").warning("SENTRY_DSN set but sentry-sdk not installed; skipping init")
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENV") or os.environ.get("RENDER_SERVICE_NAME") or "dev",
        # Trace sampling kept off by default — flip via SENTRY_TRACES_SAMPLE_RATE
        # when we want perf traces. Tracing has overhead and we'd rather opt in
        # per-environment than pay it always.
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE") or 0),
        send_default_pii=False,  # never ship PII without an explicit decision
        integrations=[
            FastApiIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    logging.getLogger("storyforge").info("Sentry initialized for env=%s", os.environ.get("SENTRY_ENV") or "dev")
