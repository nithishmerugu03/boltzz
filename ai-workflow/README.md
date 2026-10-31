# AegisOps AI Workflow (LangGraph + FastAPI)

Owner: workflow orchestration, communication, audit, war room dashboard, final report.

## Run (3 terminals + MongoDB on 127.0.0.1:27017)

```sh
# 1. AI workflow service (port 8000)
cd ai-workflow
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt   # once
cp .env.example .env        # set GROQ_API_KEY; MODULE_MODE=mock until teammates connect
.venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. Express backend (port 5000) - forwards /api/workflow/* to the AI workflow service
cd backend && npm install && npm start

# 3. Frontend (port 5173) - proxies /api to :5000
cd frontend && npm install && npm run dev

# Tests (mock fixtures + stubbed LLM; needs local MongoDB, uses DB "aegisops_test")
cd ai-workflow && .venv/Scripts/python -m pytest -q
```

## Workflow

`intake -> log_analysis -> [rca_security_analysis || knowledge_retrieval] -> investigation_join -> remediation -> communication -> finalize`

- log_analysis failed -> RCA/knowledge/remediation are `skipped`; communication still runs on what exists.
- RCA failed -> remediation `skipped`. Knowledge failure does not block remediation.
- Component statuses: `pending, in_progress, completed, mock_completed, failed, unavailable, skipped`.
- Progress = successful components (completed/mock_completed) / 5. Failed/unavailable/skipped count 0.
- `WORKFLOW_COMPLETED` is recorded only if all 5 components succeed; otherwise `completed_with_errors` (or `failed` if no investigation module succeeded).

## Connecting a teammate module (REAL mode)

Set `MODULE_MODE=real` and the module URL (`LOG_ANALYSIS_URL`, `RCA_SECURITY_ANALYSIS_URL`,
`KNOWLEDGE_RETRIEVAL_URL`, `REMEDIATION_URL`). The adapter POSTs:

```json
{"incident_id": "INC-001", "incident_details": {"title": "...", "description": "...", "severity": "high", "affected_services": []},
 "logs": "raw log text", "upstream": {"log_analysis": {"...common contract..."}}}
```

and expects the common JSON contract back (validated in `app/contract.py`: exact top-level fields, enums,
confidence 0-1, boolean `requires_approval`, matching `incident_id`/`component`). Invalid replies become
`INVALID_RESPONSE` failures; an unset URL/unreachable module becomes `unavailable`. **No fallback to mock data.**
An in-process Python module can instead be passed as `transport=callable` to the adapter.

`data` keys the UI reads (optional): log_analysis `affected_services, error_classification, correlated_events`;
rca `root_cause {description,status: suspected|confirmed,confidence}, security_analysis {attack_detected,summary}`
(security findings use `finding_id` prefix `FIND-SEC`); knowledge `similar_incidents [{incident_id,title,relevance_score,root_cause,resolution}]`;
remediation `safety_checks [{recommendation_id,risk_level,check,passed}]`.

## API (FastAPI; via Express prefix `/api/workflow`)

| Method | Path | Notes |
|---|---|---|
| GET | /health | DB, module mode, LLM configured |
| POST | /incidents | `{incident_id?, title, description, severity, affected_services[], logs}` -> 201, 409 duplicate, 422 invalid |
| GET | /incidents | list |
| POST | /incidents/{id}/start | 202, runs workflow in background; 409 if running |
| GET | /incidents/{id} | full incident with module outputs |
| GET | /incidents/{id}/status | statuses, progress, errors (dashboard polling) |
| GET | /incidents/{id}/audit | AuditEvents, chronological |
| GET | /incidents/{id}/communication | communication contract response |
| GET | /incidents/{id}/report | `{incident, status, audit_events}` |
| POST | /incidents/{id}/remediation/{rec_id}/decision | `{decision: approved|rejected, reviewer, comment}` - records only, never executes |
| POST | /incidents/{id}/resolve | `{resolved_by, notes, executed_actions[]}` - human-confirmed; regenerates communication with resolution summary |

MongoDB unavailable -> 503 `DATABASE_UNAVAILABLE`. Collections: `Incidents`, `AuditEvents`.

## Communication
Groq (`GROQ_API_KEY`, `GROQ_MODEL`) with JSON mode; output validated. Without a key it fails with `LLM_UNAVAILABLE`
unless `COMMUNICATION_FALLBACK=template`, which produces deterministic text from state, labelled `generation_method: "template"`.
`resolution_summary` is always null until the incident is marked resolved.
