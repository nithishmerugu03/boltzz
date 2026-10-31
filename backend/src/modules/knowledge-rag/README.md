# Knowledge Base & RAG module — Stages 2–4

Owner: Nithish. JavaScript only. No changes to shared MongoDB/Express setup, existing environment files, entry points, or other agents.

Stage 4 exception authorised by the user: `@huggingface/transformers` was added to `backend/package.json` and installed, generating `backend/package-lock.json`. No existing dependency or configuration was removed. The pre-existing root README edit remains untouched.

## Implemented

- `knowledge.model.js`: document factory, runtime validation, category/source enums, and an optional MongoDB JSON schema for the shared database owner's review.
- `data/synthetic-incidents.js`: 40 fictional incidents, stable `HIST-001` through `HIST-040` identifiers, across six categories. These are synthetic scenarios, not actual incident histories. Security examples are isolated test scenarios and do not establish compromise of any real system.
- `seed-knowledge.js`: development/test-only, dry-run-first seeder accepting the team's existing MongoDB `Db` object. It does not create a second connection or install/import a database driver.
- `tests/knowledge.test.js`: dependency-free validation and seed safety tests using a driver-shaped in-memory test double.
- `knowledge.validation.js`: input validation and typed-by-code module errors, using plain JavaScript.
- `knowledge.service.js`: listing, filtering, incident detail retrieval, and literal keyword search using an injected MongoDB database.
- `knowledge.controller.js` and `knowledge.routes.js`: Express-compatible controllers and an injected router factory. These endpoints are not mounted in the shared application yet.
- `tests/retrieval.test.js`: service, controller, route registration, error, and retrieval-contract tests with test doubles.
- `API.md`: exact current module contracts and integration snippets for the shared application and other agents.
- `embedding.service.js`, `rag.config.js`: pinned local MiniLM model, 384-dimensional embeddings, signal text construction, and compatibility checks.
- `prepare-embeddings.js`: explicit development/test-only embedding preparation with dry runs, freshness checks, and optimistic concurrency protection.
- `vector.math.js`, `vector-search.service.js`, `rag-retrieval.service.js`: genuine local cosine ranking, checked Atlas vector search, and observable keyword fallback through an internal factory.
- `knowledge.contract.js`, `knowledge.workflow.js`, `knowledge-output.schema.json`: the agreed common output envelope, a LangGraph-compatible async knowledge node, and machine-readable output schema. HTTP controllers also follow this envelope, replacing the earlier proposed raw page responses. Component: `knowledge`.
- `atlas-index.json`, module-owned `.env.example`, `RAG.md`: proposed Atlas index and module configuration, preparation commands, and teammate integration instructions.
- `evaluate-retrieval.js`, `evaluation/`, `tests/rag.test.js`: real local model relevance evaluation and mocked integration/failure tests.

Documents include title, category, affected service, symptoms, example log patterns, root cause, supporting evidence, troubleshooting steps, recommended resolution, verification checks, preventive actions, source type, tags, timestamps, and optional embedding metadata/vector. `runbookReferences` is empty until real runbooks are supplied. No embeddings or similarity scores are fabricated.

## Integration with the shared database

The shared app owner supplies an already-connected MongoDB `Db` object. This CommonJS module matches the current packages, which do not declare `type: module`. An ESM application can default-import the CommonJS exports if needed. No shared setup changes are made here.

Example for a **development-only script owned by the connection maintainer**, not application startup:

```js
const { seedKnowledge } = require('./src/modules/knowledge-rag/seed-knowledge');

// db comes from your team's existing connection setup.
// Resolve NODE_ENV from the shared configuration; do not force development for a real deployment.
const preview = await seedKnowledge({ db, environment: process.env.NODE_ENV });
console.log(preview);

// Only after confirming the target is the intended development database:
const result = await seedKnowledge({ db, environment: process.env.NODE_ENV, dryRun: false });
console.log(result);
```

The snippet belongs inside the caller's existing async function, with errors handled by that script. Connection opening/closing stays with the owner. This module intentionally has no standalone database connection or automatic startup hook. No seed has been run against a real database.

## Seed safety

- Only explicit `development` or `test` is accepted. This is an execution guard, not proof of database identity: the caller must verify the selected database is non-production.
- Defaults to preview mode and validates the entire dataset before database access.
- Uses `knowledge_documents`, deterministic MongoDB `_id` values, and `incidentId` references. Synthetic records carry `sourceType: synthetic` and `seedDataset: aegisops-synthetic-v1`.
- Existing conflicting IDs abort before writes. Inserts use only `$setOnInsert`; existing content and timestamps are preserved, even if a person has edited a seed record.
- No deletes, updates of existing content, collection drops, index creation, or validator changes. Seed revisions do not overwrite prior records; migrations require a separately reviewed process.
- Repeated seed runs do not duplicate the seed records because `_id` is unique. A shared unique `incidentId` index should be reviewed by the database owner to enforce identity across all application writers, after checking existing duplicates. The preflight alone cannot prevent a different writer concurrently inserting the same incident ID under another `_id`.
- Bulk writes are not a transaction: a database error can leave some new seed records inserted. Errors propagate; rerun after resolving the fault to insert the remainder. Existing records are not rolled back or deleted.
- The optional exported MongoDB JSON schema is not installed automatically. Runtime validation additionally checks date ordering, finite nonzero vectors, matching vector dimensions, and paired embedding metadata; MongoDB schema alone does not enforce these cross-field rules.

## Tests

From the backend directory:

```sh
node --test src/modules/knowledge-rag/tests/knowledge.test.js src/modules/knowledge-rag/tests/retrieval.test.js src/modules/knowledge-rag/tests/rag.test.js src/modules/knowledge-rag/tests/contract.test.js
node src/modules/knowledge-rag/evaluate-retrieval.js
```

The unit suite uses test doubles and does not verify live MongoDB connectivity, a real Express HTTP server, or Atlas Vector Search. The separate evaluation executes the real model locally: 18/18 expected top-1 matches across 40 synthetic incidents, with no chunk averaging. See [RAG.md](RAG.md) and the saved evaluation report for scope and limitations.

## Pending stages and configuration

Backend API factories, keyword retrieval, embedding preparation, local semantic retrieval, an Atlas adapter, and documented internal retrieval interfaces are implemented. Shared application mounting, frontend JSX, and live database/Atlas integration tests remain pending. No route, authentication middleware, JSON parser, shared database connection, or application entry point has been changed.

The shared connection and database name must come from the MongoDB owner. The embedding model is now selected, installed, pinned, and locally evaluated. The Atlas index definition is supplied but not created on a live cluster. No secrets should be supplied in chat; use the team's approved environment configuration. The application owner must supply the actual MongoDB driver and Express Router for live integration. See [RAG.md](RAG.md) for Stage 4 instructions.
