"""Common JSON response contract shared by every module, plus validation helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

COMPONENTS = (
    "log_analysis",
    "rca_security_analysis",
    "knowledge_retrieval",
    "remediation",
    "communication",
)
MODULE_STATUSES = ("completed", "in_progress", "failed")
SEVERITIES = ("critical", "high", "medium", "low", "info")
PRIORITIES = ("critical", "high", "medium", "low")
TOP_LEVEL_FIELDS = (
    "incident_id", "component", "status", "timestamp", "summary",
    "findings", "evidence", "recommendations", "data", "error",
)

FINDING_FIELDS = {"finding_id": str, "title": str, "description": str, "severity": str}
EVIDENCE_FIELDS = {"source": str, "reference": str, "content": str, "relevance": str}
RECOMMENDATION_FIELDS = {"recommendation_id": str, "action": str, "reason": str, "priority": str}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_error_response(incident_id: str, component: str, code: str, message: str,
                        details: Any = None) -> dict:
    """Build a contract-compliant failed response."""
    return {
        "incident_id": incident_id,
        "component": component,
        "status": "failed",
        "timestamp": utc_now(),
        "summary": f"{component} failed: {message}",
        "findings": [],
        "evidence": [],
        "recommendations": [],
        "data": {},
        "error": {"code": code, "message": message, "details": details},
    }


def _is_iso_utc(value: Any) -> bool:
    if not isinstance(value, str) or not (value.endswith("Z") or value.endswith("+00:00")):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _check_items(items: list, name: str, fields: dict, errors: list) -> None:
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"{name}[{i}] must be an object")
            continue
        for field, typ in fields.items():
            if not isinstance(item.get(field), typ) or not item.get(field):
                errors.append(f"{name}[{i}].{field} must be a non-empty {typ.__name__}")


def validate_module_response(response: Any, expected_incident_id: str,
                             expected_component: str) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). A response is acceptable only when errors is empty."""
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(response, dict):
        return ["response must be a JSON object"], warnings

    keys = set(response)
    missing = [f for f in TOP_LEVEL_FIELDS if f not in keys]
    extra = sorted(keys - set(TOP_LEVEL_FIELDS))
    if missing:
        errors.append(f"missing fields: {', '.join(missing)}")
    if extra:
        errors.append(f"unexpected top-level fields: {', '.join(extra)}")
    if missing:
        return errors, warnings

    if response["incident_id"] != expected_incident_id:
        errors.append(f"incident_id mismatch: expected {expected_incident_id}, got {response['incident_id']!r}")
    if response["component"] != expected_component:
        errors.append(f"component mismatch: expected {expected_component}, got {response['component']!r}")
    if response["status"] not in MODULE_STATUSES:
        errors.append(f"invalid status {response['status']!r}")
    if not _is_iso_utc(response["timestamp"]):
        errors.append("timestamp must be an ISO 8601 UTC string")
    if not isinstance(response["summary"], str):
        errors.append("summary must be a string")
    for list_field in ("findings", "evidence", "recommendations"):
        if not isinstance(response[list_field], list):
            errors.append(f"{list_field} must be an array")
    if not isinstance(response["data"], dict):
        errors.append("data must be an object")
    if errors:
        return errors, warnings

    _check_items(response["findings"], "findings", FINDING_FIELDS, errors)
    _check_items(response["evidence"], "evidence", EVIDENCE_FIELDS, errors)
    _check_items(response["recommendations"], "recommendations", RECOMMENDATION_FIELDS, errors)
    for i, f in enumerate(response["findings"]):
        if isinstance(f, dict):
            if f.get("severity") not in SEVERITIES:
                errors.append(f"findings[{i}].severity invalid")
            conf = f.get("confidence")
            if conf is not None and (isinstance(conf, bool) or not isinstance(conf, (int, float)) or not 0 <= conf <= 1):
                errors.append(f"findings[{i}].confidence must be between 0 and 1 or null")
    for i, r in enumerate(response["recommendations"]):
        if isinstance(r, dict):
            if r.get("priority") not in PRIORITIES:
                errors.append(f"recommendations[{i}].priority invalid")
            if not isinstance(r.get("requires_approval"), bool):
                errors.append(f"recommendations[{i}].requires_approval must be a boolean")

    err = response["error"]
    if response["status"] == "failed":
        if not isinstance(err, dict) or not isinstance(err.get("code"), str) or not isinstance(err.get("message"), str):
            errors.append("failed responses require error {code, message, details}")
    elif err is not None:
        errors.append("error must be null unless status is failed")

    if response["findings"] and not response["evidence"]:
        warnings.append("findings reported without supporting evidence")
    return errors, warnings
