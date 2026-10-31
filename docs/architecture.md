# RCA and Security module architecture

This module is a leaf capability for integration into the incident orchestrator. It does not own monitoring ingestion, event correlation, database retrieval, remediation, approval, application routing, or audit persistence.

```text
Incident + parsed evidence ──┬──> runRcaAgent(incident, similarIncidents)
                             │       ├─ evidence normalization and citation validation
                             │       ├─ deterministic signal classification
                             │       ├─ optional Groq analysis with schema validation
                             │       └─ structured probable cause and validation steps
                             └──> runSecurityAgent(incident)
                                     ├─ deterministic authentication/traffic rules
                                     └─ evidence-linked risk findings

Both structured results ──> orchestrator / review UI / remediation proposal input
```

## RCA processing

`backend/src/utils/incidentEvidence.js` normalizes supported evidence arrays, retains recognized source IDs, discards duplicate IDs after the first item, normalizes severity and timestamps, and reports unresolved or malformed inputs. It also provides the source-reference validator and display-safe evidence projection.

`backend/src/agents/rcaAgent.js` classifies direct database, memory, authentication, and dependency signals. A possible deployment regression requires evidence of a deployment, errors after it, and stable prior behavior; temporal order alone is not treated as causation. The agent computes its explainable evidence-support score in application logic.

When `GROQ_API_KEY` is configured, the RCA agent uses the official Groq SDK with a low temperature, JSON response mode, a configurable timeout, and a Zod response schema. Incident and retrieved text are explicitly treated as untrusted data. Groq output is used only when its category and citations are supported by deterministic checks. Missing credentials, malformed responses, unsupported citations, API failures, and contradictions yield an explicit degraded fallback.

## Security processing

`backend/src/agents/securityAgent.js` uses local deterministic rules: repeated authentication failures grouped by source and time window; aggregate 401/403 failures; request-volume metrics compared with a supplied baseline; unusually high authentication request counts by source; and authentication-service errors/timeouts. All findings carry only input evidence IDs. Event patterns are indicators for investigation, not proof of compromise.

Thresholds can be configured with `SECURITY_FAILED_LOGIN_THRESHOLD`, `SECURITY_AUTH_SPIKE_THRESHOLD`, and `SECURITY_EVENT_WINDOW_MS`. Defaults are five failed responses, twenty requests, and a five-minute event window.

## Frontend boundary

`RCAAnalysis`, `SecurityFindings`, and `EvidenceViewer` are prop-driven React components. They do not fetch data or define routes. The host app supplies the incident, agent result(s), loading state, and any error. This leaves navigation, API transport, SSE, and orchestration to the owning team members.