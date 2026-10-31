"""LangGraph orchestration of the incident war room workflow.

intake -> log_analysis -(ok)-> [rca_security_analysis || knowledge_retrieval] -> investigation_join
       -(rca ok)-> remediation -> communication -> finalize
Failed/unavailable dependencies route straight to communication; skipped modules are marked "skipped".
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from .adapters import ModuleAdapter, default_adapters
from .communication import generate_communication
from .contract import COMPONENTS, utc_now
from .db import Database

# Internal component statuses (UI): pending, in_progress, completed, mock_completed, failed, unavailable, skipped
SUCCESS_STATUSES = ("completed", "mock_completed")


def merge_dict(a: dict, b: dict) -> dict:
    return {**a, **b}


class IncidentState(TypedDict, total=False):
    incident_id: str
    run_id: str
    incident_details: dict
    logs: str
    execution_mode: str
    log_analysis: dict | None
    rca_security_analysis: dict | None
    knowledge_retrieval: dict | None
    remediation: dict | None
    communication: dict | None
    component_status: Annotated[dict, merge_dict]
    audit_events: Annotated[list, operator.add]
    errors: Annotated[list, operator.add]
    approvals: list
    resolution: dict | None
    workflow_status: str
    final_report: dict | None


def compute_progress(component_status: dict) -> int:
    """Percentage of the five components that genuinely succeeded (failed/unavailable/skipped count 0)."""
    done = sum(1 for c in COMPONENTS if component_status.get(c) in SUCCESS_STATUSES)
    return round(done * 100 / len(COMPONENTS))


class WorkflowRunner:
    def __init__(self, db: Database, adapters: dict[str, ModuleAdapter] | None = None,
                 llm: Callable[[str, str], dict] | None = None):
        self.db = db
        self.adapters = adapters or default_adapters()
        self.llm = llm
        self.graph = self._build()

    # ---- helpers ----------------------------------------------------------
    def _event(self, state: IncidentState, event_type: str, message: str, component: str | None = None,
               status: str = "success", details: dict | None = None) -> str:
        ev = self.db.record_event(state["incident_id"], event_type, message, status, component, details,
                                  dedupe=state["run_id"])
        return ev["event_id"]

    def _set_status(self, state: IncidentState, component: str, status: str) -> None:
        self.db.update_incident(state["incident_id"], {f"component_status.{component}": status})

    def _upstream(self, state: IncidentState) -> dict:
        return {c: state.get(c) for c in COMPONENTS[:4] if state.get(c)}

    def _run_module(self, state: IncidentState, component: str) -> dict:
        events = [self._event(state, "COMPONENT_STARTED", f"{component} started.", component)]
        self._set_status(state, component, "in_progress")
        result = self.adapters[component].run({
            "incident_id": state["incident_id"],
            "incident_details": state["incident_details"],
            "logs": state.get("logs", ""),
            "upstream": self._upstream(state),
        })
        response = result["response"]
        errors: list = []
        if response["status"] == "completed":
            status = "mock_completed" if result["mock"] else "completed"
            events.append(self._event(state, "COMPONENT_COMPLETED", response["summary"], component,
                                      details={"mock": result["mock"], "warnings": result["warnings"]}))
        else:
            status = "unavailable" if result["unavailable"] else "failed"
            errors.append({"component": component, **(response["error"] or {})})
            events.append(self._event(state, "COMPONENT_FAILED", response["summary"], component,
                                      status="failure", details={"error": response["error"]}))
        self.db.update_incident(state["incident_id"], {
            component: response, f"component_status.{component}": status,
            f"validation_warnings.{component}": result["warnings"]})
        return {component: response, "component_status": {component: status},
                "audit_events": events, "errors": errors}

    # ---- nodes ------------------------------------------------------------
    def intake(self, state: IncidentState) -> dict:
        self.db.update_incident(state["incident_id"], {
            "workflow_status": "running", "run_id": state["run_id"], "execution_mode": state["execution_mode"],
            "component_status": {c: "pending" for c in COMPONENTS}, "errors": [], "final_report": None,
            **{c: None for c in COMPONENTS}})
        ev = self._event(state, "WORKFLOW_STARTED", f"Workflow started in {state['execution_mode']} mode.",
                         details={"execution_mode": state["execution_mode"]})
        return {"component_status": {c: "pending" for c in COMPONENTS}, "audit_events": [ev],
                "workflow_status": "running"}

    def log_analysis(self, state: IncidentState) -> dict:
        return self._run_module(state, "log_analysis")

    def rca_security_analysis(self, state: IncidentState) -> dict:
        out = self._run_module(state, "rca_security_analysis")
        resp = out["rca_security_analysis"]
        if resp["status"] == "completed":
            data = resp["data"]
            out["audit_events"].append(self._event(
                state, "RCA_GENERATED", data.get("probable_root_cause") or resp["summary"], "rca_security_analysis",
                details={k: data.get(k) for k in
                         ("probable_root_cause", "root_cause_category", "root_cause_confidence")}))
        return out

    def knowledge_retrieval(self, state: IncidentState) -> dict:
        return self._run_module(state, "knowledge_retrieval")

    def investigation_join(self, state: IncidentState) -> dict:
        return {}

    def remediation(self, state: IncidentState) -> dict:
        out = self._run_module(state, "remediation")
        resp = out["remediation"]
        if resp["status"] == "completed" and resp["recommendations"]:
            recs = resp["recommendations"]
            out["audit_events"].append(self._event(
                state, "REMEDIATION_PROPOSED", f"{len(recs)} remediation recommendation(s) proposed (not executed).",
                "remediation", details={"recommendation_ids": [r["recommendation_id"] for r in recs]}))
            needs = [r["recommendation_id"] for r in recs if r["requires_approval"]]
            if needs:
                out["audit_events"].append(self._event(
                    state, "APPROVAL_REQUESTED", f"Human approval requested for {', '.join(needs)}.",
                    "remediation", status="pending", details={"recommendation_ids": needs}))
        return out

    def communication(self, state: IncidentState) -> dict:
        events = [self._event(state, "COMPONENT_STARTED", "communication started.", "communication")]
        self._set_status(state, "communication", "in_progress")
        response = (generate_communication(state, self.llm) if self.llm else generate_communication(state))
        errors: list = []
        if response["status"] == "completed":
            status = "completed"
            events.append(self._event(state, "COMPONENT_COMPLETED", response["summary"], "communication",
                                      details={"generation_method": response["data"]["generation_method"]}))
        else:
            status = "failed"
            errors.append({"component": "communication", **response["error"]})
            events.append(self._event(state, "COMPONENT_FAILED", response["summary"], "communication",
                                      status="failure", details={"error": response["error"]}))
        self.db.update_incident(state["incident_id"], {"communication": response,
                                                       "component_status.communication": status})
        return {"communication": response, "component_status": {"communication": status},
                "audit_events": events, "errors": errors}

    def finalize(self, state: IncidentState) -> dict:
        statuses = dict(state["component_status"])
        for c in COMPONENTS:
            if statuses.get(c) == "pending":
                statuses[c] = "skipped"
        all_ok = all(statuses[c] in SUCCESS_STATUSES for c in COMPONENTS)
        workflow_status = "completed" if all_ok else "completed_with_errors"
        if all(statuses[c] not in SUCCESS_STATUSES for c in COMPONENTS[:4]):
            workflow_status = "failed"
        events = []
        if all_ok:
            events.append(self._event(state, "WORKFLOW_COMPLETED", "Workflow completed; all components succeeded.",
                                      details={"execution_mode": state["execution_mode"]}))
        final_report = {
            "generated_at": utc_now(),
            "execution_mode": state["execution_mode"],
            "workflow_status": workflow_status,
            "progress": compute_progress(statuses),
            "component_status": statuses,
            "incomplete_components": [c for c in COMPONENTS if statuses[c] not in SUCCESS_STATUSES],
            "errors": state.get("errors", []),
        }
        self.db.update_incident(state["incident_id"], {"component_status": statuses,
                                                       "workflow_status": workflow_status,
                                                       "final_report": final_report})
        return {"component_status": statuses, "workflow_status": workflow_status,
                "final_report": final_report, "audit_events": events}

    # ---- routing ----------------------------------------------------------
    @staticmethod
    def after_log_analysis(state: IncidentState) -> list[str] | str:
        if state.get("log_analysis", {}).get("status") == "completed":
            return ["rca_security_analysis", "knowledge_retrieval"]
        return "communication"

    @staticmethod
    def after_investigation(state: IncidentState) -> str:
        rca = state.get("rca_security_analysis") or {}
        return "remediation" if rca.get("status") == "completed" else "communication"

    def _build(self):
        g = StateGraph(IncidentState)
        for name in ("intake", "log_analysis", "rca_security_analysis", "knowledge_retrieval",
                     "investigation_join", "remediation", "communication", "finalize"):
            g.add_node(name, getattr(self, name))
        g.add_edge(START, "intake")
        g.add_edge("intake", "log_analysis")
        g.add_conditional_edges("log_analysis", self.after_log_analysis,
                                ["rca_security_analysis", "knowledge_retrieval", "communication"])
        g.add_edge(["rca_security_analysis", "knowledge_retrieval"], "investigation_join")
        g.add_conditional_edges("investigation_join", self.after_investigation, ["remediation", "communication"])
        g.add_edge("remediation", "communication")
        g.add_edge("communication", "finalize")
        g.add_edge("finalize", END)
        return g.compile()

    # ---- entry point ------------------------------------------------------
    def run(self, incident: dict, run_id: str, execution_mode: str) -> dict[str, Any]:
        initial: IncidentState = {
            "incident_id": incident["incident_id"],
            "run_id": run_id,
            "incident_details": {k: incident.get(k) for k in
                                 ("title", "description", "severity", "affected_services", "created_at")},
            "logs": incident.get("logs", ""),
            "execution_mode": execution_mode,
            "component_status": {},
            "audit_events": [],
            "errors": [],
            "approvals": incident.get("approvals", []),
            "resolution": incident.get("resolution"),
        }
        try:
            return self.graph.invoke(initial)
        except Exception as exc:  # preserve partial results already persisted per node
            self.db.update_incident(incident["incident_id"], {
                "workflow_status": "failed",
                "workflow_error": {"code": "WORKFLOW_ERROR", "message": str(exc)}})
            raise
