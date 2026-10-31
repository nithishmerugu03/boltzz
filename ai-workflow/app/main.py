"""FastAPI service exposing the incident workflow, audit history and reports."""
from __future__ import annotations

import logging
import re
import threading
import uuid
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from . import config
from .communication import generate_communication
from .contract import COMPONENTS, utc_now
from .db import Database, DatabaseUnavailable
from .workflow import WorkflowRunner, compute_progress

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("aegisops")

app = FastAPI(title="AegisOps AI Workflow")
_state: dict = {}
_lock = threading.Lock()


def get_db() -> Database:
    if "db" not in _state:
        _state["db"] = Database()
    return _state["db"]


def get_runner() -> WorkflowRunner:
    if "runner" not in _state:
        _state["runner"] = WorkflowRunner(get_db())
    return _state["runner"]


@app.exception_handler(DatabaseUnavailable)
async def db_unavailable(_: Request, exc: DatabaseUnavailable):
    return JSONResponse(status_code=503, content={"error": {"code": "DATABASE_UNAVAILABLE", "message": str(exc)}})


# ---- schemas -----------------------------------------------------------------
class IncidentCreate(BaseModel):
    incident_id: str | None = Field(default=None, max_length=40)
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=3, max_length=5000)
    severity: Literal["critical", "high", "medium", "low"] = "high"
    affected_services: list[str] = Field(default_factory=list, max_length=50)
    logs: str = Field(default="", max_length=2_000_000)

    @field_validator("incident_id")
    @classmethod
    def check_id(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"[A-Za-z0-9_-]+", v):
            raise ValueError("incident_id may only contain letters, digits, '-' and '_'")
        return v


class Decision(BaseModel):
    decision: Literal["approved", "rejected"]
    reviewer: str = Field(min_length=1, max_length=100)
    comment: str = Field(default="", max_length=1000)


class Resolution(BaseModel):
    resolved_by: str = Field(min_length=1, max_length=100)
    notes: str = Field(default="", max_length=2000)
    executed_actions: list[str] = Field(default_factory=list,
                                        description="Actions a human confirms were actually executed")


# ---- helpers -----------------------------------------------------------------
def _incident_or_404(incident_id: str) -> dict:
    inc = get_db().get_incident(incident_id)
    if not inc:
        raise HTTPException(404, f"Incident {incident_id} not found")
    return inc


def _status_view(inc: dict) -> dict:
    statuses = inc.get("component_status") or {c: "pending" for c in COMPONENTS}
    return {
        "incident_id": inc["incident_id"],
        "workflow_status": inc.get("workflow_status", "created"),
        "execution_mode": inc.get("execution_mode"),
        "component_status": statuses,
        "progress": compute_progress(statuses),
        "errors": [{"component": c, **inc[c]["error"]} for c in COMPONENTS
                   if inc.get(c) and inc[c].get("error")] + ([inc["workflow_error"]] if inc.get("workflow_error") else []),
        "updated_at": inc.get("updated_at"),
    }


def _run_workflow(incident_id: str, run_id: str) -> None:
    try:
        inc = get_db().get_incident(incident_id)
        get_runner().run(inc, run_id, config.module_mode())
    except Exception:  # noqa: BLE001
        log.exception("Workflow for %s failed", incident_id)


# ---- routes ------------------------------------------------------------------
@app.get("/health")
def health():
    try:
        get_db().client.admin.command("ping")
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok", "database": db_ok, "module_mode": config.module_mode(),
            "llm_configured": bool(config.get("GROQ_API_KEY")),
            "communication_fallback": config.get("COMMUNICATION_FALLBACK", "none")}


@app.post("/incidents", status_code=201)
def create_incident(body: IncidentCreate):
    db = get_db()
    incident_id = body.incident_id or f"INC-{uuid.uuid4().hex[:6].upper()}"
    doc = {**body.model_dump(), "incident_id": incident_id, "created_at": utc_now(),
           "workflow_status": "created", "component_status": {c: "pending" for c in COMPONENTS},
           "approvals": [], "resolution": None}
    try:
        inc = db.create_incident(doc)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    db.record_event(incident_id, "INCIDENT_CREATED", f"Incident received: {body.title}",
                    details={"severity": body.severity, "affected_services": body.affected_services},
                    dedupe="create")
    return inc


@app.get("/incidents")
def list_incidents():
    return [{k: i.get(k) for k in ("incident_id", "title", "severity", "workflow_status", "created_at",
                                   "execution_mode")} for i in get_db().list_incidents()]


@app.post("/incidents/{incident_id}/start", status_code=202)
def start_workflow(incident_id: str, background: BackgroundTasks):
    with _lock:
        inc = _incident_or_404(incident_id)
        if inc.get("workflow_status") == "running":
            raise HTTPException(409, "Workflow already running")
        run_id = uuid.uuid4().hex
        get_db().update_incident(incident_id, {"workflow_status": "running", "run_id": run_id})
    background.add_task(_run_workflow, incident_id, run_id)
    return {"incident_id": incident_id, "run_id": run_id, "workflow_status": "running",
            "execution_mode": config.module_mode()}


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: str):
    return _incident_or_404(incident_id)


@app.get("/incidents/{incident_id}/status")
def get_status(incident_id: str):
    return _status_view(_incident_or_404(incident_id))


@app.get("/incidents/{incident_id}/audit")
def get_audit(incident_id: str):
    _incident_or_404(incident_id)
    return get_db().get_events(incident_id)


@app.get("/incidents/{incident_id}/communication")
def get_communication(incident_id: str):
    inc = _incident_or_404(incident_id)
    if not inc.get("communication"):
        raise HTTPException(404, "Communication not generated yet")
    return inc["communication"]


@app.get("/incidents/{incident_id}/report")
def get_report(incident_id: str):
    inc = _incident_or_404(incident_id)
    inc.pop("logs", None)
    return {"incident": inc, "status": _status_view(inc), "audit_events": get_db().get_events(incident_id)}


@app.post("/incidents/{incident_id}/remediation/{recommendation_id}/decision")
def decide(incident_id: str, recommendation_id: str, body: Decision):
    """Record a human approval/rejection. This never executes the action."""
    inc = _incident_or_404(incident_id)
    recs = (inc.get("remediation") or {}).get("recommendations", [])
    if not any(r["recommendation_id"] == recommendation_id for r in recs):
        raise HTTPException(404, f"Recommendation {recommendation_id} not found")
    if any(a["recommendation_id"] == recommendation_id for a in inc.get("approvals", [])):
        raise HTTPException(409, f"Decision already recorded for {recommendation_id}")
    approval = {"recommendation_id": recommendation_id, **body.model_dump(), "decided_at": utc_now(),
                "executed": False}
    db = get_db()
    db.push_incident(incident_id, "approvals", approval)
    db.record_event(incident_id, "REMEDIATION_APPROVED" if body.decision == "approved" else "REMEDIATION_REJECTED",
                    f"{recommendation_id} {body.decision} by {body.reviewer} (not executed).", component="remediation",
                    details=approval, dedupe=recommendation_id)
    return approval


@app.post("/incidents/{incident_id}/resolve")
def resolve(incident_id: str, body: Resolution):
    inc = _incident_or_404(incident_id)
    if inc.get("workflow_status") in ("created", "running"):
        raise HTTPException(409, "Workflow must finish before resolving")
    if inc.get("resolution"):
        raise HTTPException(409, "Incident already resolved")
    resolution = {"resolved": True, **body.model_dump(), "resolved_at": utc_now()}
    db = get_db()
    db.update_incident(incident_id, {"resolution": resolution})
    db.record_event(incident_id, "INCIDENT_RESOLVED", f"Incident marked resolved by {body.resolved_by}.",
                    details=resolution, dedupe="resolve")
    inc = db.get_incident(incident_id)
    comm = generate_communication({**inc, "incident_details": inc, "approvals": inc.get("approvals", [])})
    db.update_incident(incident_id, {"communication": comm,
                                     "component_status.communication": "completed" if comm["status"] == "completed" else "failed"})
    return db.get_incident(incident_id)
