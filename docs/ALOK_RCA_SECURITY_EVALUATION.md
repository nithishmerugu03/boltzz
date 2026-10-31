# Alok — RCA and Security module

## Scope and implementation

This contribution contains the RCA agent, deterministic Security Agent, evidence normalization/citation checks, and prop-driven RCA/Security React panels with a reusable evidence viewer. It does not implement a server route, orchestrator, file parser, event-correlation service, MongoDB access, RAG/vector search, remediation, approval, authentication, or audit persistence.

## Public interfaces

```js
import { runRcaAgent } from "../agents/rcaAgent.js";
import { runSecurityAgent } from "../agents/securityAgent.js";

const rca = await runRcaAgent(incident, similarIncidents);
const security = await runSecurityAgent(incident);
```

See [api-contracts.md](./api-contracts.md) for accepted evidence arrays, output envelopes, detection categories, and team integration mapping. See [architecture.md](./architecture.md) for processing boundaries.

The frontend exports `RCAAnalysis`, `SecurityFindings`, and `EvidenceViewer`. They consume investigation props and do not call an API. The host application supplies `incident`, `rcaResult`, `securityResult`, `loading`, and `error` to `App`, or imports the page components directly into its own layout.

## Configuration

Backend variables are documented in [backend/.env.example](../backend/.env.example):

- `GROQ_API_KEY` — optional server-only credential; without it RCA returns a visible deterministic `DEGRADED` fallback.
- `GROQ_MODEL` — optional model override; default `llama-3.3-70b-versatile`.
- `GROQ_TIMEOUT_MS` — optional request timeout; default 15000 ms.
- `SECURITY_FAILED_LOGIN_THRESHOLD` — default 5.
- `SECURITY_AUTH_SPIKE_THRESHOLD` — default 20.
- `SECURITY_EVENT_WINDOW_MS` — default 300000 ms.

No live Groq request was made for this report. Never put the key in frontend code or commit a populated `.env`.

## Validation performed

Commands executed:

```powershell
Push-Location .\backend; npm test; Pop-Location
Push-Location .\backend; npm run evaluate:rca; Pop-Location
Push-Location .\frontend; npm run build; Pop-Location
Push-Location .\backend; npm audit --omit=dev; Pop-Location
Push-Location .\frontend; npm audit; Pop-Location
```

Actual results:

- Backend unit tests: **25 passed, 0 failed**.
- Deterministic local RCA fixtures: **5/5 classifications (100%)**, with **0 unsupported citations** and **0 agent errors**.
- Live Groq RCA accuracy: **not measured**; no API request was made.
- Frontend production build: **passed** with Vite.
- Dependency audits at install time: backend production dependencies and frontend dependencies reported **0 vulnerabilities**.

The 100% result is only the deterministic rules' performance on five hand-authored synthetic cases. It is not a measured LLM accuracy, production benchmark, or generalization claim.

## Limitations

- Rule-based RCA recognizes a finite set of text patterns and should be expanded with labeled data from the team's actual event contract.
- Model output is schema-validated and citations are checked against input IDs, but natural-language explanations are not a formal proof of semantic entailment.
- The evidence-support score is a transparent heuristic, not a calibrated confidence or probability.
- Authentication status codes and request spikes are anomaly indicators; they do not prove an attack.
- This module expects upstream parsing/correlation and historical search results. It has no endpoint or persistent store until integrated by the owning members.
- A runtime Node version supporting modern ECMAScript features and the installed packages is required; the workspace was validated with Node 24.
