# Remediation workflow API contract

Every remediation API response uses this exact top-level shape:

```json
{
  "incident_id": "INC-101",
  "component": "remediation",
  "status": "completed",
  "timestamp": "2026-10-31T10:30:00.000Z",
  "summary": "Remediation recommendations generated and saved for engineer review.",
  "findings": [],
  "evidence": [],
  "recommendations": [],
  "data": {
    "remediation_steps": [],
    "safety_check": { "status": "passed", "warnings": [] },
    "approval_required": false,
    "execution_status": "pending_engineer_review"
  },
  "error": null
}
```

The only allowed `status` values are `completed`, `in_progress`, and `failed`. On failure, `error` is `{ "code": "ERROR_CODE", "message": "Short description", "details": null }`; all common fields remain present. Timestamps are generated in ISO 8601 UTC. The `incident_id` is copied from the request or persisted plan. Unavailable values are `null`. Findings distinguish suspected root cause from confirmed input evidence and use `confidence: null` unless a calibrated confidence was explicitly supplied. Evidence is copied from RCA input and references its original array index.

Module `data` always contains `remediation_steps` (`step_number`, `action`, `expected_outcome`, `risk_level`), `safety_check` (`status`, `warnings`), `approval_required`, and `execution_status`. It can also contain remediation-owned persistence and UI fields such as `plan`, `plans`, `plan_id`, `runbook_validation`, and `engineer_review_status`. It does not contain output assigned to other agents. `execution_status` is descriptive only; this module never executes operational changes.

## Endpoints

Base path: `/api/remediation`. Persistence routes require a connected MongoDB Atlas database (`MONGODB_URI`); otherwise they return the same JSON envelope with HTTP 503.

- `POST /api/remediation/generate` — accepts RCA input. `incident_id` / `root_cause` snake-case fields are preferred; `incidentId` / `rootCause` aliases are accepted for the existing UI. `evidence` is an array of source strings. Returns HTTP 201 and the common envelope with the plan in `data.plan`.
- `GET /api/remediation/:incidentId` or `GET /api/remediation/?incident_id=INC-101` — returns plans in `data.plans` in newest-first order.
- `PATCH /api/remediation/:planId/steps/:stepId` — accepts `{ "status": "REVIEWED" }` or `{ "status": "COMPLETED" }` and returns the updated `data.plan`.
- `POST /api/remediation/:planId/validate` — accepts `{}` and returns updated runbook results under `data.plan` and `data.runbook_validation`.
- `POST /api/remediation/:planId/review` — accepts `{ "stepId": "...", "decision": "APPROVE|REJECT|REQUEST_CHANGES", "reason": "...", "reviewer": "Engineer name" }`. Non-approval decisions require a reason. Result includes `data.approval_integration` and `data.plan`.
- `GET /api/health` — same common envelope; service health fields are under `data`.

## Integration boundaries

This checkout does not contain shared authentication or Shaanvi's workflow API. The local reviewer name is an audit label, not verified identity; `data.approval_integration.mode` is `LOCAL_TEMPORARY` and reports `integrated: false`. Sample runbooks are marked `SIMULATED_SAMPLE_RUNBOOK`, not Nithish's knowledge base. Do not expose the local review endpoint outside a trusted demo until authenticated identity and workflow authorization are connected.
