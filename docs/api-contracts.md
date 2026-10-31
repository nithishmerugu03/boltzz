# RCA and Security agent contracts

These are module-level JavaScript interfaces for the central orchestrator. No HTTP route or shared orchestrator is implemented in this module.

## Imports

```js
import { runRcaAgent } from "../agents/rcaAgent.js";
import { runSecurityAgent } from "../agents/securityAgent.js";

const rca = await runRcaAgent(incident, similarIncidents);
const security = await runSecurityAgent(incident);
```

`runRcaAgent(incident, similarIncidents = [], options = {})` accepts one incident object, optional historical retrieval results, and optional test/runtime options. In normal use it reads `GROQ_API_KEY`, `GROQ_MODEL`, and `GROQ_TIMEOUT_MS` from the backend environment. `options.useLLM = false` selects deterministic analysis; `options.client` is intended for tests.

`runSecurityAgent(incident)` is deterministic and does not call an LLM.

## Incident input

Both agents accept the same loose incident envelope:

```js
{
  incidentId: "INC-123",
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

Evidence arrays are optional. An evidence item may use `id`, `evidenceId`, `eventId`, `logId`, or `metricId`; `timestamp`, `time`, `createdAt`, or `occurredAt`; `severity` or `level`; and `message`, `msg`, `description`, `error`, `event`, `name`, or `metricName`. Unknown event types are accepted. Items without source IDs remain visible only as unlinked inputs and cannot be cited. Repeated IDs after the first occurrence are ignored with a warning.

The RCA agent accepts historical results separately:

```js
[
  {
    incidentId: "HIST-1",
    service: "payment-service",
    symptoms: ["connection acquisition timeout"],
    validatedRootCause: "Database connection exhaustion",
    resolution: "Adjusted the pool after review",
    similarityScore: 0.91,
    reference: "KB-1"
  }
]
```

Historical results are contextual only; they are not current-incident evidence and are not included among current evidence IDs.

## RCA output

The stable output envelope is:

```js
{
  agentName: "RCA",
  status: "COMPLETED" | "DEGRADED" | "ERROR",
  summary: "...",
  evidenceIds: ["LOG-1"],
  evidence: [{ id: "LOG-1", source: "log", type: "log", timestamp: "...", service: "...", severity: "ERROR", message: "..." }],
  unsupportedEvidenceIds: [],
  warnings: [],
  details: {
    category: "DATABASE_CONNECTION_EXHAUSTION",
    probableRootCause: "...",
    explanation: "...",
    possibleTriggers: [],
    evidenceSupportScore: 0,
    scoreFactors: {},
    validationSteps: [],
    missingEvidence: [],
    similarIncidents: [],
    mode: "GROQ" | "GROQ_VALIDATED_WITH_WARNINGS" | "RULE_BASED_FALLBACK" | "UNAVAILABLE",
    historicalContextAvailable: true
  }
}
```

Categories are `DATABASE_CONNECTION_EXHAUSTION`, `MEMORY_EXHAUSTION`, `AUTHENTICATION_TRAFFIC_ANOMALY`, `DEPENDENCY_FAILURE`, `POSSIBLE_DEPLOYMENT_REGRESSION`, and `INSUFFICIENT_EVIDENCE`. The support score is a documented heuristic from evidence factors, not a calibrated probability. Groq output must match the validated schema, cite a supported category, and use current source IDs. Unsupported citations are removed; malformed, unavailable, or contradictory output falls back explicitly.

## Security output

```js
{
  agentName: "Security",
  status: "COMPLETED" | "DEGRADED" | "ERROR",
  summary: "...",
  evidenceIds: ["LOG-1"],
  evidence: [],
  warnings: [],
  details: {
    threatDetected: false,
    riskLevel: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN",
    threatType: null,
    suspiciousEventCount: 0,
    findings: [{
      id: "SEC-FIND-001",
      category: "REPEATED_AUTHENTICATION_FAILURES",
      riskLevel: "HIGH",
      title: "...",
      explanation: "...",
      evidenceIds: ["LOG-1"],
      evidence: [],
      recommendations: []
    }],
    recommendations: [],
    coverage: { evidenceItemCount: 0, securityRelevantEvidenceCount: 0, complete: false }
  }
}
```

Detection rules identify possible anomalies, not confirmed attacks. Missing security-relevant evidence yields `DEGRADED` and `UNKNOWN`, never a green/secure assertion.

## Integration boundary

- **Monitoring/log processing:** provide parsed events and evidence identifiers; this module does not parse raw uploaded files or replace event correlation.
- **Knowledge/RAG:** provide retrieved results as the second argument to `runRcaAgent`; this module does not connect to MongoDB or implement vector search.
- **Remediation:** consume RCA `details.probableRootCause`, `details.explanation`, `evidenceIds`, `details.validationSteps`, and Security `details.findings`/`details.riskLevel`. These agents do not execute or approve remediation.
- **Orchestration/UI:** call both exports and pass results and the original incident into the React components as props. No HTTP endpoint or application navigation is defined here. A host route can compose the pages directly:

```jsx
import RCAAnalysis from "../pages/RCAAnalysis.jsx";
import SecurityFindings from "../pages/SecurityFindings.jsx";

export function IncidentInvestigation({ incident, rcaResult, securityResult, loading, error }) {
  return (
    <>
      <RCAAnalysis incident={incident} result={rcaResult} loading={loading} error={error} />
      <SecurityFindings result={securityResult} loading={loading} error={error} />
    </>
  );
}
```

`EvidenceViewer` is available from `../components/EvidenceViewer.jsx`; the page components already render it with their verified evidence IDs.