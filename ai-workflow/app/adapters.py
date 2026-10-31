"""Integration boundaries for teammate modules.

Every adapter takes an ``AdapterInput`` dict:
    {"incident_id": str, "incident_details": dict, "logs": str, "upstream": {component: response}}
and returns the common JSON contract (see contract.py), always validated.

MOCK mode loads fixtures from app/fixtures (clearly flagged data.mock_fixture=true).
REAL mode POSTs the input to ``<COMPONENT>_URL`` and validates the reply. If the URL is not
configured or the call fails, the adapter reports the module as unavailable/failed; it never
falls back to mock data.
"""
from __future__ import annotations

import copy
import json
import logging
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from . import config
from .contract import make_error_response, utc_now, validate_module_response

log = logging.getLogger(__name__)
FIXTURES = Path(__file__).resolve().parent / "fixtures"


class AdapterResult(dict):
    """{"response": contract dict, "mock": bool, "unavailable": bool, "warnings": [str]}"""


class ModuleAdapter:
    component: str = ""

    def __init__(self, mode: str | None = None, transport: Callable[[dict], Any] | None = None):
        self.mode = mode or config.module_mode()
        # transport lets tests or a future in-process teammate module replace the HTTP call.
        self.transport = transport

    # ---- public API -------------------------------------------------------
    def run(self, payload: dict) -> AdapterResult:
        incident_id = payload["incident_id"]
        unavailable = False
        try:
            raw = self._mock(incident_id) if self.mode == "mock" else self._real(payload)
        except ModuleUnavailable as exc:
            unavailable = True
            raw = make_error_response(incident_id, self.component, "MODULE_UNAVAILABLE", str(exc))
        except Exception as exc:  # noqa: BLE001 - any module crash becomes a failed contract response
            log.warning("%s adapter error: %s", self.component, exc)
            raw = make_error_response(incident_id, self.component, "MODULE_ERROR", str(exc))

        errors, warnings = validate_module_response(raw, incident_id, self.component)
        if errors:
            raw = make_error_response(incident_id, self.component, "INVALID_RESPONSE",
                                      "Module response failed contract validation", {"errors": errors})
        return AdapterResult(response=raw, mock=self.mode == "mock", unavailable=unavailable, warnings=warnings)

    # ---- modes ------------------------------------------------------------
    def _mock(self, incident_id: str) -> dict:
        failing = {c.strip() for c in config.get("MOCK_FAIL_COMPONENTS").split(",") if c.strip()}
        if self.component in failing:
            return make_error_response(incident_id, self.component, "MOCK_FAILURE",
                                       "Simulated failure (MOCK_FAIL_COMPONENTS)")
        fixture = json.loads((FIXTURES / f"{self.component}.json").read_text(encoding="utf-8"))
        fixture = copy.deepcopy(fixture)
        fixture["incident_id"] = incident_id  # fixtures are templates; preserve caller's incident id
        fixture["timestamp"] = utc_now()
        return fixture

    def _real(self, payload: dict) -> Any:
        if self.transport:
            return self.transport(payload)
        url = config.get(f"{self.component.upper()}_URL")
        if not url:
            raise ModuleUnavailable(f"{self.component.upper()}_URL is not configured")
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=float(config.get("MODULE_TIMEOUT", "60"))) as resp:
                body = resp.read().decode()
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ModuleUnavailable(f"{self.component} module unreachable: {exc}") from exc
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON from {self.component}: {exc}") from exc


class ModuleUnavailable(Exception):
    pass


class LogAnalysisAdapter(ModuleAdapter):
    """Shawn: parse/classify/correlate logs. Needs incident_details + logs."""
    component = "log_analysis"


class RCAAnalysisAdapter(ModuleAdapter):
    """Alok: RCA + security. Needs upstream.log_analysis."""
    component = "rca_security_analysis"


class KnowledgeRetrievalAdapter(ModuleAdapter):
    """Nithish: similar incidents/runbooks. Needs upstream.log_analysis."""
    component = "knowledge_retrieval"


class RemediationAdapter(ModuleAdapter):
    """Valli: remediation steps + safety checks. Needs upstream.rca_security_analysis (+ knowledge if available)."""
    component = "remediation"


def default_adapters(mode: str | None = None) -> dict[str, ModuleAdapter]:
    return {a.component: a(mode) for a in
            (LogAnalysisAdapter, RCAAnalysisAdapter, KnowledgeRetrievalAdapter, RemediationAdapter)}
