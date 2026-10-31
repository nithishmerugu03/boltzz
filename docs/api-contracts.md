# RCA and Security agent contract

These are module-level JavaScript interfaces for the central orchestrator. No HTTP route or shared orchestrator is implemented here.

## Imports

```js
import { runRcaAgent, runRcaSecurityAnalysis } from "../agents/rcaAgent.js";
import { runSecurityAgent } from "../agents/securityAgent.js";

const rca = await runRcaAgent(incident, similarIncidents);
const security = await runSecurityAgent(incident);
const combined = await runRcaSecurityAnalysis(incident, similarIncidents);
```

`runRcaAgent(incident, similarIncidents = [], options = {})` accepts one incident object, optional historical retrieval results, and optional test/runtime options. In normal use it reads `GROQ_API_KEY`, `GROQ_MODEL`, and `GROQ_TIMEOUT_MS` from the backend environment. `options.useLLM = false` selects deterministic analysis; `options.client` is intended for tests.

`runSecurityAgent(incident)` is deterministic and does not call an LLM. `runRcaSecurityAnalysis` runs both analyses and merges them into one response for the central workflow. Each export returns the same contract envelope with component identifier `rca_security_analysis`.

## Incident input

Both agents accept the same loose incident envelope:

```js
{
  incident_id: "INC-123",
  service: "payment-service",
  severity: "high",
  description: "Payment requests are failing",
  logs: [{ id: "LOG-1", message: "...", timestamp: "2026-10-31T10:00:00Z", severity: "ERROR" }],
  events: [{ id: "EVENT-1", type: "alert", message: "...", timestamp: "2026-10-31T10:01:00Z" }],
  parsedEvents: [],
  correlatedEvents: [],
  metrics: [{ id: "METRIC-1", metricName: "auth_requests", value: 100, baseline: 10 }],
  deployments: [],
  timeline: []
}
```

The incident identifier may be supplied as `incident_id`, `incidentId`, or `id`. Evidence arrays are optional. An evidence item may use `id`, `evidenceId`, `eventId`, `logId`, or `metricId`; `timestamp`, `time`, `createdAt`, or `occurredAt`; `severity` or `level`; and `message`, `msg`, `description`, `error`, `event`, `name`, or `metricName`. Unknown event types are accepted. Items without source IDs remain visible only as unlinked inputs and cannot be cited. Repeated IDs after the first occurrence are ignored with a warning.

The RCA agent accepts historical results separately:

```js
[
  {
    incidentId: "HIST-1",
    service: "payment-service",
    validatedRootCause: "Database connection exhaustion",
    similarityScore: 0.91,
    reference: "KB-1"
  }
]
```

Historical results are contextual only; they are not current-incident evidence and are not included among current evidence IDs.

## Response schema

Every successful or failed result has exactly these top-level fields:

```js
{
  incident_id: "INC-123",
  component: "rca_security_analysis",
  status: "completed", // "in_progress" or "failed" are also allowed
  timestamp: "2026-10-31T10:30:00.000Z",
  summary: "Short analysis summary.",
  findings: [{
    finding_id: "FIND-RCA-001",
    title: "Probable cause",
    description: "Evidence-led explanation and validation context.",
    severity: "medium", // critical, high, medium, low, info
    confidence: null // number from 0 to 1, or null
  }],
  evidence: [{
    source: "log",
    reference: "LOG-1",
    content: "Relevant source content",
    relevance: "How the evidence supports or contextualizes a finding."
  }],
  recommendations: [{
    recommendation_id: "REC-RCA-001",
    action: "Validate the probable cause.",
    reason: "Confirm the hypothesis before deciding on remediation.",
    priority: "high", // high, medium, low
    requires_approval: true
  }],
  data: {
    probable_root_cause: "Database connection exhaustion",
    root_cause_category: "database",
    root_cause_confidence: null,
    affected_components: ["payment-service"],
    security_analysis: {
      risk_detected: false,
      risk_level: "unknown", // critical, high, medium, low, unknown
      threats: [],
      security_observations: []
    },
    reasoning: "Evidence supports this as a hypothesis, not a confirmed cause."
  },
  error: null
}
```

The `data` object contains only the assigned RCA/Security fields shown above. Root-cause categories are `database`, `memory`, `authentication`, `dependency`, `deployment`, or `null` when evidence is insufficient. Confidence remains `null` unless a calibrated value is available. The `security_analysis` fields are always returned, including when evidence is insufficient; `unknown` coverage must not be interpreted as a clean security assessment.

On failure, `status` is `failed` and `error` is `{ code, message, details: null }`. On success, `error` is `null`. Findings, evidence, and recommendations are arrays even when empty. Evidence references are restricted to IDs present in the current incident.

## Analysis behavior and integration boundary

- RCA categories are selected from deterministic evidence rules. Optional Groq output is accepted only when its category and citations are corroborated; otherwise the explicit deterministic fallback is used.
- Historical context is not treated as proof or current incident evidence.
- Security rules identify possible anomalies, not confirmed attacks. Missing security-relevant evidence yields `unknown`, never an assertion that the service is secure.
- Monitoring/log processing should provide parsed events and evidence identifiers; these agents do not parse raw uploaded files or replace event correlation.
- Knowledge/RAG can provide retrieved results as the second argument to `runRcaAgent` or `runRcaSecurityAnalysis`; these agents do not connect to MongoDB or implement vector search.
- The module does not execute or approve remediation. Recommendations require human review.
- The React pages accept the canonical result via the `result` prop. A host route can render both pages with the combined result:

```jsx
<RCAAnalysis incident={incident} result={combined} />
<SecurityFindings incident={incident} result={combined} />
```

## Incident analysis and Knowledge API

- `POST /api/analysis` accepts an incident JSON object containing a non-empty `incident_id` (aliases `incidentId` and `id` are accepted) and relevant service, description, log, event, metric, or timeline evidence. It returns the canonical RCA/Security response. Historical documents are supplied to RCA as context and are not added as incident evidence. MongoDB retrieval errors are reported in the existing summary and reasoning fields while analysis continues without historical results.
- `GET /api/health` reports whether MongoDB is connected, whether Groq is configured, and the selected retrieval backend. It never returns credentials.
- `/api/knowledge` exposes the Knowledge module's search and document routes; MongoDB must be connected.
- `npm run seed:knowledge` from `backend/` previews synthetic knowledge inserts. Only run `npm run seed:knowledge -- --apply` after confirming the configured database is non-production. The seeder requires `NODE_ENV=development` or `test`, uses only the bundled synthetic dataset, and does not update or delete existing documents.
- Keyword retrieval is the default and does not require an embedding model. Atlas Vector Search or local-vector retrieval must be explicitly configured and provisioned.

## Remediation workflow API contract

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
