"""Communication module: stakeholder updates grounded only in workflow state."""
from __future__ import annotations

import json
from typing import Any, Callable

from . import config
from .contract import make_error_response, utc_now, validate_module_response
from .llm import LLMError, groq_json_completion

UPSTREAM = ("log_analysis", "rca_security_analysis", "knowledge_retrieval", "remediation")
UPDATE_KEYS = ("developer_update", "management_update", "customer_update")

SYSTEM_PROMPT = """You are the communication officer in an incident war room.
Write stakeholder updates using ONLY the facts in the provided JSON context.
Rules:
- Never invent errors, causes, impact, numbers, or timelines not present in the context.
- If a module is not completed, say its information is unavailable.
- A root cause with status "suspected" must be described as probable/suspected, never confirmed.
- Recommendations are proposals. Never state an action was executed unless it is listed in
  resolution.executed_actions. Distinguish recommended, approved and executed actions.
- If is_mock_data is true, begin every update with "[MOCK DATA]".
- customer_update: plain language, user-facing impact only, no internal hostnames, stack traces,
  database names or other internal details, no promises of exact fix times.
- resolution_summary: only if resolution.resolved is true; otherwise it MUST be null.
Return a JSON object with exactly these keys:
{"developer_update": str, "management_update": str, "customer_update": str, "resolution_summary": str | null}"""


def build_context(state: dict) -> dict:
    details = state.get("incident_details", {})
    modules: dict[str, Any] = {}
    for comp in UPSTREAM:
        resp = state.get(comp)
        status = state.get("component_status", {}).get(comp, "pending")
        if not resp or resp.get("status") != "completed":
            modules[comp] = {"status": status, "available": False,
                             "error": (resp or {}).get("error")}
            continue
        data = resp.get("data", {})
        modules[comp] = {
            "status": status,
            "available": True,
            "summary": resp["summary"],
            "findings": resp["findings"],
            "evidence": resp["evidence"][:5],
            "recommendations": resp["recommendations"],
            "data": {k: v for k, v in data.items() if k != "mock_fixture"},
        }
    return {
        "incident_id": state["incident_id"],
        "title": details.get("title"),
        "description": details.get("description"),
        "severity": details.get("severity"),
        "affected_services": details.get("affected_services", []),
        "is_mock_data": state.get("execution_mode") == "mock",
        "modules": modules,
        "approvals": state.get("approvals", []),
        "resolution": state.get("resolution") or {"resolved": False, "executed_actions": []},
    }


def _template_updates(ctx: dict) -> dict:
    """Deterministic text built strictly from context (used only when explicitly enabled)."""
    prefix = "[MOCK DATA] " if ctx["is_mock_data"] else ""
    m = ctx["modules"]
    rca = m["rca_security_analysis"]
    root = (rca.get("data", {}).get("root_cause") or {}) if rca["available"] else {}
    cause = (f"{root.get('status', 'suspected')} root cause: {root['description']}"
             if root.get("description") else "root cause: unavailable")
    recs = m["remediation"].get("recommendations", []) if m["remediation"]["available"] else []
    rec_text = "; ".join(r["action"] for r in recs) or "no remediation recommendations available"
    unavailable = [c for c, v in m.items() if not v["available"]]
    gaps = f" Unavailable modules: {', '.join(unavailable)}." if unavailable else ""
    resolution = ctx["resolution"]
    resolved_text = None
    if resolution.get("resolved"):
        executed = ", ".join(resolution.get("executed_actions") or []) or "none confirmed"
        approved = ", ".join(a["recommendation_id"] for a in ctx["approvals"] if a["decision"] == "approved") or "none"
        resolved_text = (f"{prefix}Incident {ctx['incident_id']} marked resolved. {cause}. "
                         f"Recommended: {rec_text}. Approved: {approved}. Executed (confirmed): {executed}. "
                         f"Notes: {resolution.get('notes') or 'none'}.")
    return {
        "developer_update": f"{prefix}{ctx['incident_id']} ({ctx['severity']}): {ctx['description']} "
                            f"{m['log_analysis'].get('summary', 'Log analysis unavailable.')} {cause}. "
                            f"Proposed next steps (not executed): {rec_text}.{gaps}",
        "management_update": f"{prefix}{ctx['title']} - severity {ctx['severity']}. Affected services: "
                             f"{', '.join(ctx['affected_services']) or 'unavailable'}. Investigation: {cause}. "
                             f"Recommended actions are awaiting engineer approval.{gaps}",
        "customer_update": f"{prefix}Some customers may be experiencing issues: {ctx['title'].lower()}. "
                           f"Our engineers are actively investigating and we will share updates as they become available.",
        "resolution_summary": resolved_text,
    }


def generate_communication(state: dict,
                           llm: Callable[[str, str], dict] = groq_json_completion) -> dict:
    """Return a contract response for component 'communication'."""
    incident_id = state["incident_id"]
    ctx = build_context(state)
    method = "llm"
    try:
        out = llm(SYSTEM_PROMPT, json.dumps(ctx, default=str))
    except LLMError as exc:
        if config.get("COMMUNICATION_FALLBACK", "none") != "template":
            return make_error_response(incident_id, "communication", exc.code, str(exc))
        out, method = _template_updates(ctx), "template"

    if not isinstance(out, dict) or any(not isinstance(out.get(k), str) or not out[k].strip() for k in UPDATE_KEYS):
        return make_error_response(incident_id, "communication", "LLM_MALFORMED_RESPONSE",
                                   "LLM output missing required update fields")
    resolved = bool(ctx["resolution"].get("resolved"))
    summary_text = out.get("resolution_summary")
    # Never publish a resolution summary for an unresolved incident.
    resolution_summary = summary_text if resolved and isinstance(summary_text, str) and summary_text.strip() else None

    response = {
        "incident_id": incident_id,
        "component": "communication",
        "status": "completed",
        "timestamp": utc_now(),
        "summary": "Incident communication updates generated.",
        "findings": [],
        "evidence": [],
        "recommendations": [],
        "data": {
            **{k: out[k].strip() for k in UPDATE_KEYS},
            "resolution_summary": resolution_summary,
            "generation_method": method,
            "based_on_mock_data": ctx["is_mock_data"],
            "unavailable_inputs": [c for c, v in ctx["modules"].items() if not v["available"]],
        },
        "error": None,
    }
    errors, _ = validate_module_response(response, incident_id, "communication")
    if errors:
        return make_error_response(incident_id, "communication", "INVALID_RESPONSE", "; ".join(errors))
    return response
