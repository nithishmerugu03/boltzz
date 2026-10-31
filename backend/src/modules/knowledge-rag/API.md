# Knowledge module: agreed workflow and HTTP output contract

All external knowledge responses now use the team's common envelope. This replaces the earlier proposed HTTP `{ results, pagination, searchMode }` format. The change is authorised by the request to correct code against the teammates' agreed schema. Storage and retrieval helpers retain their internal return types; they are not workflow responses.

## Component identifier

The component is **`knowledge`**, matching the explicit assignment. The supplied specification also labels its module-specific example `knowledge_retrieval`; that label is not used as a second component ID. There are no extra top-level fields.

The machine-readable contract is [knowledge-output.schema.json](knowledge-output.schema.json). Unavailable values are null, collection fields are arrays, `data` is always an object, timestamps are UTC ISO 8601, and both failures and successes include every common field.

## LangGraph integration

The shared orchestrator can call this async node without adding a LangGraph dependency to the knowledge module:

```js
const { createRagRetriever } = require('./modules/knowledge-rag/rag-retrieval.service');
const { createKnowledgeWorkflowNode } = require('./modules/knowledge-rag/knowledge.workflow');

const retriever = createRagRetriever({ db }); // Shared MongoDB Db; Atlas/local/keyword fallbacks.
const knowledgeNode = createKnowledgeWorkflowNode({ retriever });

// Project only this module's input from your actual workflow state.
const output = await knowledgeNode({
  incident_id: currentIncidentId,
  query: incidentSearchQuery,
  limit: 5,
});
```

The node returns the envelope directly, not an invented graph-state wrapper. The orchestrator owns graph registration, reducers and state merging. No shared graph or teammate module has been modified. An existing keyword-only service can also be injected as `retriever`.

Required workflow input: `incident_id` and `query`. Optional flat filter fields: `category`, `affectedService`, `limit`, `offset`. Unknown module-input fields are rejected; the orchestrator should project the knowledge inputs from its full state rather than pass other agents' outputs. The exact supplied incident ID is preserved, with no trimming, replacement, or generated ID. Missing IDs fail with `incident_id: null`.

## Envelope and data fields

Common fields, always present:

```text
incident_id, component, status, timestamp, summary,
findings, evidence, recommendations, data, error
```

`data` contains exactly:

```text
query: string or null
retrieved_incidents: array
retrieval_count: integer, equal to this returned array's length
```

Each retrieved item contains exactly:

| Field | Mapping |
| --- | --- |
| `incident_id` | Stable historical `incidentId`, e.g. `HIST-001` |
| `title` | Retrieved source title, or null |
| `description` | Retrieved historical root cause, or null; not a diagnosis of the current incident |
| `similarity_score` | Genuine vector ranking score in 0–1, or null when unavailable |
| `resolution` | Retrieved `recommendedResolution` steps joined into a string, or null |

The top-level current `incident_id` remains distinct from each historical incident ID.

Local vector scores are explicitly transformed from cosine similarity using `(1 + cosine) / 2`. Atlas scores come from `$meta: vectorSearchScore`. Keyword, list and detail responses use null scores; no values are invented. Neither ranking scores nor historical root causes establish a calibrated probability about the current incident.

`findings` and `recommendations` remain empty: retrieval does not invent current-incident findings or generate another agent's remediation decisions. `evidence` cites the actual retrieved document and its supporting evidence by collection/incident ID and field reference. The first item's `content` is a JSON string containing the allowlisted retrieved source, including source type, troubleshooting, verification, and preventive steps. This preserves source procedures for teammates without adding unapproved fields to `data`. Synthetic sources remain labelled synthetic. Embeddings, private storage metadata and MongoDB `_id` are excluded.

A successful empty result is `completed`, with empty arrays, `retrieval_count: 0`, and `error: null`. Failure is `failed` with `{ code, message, details: null }` and all other common fields intact. Raw database causes, credentials, stacks, and invalid request bodies are excluded.

## HTTP module endpoints after shared mounting

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/api/knowledge` | List/filter sources, mapped to the common envelope |
| GET | `/api/knowledge/:id` | Return one historical source in `data.retrieved_incidents` |
| POST | `/api/knowledge/search` | Require current `incident_id` and query; return the common envelope |

GET listing accepts optional `incident_id`, `q`, `category`, `affectedService`, `limit`, `offset`. The detail endpoint accepts optional `incident_id` as context; `:id` is the historical ID. For browsing without an active incident, GET responses use top-level `incident_id: null` rather than inventing a current incident. Workflow search requires a current incident ID.

POST example request (contract illustration, not a live invocation):

```json
{
  "incident_id": "INC-001",
  "query": "payment connection timeout",
  "category": "Database",
  "limit": 5
}
```

The query is non-empty, at most 300 characters/12 terms, without control characters. Categories are `Database`, `Backend/API`, `Deployment`, `Infrastructure`, `Network`, `Security`. Service filters are exact, non-empty strings of at most 100 characters. Limit is 1–50 (default 10), offset is 0–10000 (default 0). GET accepts decimal numeric strings; POST requires JSON numbers. Incident IDs are 1–128 characters, starting with an ASCII letter/digit and followed by letters/digits or `._:-`.

Pagination controls remain inputs; the strict output schema has no pagination or total-count field. `retrieval_count` counts only the returned page. To obtain another page, send the next offset; do not interpret the count as a global corpus total.

HTTP statuses: success 200; invalid input/JSON 400; missing detail source 404; oversized body 413; database/semantic unavailability 503; unexpected internal failure 500. The body always uses the common envelope when handled by this module. Shared authentication or errors outside the module still belong to the shared app owner.

## Shared Express wiring (snippet only)

The shared owner provides Express, a connected MongoDB Db, identity/access middleware, JSON parsing, and error-handler placement. From a caller in `backend/src/`:

```js
const { createKnowledgeService } = require('./modules/knowledge-rag/knowledge.service');
const { createRagRetriever } = require('./modules/knowledge-rag/rag-retrieval.service');
const { createKnowledgeRouter } = require('./modules/knowledge-rag/knowledge.routes');
const { knowledgeErrorHandler } = require('./modules/knowledge-rag/knowledge.controller');

const records = createKnowledgeService({ db });
const rag = createRagRetriever({ db });
const service = { ...records, ...rag };
app.use('/api/knowledge', authenticate, authoriseKnowledgeRead,
  express.json({ limit: '16kb' }),
  createKnowledgeRouter({ Router: express.Router, service }),
  knowledgeErrorHandler); // Also catches parser errors before the router.
```

Do not duplicate an existing bounded JSON parser. The extra error-handler placement illustrates how to envelope parser errors; it is not installed automatically. The module continues to rely on shared authentication, role enforcement, CORS, and rate limits. It treats knowledge as a shared corpus, not private tenant-specific records; tenant isolation would need a separately agreed model/query policy.

No app entry point, agent, shared `docs/api-contracts.md`, database configuration, or LangGraph workflow was edited. Existing internal `retrieveKnowledge(query, filters)` remains available for local code, but central workflow consumers must call `knowledgeNode` to receive the agreed envelope. The scored internal helper exists only to supply genuine similarity values to this adapter.

## Verification

Contract tests check exact top-level/data/item keys, JSON serialisation, UTC timestamps, current versus historical IDs, empty success, missing/invalid inputs, traceable synthetic source citations, score/null handling, common HTTP failures and secret redaction. MongoDB, Atlas, and HTTP request/response objects are test doubles; no live teammate workflow or Atlas integration is claimed.
