# Embedding preparation and semantic retrieval

Implemented in JavaScript on `feature/knowledge-rag`. The internal retriever remains opt-in. Workflow and HTTP response boundaries now follow the team's agreed common envelope, as documented in [API.md](API.md). No teammate agents, shared database connections, routing, authentication, or existing environment files were changed. The only shared dependency changes are the authorised `backend/package.json` and generated `backend/package-lock.json`.

## Runtime and model

- Direct dependency: `@huggingface/transformers` **4.3.2**, installed and locked. There were no pre-existing dependencies in this checkout.
- Model: `Xenova/all-MiniLM-L6-v2`, revision `751bff37182d3f1213fa05d7196b954e230abad9`.
- Server-side CPU inference, ONNX `q8` weights, mean pooling, normalised vectors, **384 dimensions**.
- The encoder is loaded lazily once per embedding-service instance, with a shared in-flight initialisation promise. No startup embedding generation or model download occurs merely by importing the module.
- Default cache: `backend/.cache/aegisops-models`, already excluded by the repository's existing ignore rules. Public weights download on first use. Once all four required files are cached, the adapter loads the pinned directory directly with `local_files_only`, avoiding the runtime's remote model-discovery probe. Cached inference was verified with network requests disabled. The model and runtime consume backend CPU/RAM and require a deployment smoke test; no hosted embedding API or embedding API key is used.
- Groq reasoning remains owned by other modules. This feature does not call Groq or generate diagnoses.

The [model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2) documents pooling and normalisation; the [base model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) documents the 384-dimensional representation and input-length limit. [Transformers.js](https://huggingface.co/docs/transformers.js/en/tutorials/node) supports server-side JavaScript. The installed runtime version is established by this checkout's package files and real evaluation, rather than assumed from the documentation's default version.

## Embedding text and freshness

`buildEmbeddingText` creates a labelled string from **title, symptoms, affected service, and example error logs**, in that order. It deliberately excludes the answer fields (root cause and remediation) from this initial signal-oriented embedding. Retrieval still returns all evidence and recovery fields from the matched incident.

The tokenizer counts the actual input before encoding. More than 256 tokens produces `EMBEDDING_TEXT_TOO_LONG`; the implementation does not silently truncate, split, or average chunks. A too-long query may explicitly fall back to keyword search. Too-long historical documents fail preparation and need a reviewed concise signal summary or a later chunking strategy.

Metadata records provider, model, dimensions, pinned revision, dtype, text version, signal content hash, and embedding timestamp. A different model revision/dtype/text version or changed signal text invalidates an embedding. Changes to answer fields alone do not require re-embedding because they are not encoder inputs. Existing legacy metadata with only provider/model/dimensions still validates structurally, but is not eligible for semantic retrieval until preparation refreshes it.

The exported MongoDB JSON schema has optional fields for this metadata; applying or updating an actual collection validator remains a decision for the shared database owner. No `collMod`, index creation, or database migration has been executed.

## Configuration

The module-owned [.env.example](.env.example) documents the proposed names. It is a template, not a loaded environment file. The existing `backend/.env.example` is untouched. The shared app supplies environment loading and MongoDB configuration.

`readRagConfig()` reads:

| Variable | Default / accepted values |
| --- | --- |
| `KNOWLEDGE_EMBEDDING_PROVIDER` | `transformers-local`; other providers rejected |
| `KNOWLEDGE_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2`; other models rejected |
| `KNOWLEDGE_EMBEDDING_DIMENSIONS` | `384`; other dimensions rejected |
| `KNOWLEDGE_EMBEDDING_CACHE_DIR` | Absolute module-derived `backend/.cache/aegisops-models`; explicit relative paths resolve from the process working directory |
| `KNOWLEDGE_VECTOR_INDEX` | `knowledge_vector_index` |
| `KNOWLEDGE_SEARCH_BACKEND` | `atlas` (default), `local-vector`, `keyword` |
| `KNOWLEDGE_SEARCH_FALLBACK` | `local-vector` (default), `keyword`, `none` |

`NODE_ENV` is passed explicitly to preparation from the shared configuration. Only `development` or `test` is accepted. This guard does not establish the identity of a remote database; the connection owner must verify that the selected database really is non-production. No MongoDB URI or credentials are defined by this module.

## Explicit preparation task

First use the existing module seeder against the intended development database, after reviewing its dry run. The seed function preserves all existing records. Preparation is a separate operation:

```js
const { createEmbeddingService } = require('./modules/knowledge-rag/embedding.service');
const { prepareStoredEmbeddings } = require('./modules/knowledge-rag/prepare-embeddings');

// In an existing async development script, with db supplied by the connection owner:
const embeddings = createEmbeddingService();
try {
  const preview = await prepareStoredEmbeddings({ db, environment: process.env.NODE_ENV, embeddings });
  console.log(preview); // No model inference or writes during a preview.
  // After checking the development target and preview:
  const result = await prepareStoredEmbeddings({ db, environment: process.env.NODE_ENV, embeddings, dryRun: false });
  console.log(result);
} finally {
  await embeddings.dispose();
}
```

Paths above assume the caller is in `backend/src/`. Do not put this on the normal startup path.

For an executable CLI, the shared connection owner may supply an adapter exporting `async withKnowledgeDb(callback)`. It calls `callback(db)`, returns its result, and owns cleanup, using the team's existing connection implementation. This is an explicit adapter interface, not an assumption about the teammate's current exports. No adapter has been created because that connection is not available in this checkout.

From `backend/`, with the actual adapter path substituted:

```sh
node src/modules/knowledge-rag/prepare-embeddings.js --db-adapter ./path/to/team-adapter.js
node src/modules/knowledge-rag/prepare-embeddings.js --db-adapter ./path/to/team-adapter.js --write
```

Preparation validates at most 500 stored records, skips current embeddings, and updates **only** `embedding` and `embeddingMetadata`. It preserves content and content timestamps. Writes use `_id`, content timestamp, and the exact signal fields as optimistic-lock predicates, with **no upsert**, to avoid overwriting a concurrent edit or resurrecting a deleted document. The summary reports conflicts for a later retry. Database/model errors propagate. A failed batch can leave some embeddings updated; rerunning safely skips those current records. It never deletes records or performs production writes.

## Atlas index

Ask the shared database owner to create an index on their database's `knowledge_documents` collection:

- Name: **`knowledge_vector_index`**
- Type: **`vectorSearch`**
- JSON definition: [atlas-index.json](atlas-index.json)
- Vector field: `embedding`; dimensions: `384`; similarity: `cosine`.

The definition retains category, affected service, source type, model and provider filters, and adds revision/dtype/text-version filters to prevent mixing incompatible embeddings. No automatic quantisation is configured in Atlas; `q8` describes the local model weights, not the stored vector representation. The vector remains an array of 384 finite numbers.

The adapter checks `listSearchIndexes` for a matching definition, `status: READY`, and `queryable: true`. It runs `$vectorSearch` first in the aggregation pipeline with `exact: true`, query embedding, compatible metadata filters, optional category/service filters, and a bounded page limit. The search is exact over the indexed compatible corpus; Atlas index propagation is asynchronous and can lag recent writes. Returned stale signal hashes trigger fallback rather than being reported as a complete page. No live Atlas availability or index status has been verified here.

See MongoDB's [index reference](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/) and [query reference](https://www.mongodb.com/docs/vector-search/query/aggregation-stages/vector-search-stage/).

## Internal teammate retrieval

```js
const { readRagConfig } = require('./modules/knowledge-rag/rag.config');
const { createEmbeddingService } = require('./modules/knowledge-rag/embedding.service');
const { createRagRetriever } = require('./modules/knowledge-rag/rag-retrieval.service');

const config = readRagConfig();
const embeddings = createEmbeddingService({ config });
const knowledge = createRagRetriever({ db, config, embeddings,
  onFallback: ({ from, to, reason }) => safeLogger.warn({ from, to, reason }),
});
const page = await knowledge.retrieveKnowledge('payment connection timeout', {
  category: 'Database', limit: 5,
});
// page = { results, pagination: { limit, offset, hasMore }, searchMode }
// On shared application shutdown, the owner of this embedding instance calls embeddings.dispose().
```

`safeLogger` stands for the team's existing safe logger. Without a callback, fallback codes are logged through `console.warn`. Diagnostics contain backend names and reason codes only, not raw exceptions, queries, or incident bodies. Callback errors propagate, so callbacks must be reliable. No custom callback or logger has been installed in the shared app.

This **internal factory** returns actual `searchMode` values `atlas-vector`, `local-vector`, or `keyword`. Its original `retrieveKnowledge` method retains the same public document allowlist and internal page shape, without scores or private metadata. A separate `retrieveKnowledgeWithScores` helper provides genuine score metadata to the workflow adapter: normalised cosine `(1 + cosine) / 2` locally, Atlas `$meta: vectorSearchScore`, or no score for keyword matches. Similarity is never a calibrated root-cause probability.

For central workflow output, pass the retriever to `createKnowledgeWorkflowNode` in `knowledge.workflow.js`. The adapter requires `incident_id` and `query`, preserves the current ID, and returns the exact common envelope with component `knowledge`. HTTP controllers use the same formatter for success and failure; they no longer expose the earlier proposed raw page format. The root `data` object contains only `query`, `retrieved_incidents`, and `retrieval_count`. See [API.md](API.md) for mapping, evidence references and the shared wiring snippet. No shared app file or other agent was edited.

## Fallback behaviour

1. `atlas` backend tries a verified Atlas index and a real query.
2. Missing/building/mismatched indexes, unsupported search operations, or search timeouts can fall back to local cosine search when configured.
3. Local search reads the category/service-filtered corpus from MongoDB and ranks genuine compatible vectors. It is bounded to 500 records. Missing, stale, or partially prepared embeddings produce an explicit fallback reason, rather than silently ranking an incomplete local corpus.
4. Missing model weights, encoding failure, or unavailable local vectors can fall back to the existing keyword service. Encoder failure skips the other vector backend because it would require the same unavailable encoder.
5. A successful empty semantic result stays empty. Database/network/authentication errors remain safe `KNOWLEDGE_UNAVAILABLE` errors, not empty results or a fabricated success. A fallback-disabled capability failure is `SEMANTIC_UNAVAILABLE` (503).

Atlas permission errors specifically identifying search operations may fall back if normal collection reads are still permitted. Unknown driver errors do not silently trigger fallback. `fallback=keyword` skips local vectors; `fallback=none` disables fallback. Explicit `backend=local-vector` needs no Atlas index; explicit `backend=keyword` needs neither the index nor the model.

## Verification and limitations

From `backend/`:

```sh
node --test src/modules/knowledge-rag/tests/knowledge.test.js src/modules/knowledge-rag/tests/retrieval.test.js src/modules/knowledge-rag/tests/rag.test.js src/modules/knowledge-rag/tests/contract.test.js
node src/modules/knowledge-rag/evaluate-retrieval.js
# After the initial model download, verify cached inference without network access:
node src/modules/knowledge-rag/evaluate-retrieval.js --offline
```

All 55 unit tests passed. The unit suite uses mocked MongoDB, Atlas, and model outputs for deterministic failure/safety cases. These test vectors are never used in application fallback logic. It covers dry runs, idempotence, concurrent edits, model/dimension compatibility, stale vectors, invalid queries, public projections, cosine arithmetic, pagination, index readiness, fallback paths, storage failures, unchanged internal keyword retrieval, and the exact team envelope on HTTP/workflow boundaries.

The evaluation script separately executes the **real pinned model locally** across 40 synthetic records and 18 hand-written relevance queries. The recorded [evaluation report](evaluation/local-model-results.json) achieved **18/18 top-1 and top-3 matches**, with a maximum document length of **54 tokens**. This supports using one signal-oriented vector per incident without chunk averaging for the initial dataset. It is a small synthetic smoke test, not an independent or production retrieval benchmark. It does not establish real-world accuracy, incident diagnosis correctness, latency, or recovery-time improvement. Returned evaluation similarities are real cosine values, not calibrated probabilities.

Still awaiting the team: shared MongoDB connection/database selection, actual seeding and embedding persistence checks, Atlas index creation/readiness, a live Atlas query, shared route/agent integration approval, deployment resource checks, and broader relevance evaluation. The JSX frontend is a later stage and is not claimed as implemented here. Atlas availability does not block local-vector implementation or its tests.
