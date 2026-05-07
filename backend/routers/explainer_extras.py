"""Persona-toggle and what-if simulator endpoints.

Routes:
  POST /api/extractions/{id}/persona/{name}  → SSE stream of persona-rewritten sections
  POST /api/extractions/{id}/simulate         → JSON SimulationResult
"""
from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlmodel import Session

from auth.deps import CurrentUser, current_user
from db.models import Extraction
from db.session import get_session
from services.byok import resolve_user_byok
from services.persona import PERSONA_BRIEFS, stream_persona
from services.simulator import simulate

log = logging.getLogger("storyforge.explainer_extras")

router = APIRouter(prefix="/api/extractions", tags=["explainer-extras"])


def _owned_extraction(session: Session, extraction_id: str, user: CurrentUser) -> Extraction:
    row = session.get(Extraction, extraction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found")
    if row.user_id != user.user_id:
        if not (row.org_id and row.org_id == user.org_id):
            raise HTTPException(status_code=404, detail="Extraction not found")
    return row


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ---- persona ---------------------------------------------------------------


@router.post("/{extraction_id}/persona/{persona_name}")
async def regenerate_persona_endpoint(
    extraction_id: str,
    persona_name: str,
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(current_user)],
):
    if persona_name not in PERSONA_BRIEFS:
        raise HTTPException(status_code=400, detail=f"Unknown persona: {persona_name}")

    row = _owned_extraction(session, extraction_id, user)
    payload = row.lens_payload or {}
    sections = (payload.get("plain_english") or {}).get("sections") or []
    if not sections:
        raise HTTPException(status_code=400, detail="Extraction has no plain-English sections to rewrite.")

    api_key, _ = resolve_user_byok(session, user.user_id, None)

    # Snapshot for the generator closure; the request session is gone
    # before Starlette iterates the stream.
    _sections = [{"heading": s.get("heading") or "", "body": s.get("body") or ""} for s in sections]
    _api_key = api_key
    _persona = persona_name

    def event_gen():
        yield _sse("start", {"persona": _persona})
        try:
            for ev in stream_persona(
                sections=_sections,
                persona=_persona,
                api_key=_api_key,
                model=None,
            ):
                if ev["type"] == "stage":
                    yield _sse("stage", {"name": ev["name"]})
                elif ev["type"] == "error":
                    yield _sse("error", {"status": ev["status"], "detail": ev["detail"]})
                    return
                elif ev["type"] == "complete":
                    yield _sse("complete", {
                        "persona": _persona,
                        "sections": ev["sections"],
                    })
        except Exception as e:  # noqa: BLE001
            log.exception("persona stream crashed")
            yield _sse("error", {"status": 500, "detail": f"Persona stream failed: {e}"})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ---- simulator -------------------------------------------------------------


class SimulateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict[str, str]


@router.post("/{extraction_id}/simulate")
def simulate_endpoint(
    extraction_id: str,
    body: SimulateRequest,
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(current_user)],
):
    row = _owned_extraction(session, extraction_id, user)
    payload = row.lens_payload or {}
    schema = payload.get("simulator_schema")
    if not schema:
        raise HTTPException(status_code=400, detail="This document has no what-if simulator.")

    raw_text = row.raw_text or ""
    if not raw_text:
        raise HTTPException(status_code=400, detail="Source text is missing for this extraction.")

    api_key, _ = resolve_user_byok(session, user.user_id, None)

    try:
        result, usage = simulate(
            raw_text=raw_text,
            schema=schema,
            values=body.values or {},
            api_key=api_key,
            model=None,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("simulator evaluation failed")
        raise HTTPException(status_code=500, detail=f"Simulation failed: {e}") from e

    return {
        "result": result.model_dump(),
        "usage": {
            "input_tokens": usage.input_tokens if usage else 0,
            "output_tokens": usage.output_tokens if usage else 0,
        },
    }
