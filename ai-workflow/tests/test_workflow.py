"""Tests run in MOCK mode with fixtures for teammate modules (not proof of real integration).
Requires a local MongoDB (uses database 'aegisops_test'). LLM calls are stubbed."""
import json
import os
import uuid

import pytest

os.environ["MODULE_MODE"] = "mock"
os.environ["MONGODB_DB"] = "aegisops_test"
os.environ["GROQ_API_KEY"] = ""
os.environ["COMMUNICATION_FALLBACK"] = "none"

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.adapters import LogAnalysisAdapter, RCAAnalysisAdapter, default_adapters  # noqa: E402
from app.communication import generate_communication  # noqa: E402
from app.contract import make_error_response, validate_module_response  # noqa: E402
from app.db import Database, DatabaseUnavailable  # noqa: E402
from app.llm import LLMError  # noqa: E402
from app.workflow import WorkflowRunner, compute_progress  # noqa: E402


def fake_llm(system, user):
    ctx = json.loads(user)
    return {"developer_update": f"[MOCK DATA] dev update for {ctx['incident_id']}",
            "management_update": "[MOCK DATA] mgmt update",
            "customer_update": "[MOCK DATA] Some customers cannot complete checkout. We are investigating.",
            "resolution_summary": "should be dropped unless resolved"}


def failing_llm(system, user):
    raise LLMError("LLM_UNAVAILABLE", "GROQ_API_KEY is not configured")


@pytest.fixture(scope="module")
def db():
    d = Database(db_name="aegisops_test")
    try:
        d.client.admin.command("ping")
    except Exception:
        pytest.skip("MongoDB not reachable")
    d.client.drop_database("aegisops_test")
    return d


def new_incident(db, **kw):
    iid = kw.pop("incident_id", f"INC-T{uuid.uuid4().hex[:6]}")
    db.create_incident({"incident_id": iid, "title": "E-commerce checkout failures",
                        "description": "Users fail to complete purchases.", "severity": "high",
                        "affected_services": ["checkout-service"], "logs": "ERROR pool exhausted",
                        "created_at": "2026-10-31T10:00:00Z", "approvals": [], "resolution": None, **kw})
    return db.get_incident(iid)


def run(db, adapters=None, llm=fake_llm):
    inc = new_incident(db)
    runner = WorkflowRunner(db, adapters or default_adapters("mock"), llm=llm)
    final = runner.run(inc, uuid.uuid4().hex, "mock")
    return inc["incident_id"], final


# ---- contract validation ------------------------------------------------------
def test_fixtures_are_valid_contracts():
    for comp, adapter in default_adapters("mock").items():
        res = adapter.run({"incident_id": "INC-XYZ", "incident_details": {}, "logs": "", "upstream": {}})
        assert res["response"]["status"] == "completed" and res["mock"]
        assert res["response"]["incident_id"] == "INC-XYZ"
        assert res["response"]["data"]["mock_fixture"] is True


def test_rca_fixture_uses_rca_module_field_names():
    """Mock RCA output must match backend/src/utils/agentResponse.js data keys."""
    data = default_adapters("mock")["rca_security_analysis"].run({"incident_id": "INC-1"})["response"]["data"]
    for key in ("probable_root_cause", "root_cause_category", "root_cause_confidence",
                "affected_components", "security_analysis", "reasoning"):
        assert key in data
    assert set(data["security_analysis"]) == {"risk_detected", "risk_level", "threats", "security_observations"}
    assert "root_cause" not in data


def test_validation_rejects_bad_responses():
    good = make_error_response("INC-1", "log_analysis", "X", "y")
    assert validate_module_response(good, "INC-1", "log_analysis")[0] == []
    assert validate_module_response(good, "INC-2", "log_analysis")[0]  # wrong incident id
    missing = {k: v for k, v in good.items() if k != "evidence"}
    assert "missing fields" in validate_module_response(missing, "INC-1", "log_analysis")[0][0]
    extra = {**good, "foo": 1}
    assert validate_module_response(extra, "INC-1", "log_analysis")[0]
    assert validate_module_response("not json", "INC-1", "log_analysis")[0]
    bad_conf = {**good, "status": "completed", "error": None,
                "findings": [{"finding_id": "F", "title": "t", "description": "d", "severity": "high", "confidence": 1.5}]}
    errs, warns = validate_module_response(bad_conf, "INC-1", "log_analysis")
    assert any("confidence" in e for e in errs)
    assert warns == ["findings reported without supporting evidence"]
    empty = {**good, "status": "completed", "error": None}
    assert validate_module_response(empty, "INC-1", "log_analysis") == ([], [])


def test_real_mode_without_module_is_unavailable_not_mock():
    res = LogAnalysisAdapter("real").run({"incident_id": "INC-1", "incident_details": {}, "logs": "", "upstream": {}})
    assert res["unavailable"] and not res["mock"]
    assert res["response"]["error"]["code"] == "MODULE_UNAVAILABLE"
    assert res["response"]["findings"] == []


def test_real_mode_invalid_and_wrong_id_responses_rejected():
    bad_json = RCAAnalysisAdapter("real", transport=lambda p: (_ for _ in ()).throw(ValueError("invalid JSON")))
    assert bad_json.run({"incident_id": "INC-1"})["response"]["error"]["code"] == "MODULE_ERROR"
    wrong = make_error_response("INC-OTHER", "rca_security_analysis", "X", "y")
    res = RCAAnalysisAdapter("real", transport=lambda p: wrong).run({"incident_id": "INC-1"})
    assert res["response"]["error"]["code"] == "INVALID_RESPONSE"
    assert res["response"]["incident_id"] == "INC-1"


# ---- workflow -----------------------------------------------------------------
def test_successful_workflow_and_audit_sequence(db):
    iid, final = run(db)
    assert final["workflow_status"] == "completed"
    assert final["component_status"] == {"log_analysis": "mock_completed", "rca_security_analysis": "mock_completed",
                                         "knowledge_retrieval": "mock_completed", "remediation": "mock_completed",
                                         "communication": "completed"}
    assert compute_progress(final["component_status"]) == 100
    assert final["communication"]["data"]["resolution_summary"] is None  # unresolved
    types = [e["event_type"] for e in db.get_events(iid)]
    assert types[0] == "WORKFLOW_STARTED" and types[-1] == "WORKFLOW_COMPLETED"
    for t in ("RCA_GENERATED", "REMEDIATION_PROPOSED", "APPROVAL_REQUESTED"):
        assert t in types
    rca_event = next(e for e in db.get_events(iid) if e["event_type"] == "RCA_GENERATED")
    assert rca_event["details"] == {"probable_root_cause": "Database connection pool exhaustion in checkout-service",
                                    "root_cause_category": "database", "root_cause_confidence": 0.86}
    assert "REMEDIATION_APPROVED" not in types and "INCIDENT_RESOLVED" not in types
    stored = db.get_incident(iid)
    assert stored["final_report"]["progress"] == 100
    assert all(r["incident_id"] == iid for r in (stored[c] for c in ("log_analysis", "remediation")))


@pytest.mark.parametrize("failing,expected", [
    ("log_analysis", {"log_analysis": "failed", "rca_security_analysis": "skipped",
                      "knowledge_retrieval": "skipped", "remediation": "skipped"}),
    ("rca_security_analysis", {"rca_security_analysis": "failed", "knowledge_retrieval": "mock_completed",
                               "remediation": "skipped"}),
    ("knowledge_retrieval", {"knowledge_retrieval": "failed", "remediation": "mock_completed"}),
    ("remediation", {"remediation": "failed", "communication": "completed"}),
])
def test_module_failures_preserve_partial_results(db, monkeypatch, failing, expected):
    monkeypatch.setenv("MOCK_FAIL_COMPONENTS", failing)
    iid, final = run(db)
    for comp, status in expected.items():
        assert final["component_status"][comp] == status
    assert final["workflow_status"] in ("completed_with_errors", "failed")
    types = [e["event_type"] for e in db.get_events(iid)]
    assert "COMPONENT_FAILED" in types and "WORKFLOW_COMPLETED" not in types
    assert compute_progress(final["component_status"]) < 100
    assert final["communication"]["data"]["unavailable_inputs"]


def test_communication_llm_failure(db):
    iid, final = run(db, llm=failing_llm)
    assert final["component_status"]["communication"] == "failed"
    assert final["communication"]["error"]["code"] == "LLM_UNAVAILABLE"
    assert final["workflow_status"] == "completed_with_errors"


def test_communication_malformed_llm_output():
    state = {"incident_id": "INC-1", "execution_mode": "mock", "incident_details": {}, "component_status": {}}
    resp = generate_communication(state, lambda s, u: {"developer_update": "x"})
    assert resp["error"]["code"] == "LLM_MALFORMED_RESPONSE"


def test_template_fallback_is_labelled(monkeypatch):
    monkeypatch.setenv("COMMUNICATION_FALLBACK", "template")
    state = {"incident_id": "INC-1", "execution_mode": "mock", "component_status": {},
             "incident_details": {"title": "Checkout failures", "description": "d", "severity": "high"}}
    resp = generate_communication(state, failing_llm)
    assert resp["status"] == "completed" and resp["data"]["generation_method"] == "template"
    assert resp["data"]["customer_update"].startswith("[MOCK DATA]")
    assert resp["data"]["resolution_summary"] is None


def test_template_uses_probable_root_cause(monkeypatch):
    monkeypatch.setenv("COMMUNICATION_FALLBACK", "template")
    rca = default_adapters("mock")["rca_security_analysis"].run({"incident_id": "INC-1"})["response"]
    state = {"incident_id": "INC-1", "execution_mode": "mock", "rca_security_analysis": rca,
             "component_status": {"rca_security_analysis": "mock_completed"},
             "incident_details": {"title": "Checkout failures", "description": "d", "severity": "high"}}
    dev = generate_communication(state, failing_llm)["data"]["developer_update"]
    assert "probable (unconfirmed) root cause: Database connection pool exhaustion" in dev
    assert "confidence 86%" in dev


def test_multiple_incidents_independent(db):
    a, fa = run(db)
    b, fb = run(db)
    assert a != b and fa["log_analysis"]["incident_id"] == a and fb["log_analysis"]["incident_id"] == b
    assert all(e["incident_id"] == b for e in db.get_events(b))


def test_audit_dedupe_and_secret_scrub(db):
    e1 = db.record_event("INC-AUD", "COMPONENT_STARTED", "m", component="x", dedupe="run1",
                         details={"api_key": "sk-123", "ok": 1})
    e2 = db.record_event("INC-AUD", "COMPONENT_STARTED", "m", component="x", dedupe="run1")
    assert e1["event_id"] == e2["event_id"] and len(db.get_events("INC-AUD")) == 1
    assert e1["details"]["api_key"] == "[REDACTED]"
    with pytest.raises(ValueError):
        db.record_event("INC-AUD", "MADE_UP", "m")


def test_mongodb_connection_failure():
    bad = Database(uri="mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300", db_name="x")
    with pytest.raises(DatabaseUnavailable):
        bad.get_incident("INC-1")


# ---- API ------------------------------------------------------------------------
@pytest.fixture
def client(db, monkeypatch):
    main._state.clear()
    main._state["db"] = db
    main._state["runner"] = WorkflowRunner(db, default_adapters("mock"), llm=fake_llm)
    return TestClient(main.app)


def test_api_end_to_end_with_approval_and_resolution(client, monkeypatch):
    iid = f"INC-API{uuid.uuid4().hex[:4]}"
    r = client.post("/incidents", json={"incident_id": iid, "title": "E-commerce checkout failures",
                                        "description": "Checkout failing", "severity": "critical",
                                        "affected_services": ["checkout-service"], "logs": "ERROR"})
    assert r.status_code == 201
    assert client.post("/incidents", json={"incident_id": iid, "title": "dup", "description": "dup"}).status_code == 409
    assert client.post("/incidents", json={"title": "x"}).status_code == 422
    assert client.post(f"/incidents/{iid}/start").status_code == 202  # TestClient runs the background task
    status = client.get(f"/incidents/{iid}/status").json()
    assert status["workflow_status"] == "completed" and status["progress"] == 100
    assert client.get(f"/incidents/{iid}/communication").json()["component"] == "communication"

    # approval does not execute anything
    assert client.post(f"/incidents/{iid}/remediation/REC-404/decision",
                       json={"decision": "approved", "reviewer": "eng"}).status_code == 404
    ap = client.post(f"/incidents/{iid}/remediation/REC-002/decision",
                     json={"decision": "approved", "reviewer": "eng"}).json()
    assert ap["executed"] is False

    def resolved_llm(s, u):
        out = fake_llm(s, u)
        out["resolution_summary"] = "[MOCK DATA] Resolved."
        return out
    monkeypatch.setattr(main, "generate_communication", lambda st: generate_communication(st, resolved_llm))
    inc = client.post(f"/incidents/{iid}/resolve", json={"resolved_by": "eng", "executed_actions": []}).json()
    assert inc["communication"]["data"]["resolution_summary"] == "[MOCK DATA] Resolved."

    report = client.get(f"/incidents/{iid}/report").json()
    types = [e["event_type"] for e in report["audit_events"]]
    assert types[0] == "INCIDENT_CREATED"
    assert "REMEDIATION_APPROVED" in types and types[-1] == "INCIDENT_RESOLVED"
    assert "logs" not in report["incident"]
    assert client.get("/incidents/INC-NOPE/report").status_code == 404


def test_api_returns_503_when_db_down(monkeypatch):
    main._state.clear()
    main._state["db"] = Database(uri="mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300", db_name="x")
    r = TestClient(main.app).get("/incidents/INC-1")
    assert r.status_code == 503 and r.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    main._state.clear()
