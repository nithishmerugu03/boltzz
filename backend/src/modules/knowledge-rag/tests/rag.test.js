'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmbeddingService, buildEmbeddingText, contentHash, currentEmbedding, RetrievalUnavailable } = require('../embedding.service');
const { readRagConfig, EMBEDDING_IDENTITY } = require('../rag.config');
const { prepareStoredEmbeddings } = require('../prepare-embeddings');
const { prepareSeedDocuments } = require('../seed-knowledge');
const { syntheticIncidents } = require('../data/synthetic-incidents');
const { createRagRetriever } = require('../rag-retrieval.service');
const { createVectorSearchService, indexMatches } = require('../vector-search.service');
const { cosineSimilarity } = require('../vector.math');
const { validateKnowledgeDocument } = require('../knowledge.model');
const indexDefinition = require('../atlas-index.json');
const now = new Date('2026-01-01T00:00:00Z');
const basis = (axis) => Array.from({ length: 384 }, (_, i) => i === axis ? 1 : 0);
const config = (backend = 'atlas', fallback = 'local-vector') => readRagConfig({ KNOWLEDGE_SEARCH_BACKEND: backend, KNOWLEDGE_SEARCH_FALLBACK: fallback });
const get = (document, field) => field.split('.').reduce((value, key) => value?.[key], document);

function matches(document, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$and') return condition.every((item) => matches(document, item));
    if (field === '$or') return condition.some((item) => matches(document, item));
    const value = get(document, field);
    if (condition?.$regex !== undefined) {
      return (Array.isArray(value) ? value : [value]).some((entry) => new RegExp(condition.$regex, condition.$options).test(entry ?? ''));
    }
    return JSON.stringify(value) === JSON.stringify(condition);
  });
}

function embeddedRecords(count = 3) {
  return prepareSeedDocuments(syntheticIncidents.slice(0, count), now).map((document, axis) => ({
    ...document, embedding: basis(axis), embeddingMetadata: { ...EMBEDDING_IDENTITY, contentHash: contentHash(document), embeddedAt: now },
  }));
}

// All MongoDB and Atlas interactions in this file are mocked. Basis vectors are test-only.
function fakeDb(records = embeddedRecords(), behaviour = {}) {
  const calls = { find: [], indexes: 0, pipelines: [], updates: [] };
  const collection = {
    find(filter) {
      if (behaviour.findError) throw behaviour.findError;
      calls.find.push(filter);
      let rows = structuredClone(records.filter((document) => matches(document, filter)));
      const cursor = {
        limit(count) { rows = rows.slice(0, count); return cursor; },
        skip(count) { rows = rows.slice(count); return cursor; },
        sort() { rows.sort((a, b) => a.incidentId.localeCompare(b.incidentId)); return cursor; },
        async toArray() { return rows; },
      };
      return cursor;
    },
    listSearchIndexes(name) {
      calls.indexes += 1;
      assert.equal(name, 'knowledge_vector_index');
      return { async toArray() {
        if (behaviour.indexError) throw behaviour.indexError;
        return behaviour.indexes ?? [{ type: 'vectorSearch', status: 'READY', queryable: true, latestDefinition: indexDefinition }];
      } };
    },
    aggregate(pipeline, options) {
      calls.pipelines.push(pipeline);
      assert.deepEqual(options, { maxTimeMS: 3000 });
      return { async toArray() {
        if (behaviour.atlasError) throw behaviour.atlasError;
        if (behaviour.atlasRows) return behaviour.atlasRows;
        const query = pipeline[0].$vectorSearch;
        return structuredClone(records.filter((document) => matches(document, query.filter))
          .sort((a, b) => cosineSimilarity(b.embedding, query.queryVector) - cosineSimilarity(a.embedding, query.queryVector))
          .slice(0, query.limit));
      } };
    },
    async updateOne(filter, update, options) {
      calls.updates.push({ filter, update, options });
      behaviour.beforeUpdate?.(records);
      const document = records.find((record) => matches(record, filter));
      if (!document) return { matchedCount: 0 };
      Object.assign(document, structuredClone(update.$set));
      return { matchedCount: 1 };
    },
  };
  return { records, calls, collection, db: { collection(name) { assert.equal(name, 'knowledge_documents'); return collection; } } };
}

function mockEmbeddings({ failure } = {}) {
  const calls = { queries: 0, documents: 0 };
  return { calls, identity: EMBEDDING_IDENTITY,
    async embedQuery() { calls.queries += 1; if (failure) throw failure; return { vector: basis(0), tokenCount: 10 }; },
    async embedDocument() { calls.documents += 1; if (failure) throw failure; return { vector: basis(0), tokenCount: 20 }; },
  };
}

test('configuration is pinned and rejects accidental model/dimension or backend mismatch', () => {
  assert.equal(config().maxLocalRecords, 500);
  assert.equal(EMBEDDING_IDENTITY.dimensions, 384);
  assert.match(EMBEDDING_IDENTITY.revision, /^[a-f0-9]{40}$/);
  for (const env of [
    { KNOWLEDGE_EMBEDDING_DIMENSIONS: '768' }, { KNOWLEDGE_EMBEDDING_MODEL: 'different' },
    { KNOWLEDGE_SEARCH_BACKEND: 'unknown' }, { KNOWLEDGE_SEARCH_FALLBACK: 'unknown' },
    { KNOWLEDGE_VECTOR_INDEX: '$bad' },
  ]) assert.throws(() => readRagConfig(env), TypeError);
});

test('text prioritises signals, excludes answers, and hash detects relevant edits', () => {
  const document = syntheticIncidents[0];
  const text = buildEmbeddingText(document);
  assert.ok(text.startsWith('Title:'));
  assert.ok(text.indexOf('Symptoms:') < text.indexOf('Service:'));
  assert.ok(text.includes(document.exampleLogPatterns[0]));
  assert.ok(!text.includes(document.rootCause));
  assert.equal(contentHash({ ...document, rootCause: 'Changed answer' }), contentHash(document));
  assert.notEqual(contentHash({ ...document, title: 'Changed title' }), contentHash(document));
  assert.throws(() => buildEmbeddingText({}), /Missing embedding input/);
});

test('adapter loads once, shares concurrent initialisation, and emits validated vectors', async () => {
  let loads = 0;
  let disposed = false;
  const pipe = async (text, options) => {
    assert.deepEqual(options, { pooling: 'mean', normalize: true });
    return { tolist: () => [basis(0)] };
  };
  pipe.tokenizer = async () => ({ input_ids: { size: 12 } });
  pipe.dispose = async () => { disposed = true; };
  const service = createEmbeddingService({ pipelineFactory: async () => { loads += 1; return pipe; } });
  const results = await Promise.all([service.embedQuery('pool timeout'), service.embedDocument(syntheticIncidents[0])]);
  assert.equal(loads, 1);
  assert.equal(results[0].vector.length, 384);
  assert.equal(results[1].tokenCount, 12);
  await service.dispose();
  assert.equal(disposed, true);
});

test('adapter retries failed loading, rejects overlong input, and rejects invalid model vectors', async () => {
  let loads = 0;
  const pipe = async () => ({ tolist: () => [[NaN]] });
  pipe.tokenizer = async () => ({ input_ids: { size: 300 } });
  const service = createEmbeddingService({ pipelineFactory: async () => { loads += 1; if (loads === 1) throw new Error('offline'); return pipe; } });
  await assert.rejects(service.embedQuery('pool'), (error) => error.code === 'EMBEDDING_UNAVAILABLE');
  await assert.rejects(service.embedQuery('pool'), (error) => error.code === 'EMBEDDING_TEXT_TOO_LONG');
  assert.equal(loads, 2);
  pipe.tokenizer = async () => ({ input_ids: { size: 10 } });
  await assert.rejects(service.embedQuery('pool'), (error) => error.code === 'EMBEDDING_UNAVAILABLE');
});

test('cosine computes genuine similarity, handles opposite/orthogonal vectors, and rejects invalid input', () => {
  assert.equal(cosineSimilarity(basis(0), basis(0)), 1);
  assert.equal(cosineSimilarity(basis(0), basis(1)), 0);
  assert.equal(cosineSimilarity(basis(0), basis(0).map((value) => -value)), -1);
  assert.throws(() => cosineSimilarity([1], basis(0)), TypeError);
  assert.throws(() => cosineSimilarity(new Array(384).fill(0), basis(0)), TypeError);
  const large = basis(0).map((value) => value * 1e150);
  assert.equal(cosineSimilarity(large, large), 1);
  assert.throws(() => cosineSimilarity(basis(0).map((value) => value * 1e308), basis(0)), TypeError);
});

test('preparation is guarded, dry-run-first, and does not load embeddings during preview', async () => {
  const fixture = fakeDb(prepareSeedDocuments(syntheticIncidents.slice(0, 2), now));
  const embeddings = mockEmbeddings();
  for (const environment of [undefined, 'production', 'staging']) {
    await assert.rejects(prepareStoredEmbeddings({ db: fixture.db, environment, embeddings }), /explicit development or test/);
  }
  assert.equal(fixture.calls.find.length, 0);
  const result = await prepareStoredEmbeddings({ db: fixture.db, environment: 'test', embeddings });
  assert.equal(result.pending, 2);
  assert.equal(result.dryRun, true);
  assert.equal(embeddings.calls.documents, 0);
  assert.equal(fixture.calls.updates.length, 0);
});

test('preparation writes embedding fields only, skips unchanged documents, and refreshes changed signals', async () => {
  const fixture = fakeDb(prepareSeedDocuments(syntheticIncidents.slice(0, 2), now));
  const embeddings = mockEmbeddings();
  const before = structuredClone(fixture.records);
  const run = () => prepareStoredEmbeddings({ db: fixture.db, environment: 'test', dryRun: false, embeddings, now });
  const first = await run();
  assert.equal(first.updated, 2);
  for (const { filter, update, options } of fixture.calls.updates) {
    assert.deepEqual(Object.keys(update.$set).sort(), ['embedding', 'embeddingMetadata']);
    assert.equal(options.upsert, false);
    assert.ok(filter.updatedAt instanceof Date);
  }
  for (const [i, document] of fixture.records.entries()) {
    assert.equal(validateKnowledgeDocument(document), document);
    const { embedding, embeddingMetadata, ...content } = document;
    assert.deepEqual(content, before[i]);
  }
  assert.equal((await run()).unchanged, 2);
  assert.equal(embeddings.calls.documents, 2);
  fixture.records[0].title = 'Edited connection symptom';
  assert.equal((await run()).updated, 1);
  assert.equal(embeddings.calls.documents, 3);
});

test('concurrent content changes prevent embedding overwrite without requiring a timestamp change', async () => {
  const fixture = fakeDb(prepareSeedDocuments(syntheticIncidents.slice(0, 1), now), {
    beforeUpdate(records) { records[0].title = 'Concurrent edit'; },
  });
  const result = await prepareStoredEmbeddings({ db: fixture.db, environment: 'test', dryRun: false, embeddings: mockEmbeddings(), now });
  assert.equal(result.conflicts, 1);
  assert.equal(fixture.records[0].embedding, undefined);
});

test('preparation validates the whole batch and corpus bound before updates', async () => {
  const bad = prepareSeedDocuments(syntheticIncidents.slice(0, 2), now);
  bad[1].title = '';
  const fixture = fakeDb(bad);
  await assert.rejects(prepareStoredEmbeddings({ db: fixture.db, environment: 'test', dryRun: false }), TypeError);
  assert.equal(fixture.calls.updates.length, 0);
  const large = fakeDb(Array.from({ length: 501 }, () => embeddedRecords(1)[0]));
  await assert.rejects(prepareStoredEmbeddings({ db: large.db, environment: 'test' }), /limited to 500/);
});

test('Atlas validates queryable index, dimensions and filter fields', async () => {
  const good = { type: 'vectorSearch', status: 'READY', queryable: true, latestDefinition: indexDefinition };
  assert.equal(indexMatches(good), true);
  assert.equal(indexMatches({ ...good, queryable: false }), false);
  assert.equal(indexMatches({ ...good, status: 'BUILDING' }), false);
  const wrong = structuredClone(good);
  wrong.latestDefinition.fields[0].numDimensions = 768;
  assert.equal(indexMatches(wrong), false);
  const missingFilter = structuredClone(good);
  missingFilter.latestDefinition.fields.pop();
  assert.equal(indexMatches(missingFilter), false);
});

test('Atlas uses exact vector search with identity/category/service prefilters and bounded pagination', async () => {
  const fixture = fakeDb();
  const retriever = createRagRetriever({ db: fixture.db, embeddings: mockEmbeddings(), config: config() });
  const result = await retriever.retrieveKnowledge('pool', { category: 'Database', affectedService: 'payment-api', limit: 1 });
  assert.equal(result.searchMode, 'atlas-vector');
  assert.equal(result.results[0].incidentId, 'HIST-001');
  assert.equal(result.results[0].embedding, undefined);
  assert.equal(result.results[0].embeddingMetadata, undefined);
  assert.equal(result.results[0].score, undefined);
  const stage = fixture.calls.pipelines[0][0].$vectorSearch;
  assert.equal(stage.exact, true);
  assert.equal(stage.path, 'embedding');
  assert.equal(stage.limit, 2);
  assert.equal(stage.filter.category, 'Database');
  assert.equal(stage.filter.affectedService, 'payment-api');
  assert.equal(stage.filter['embeddingMetadata.revision'], EMBEDDING_IDENTITY.revision);
  assert.equal(stage.numCandidates, undefined);
});

test('missing Atlas index falls back to local genuine vectors with one query embedding and explicit diagnostic', async () => {
  const fixture = fakeDb(undefined, { indexes: [] });
  const embeddings = mockEmbeddings();
  const events = [];
  const retriever = createRagRetriever({ db: fixture.db, embeddings, config: config(), onFallback: (event) => events.push(event) });
  const result = await retriever.retrieveKnowledge('pool', { limit: 1 });
  assert.equal(result.searchMode, 'local-vector');
  assert.equal(result.results[0].incidentId, 'HIST-001');
  assert.equal(result.pagination.hasMore, true);
  assert.equal(embeddings.calls.queries, 1);
  assert.deepEqual(events, [{ from: 'atlas', to: 'local-vector', reason: 'ATLAS_INDEX_NOT_READY_OR_MISMATCHED' }]);
});

test('unsupported Atlas search and search timeout can fall back; network and database auth failures cannot', async () => {
  for (const error of [Object.assign(new Error('unsupported'), { code: 59 }), Object.assign(new Error('timeout'), { code: 50 })]) {
    const fixture = fakeDb(undefined, { atlasError: error });
    const retriever = createRagRetriever({ db: fixture.db, embeddings: mockEmbeddings(), config: config(), onFallback() {} });
    assert.equal((await retriever.retrieveKnowledge('pool')).searchMode, 'local-vector');
  }
  for (const error of [new Error('network down'), Object.assign(new Error('database authentication failed'), { code: 18 })]) {
    const fixture = fakeDb(undefined, { indexError: error });
    const retriever = createRagRetriever({ db: fixture.db, embeddings: mockEmbeddings(), config: config(), onFallback() { assert.fail('Unexpected fallback'); } });
    await assert.rejects(retriever.retrieveKnowledge('pool'), (cause) => cause.code === 'KNOWLEDGE_UNAVAILABLE');
  }
});

test('embedding failure goes directly to keyword without retrying the encoder for local vectors', async () => {
  const fixture = fakeDb();
  const embeddings = mockEmbeddings({ failure: new RetrievalUnavailable('EMBEDDING_UNAVAILABLE') });
  const events = [];
  const retriever = createRagRetriever({ db: fixture.db, embeddings, config: config(), onFallback: (event) => events.push(event) });
  const result = await retriever.retrieveKnowledge('pool');
  assert.equal(result.searchMode, 'keyword');
  assert.equal(embeddings.calls.queries, 1);
  assert.equal(fixture.calls.indexes, 0);
  assert.equal(events[0].to, 'keyword');
});

test('no embeddings or partially stale embeddings fall back to keyword rather than claiming complete semantic results', async () => {
  for (const records of [prepareSeedDocuments(syntheticIncidents.slice(0, 2), now), embeddedRecords()]) {
    if (records[0].embedding) records[0].title = 'Updated title invalidates hash';
    const fixture = fakeDb(records);
    const retriever = createRagRetriever({ db: fixture.db, embeddings: mockEmbeddings(), config: config('local-vector'), onFallback() {} });
    const result = await retriever.retrieveKnowledge('Database');
    assert.equal(result.searchMode, 'keyword');
    assert.ok(result.results.length > 0);
  }
});

test('successful empty Atlas and local results do not trigger fallback', async () => {
  for (const backend of ['atlas', 'local-vector']) {
    const fixture = fakeDb([], { atlasRows: [] });
    const retriever = createRagRetriever({ db: fixture.db, embeddings: mockEmbeddings(), config: config(backend), onFallback() { assert.fail('Empty search must remain empty'); } });
    const result = await retriever.retrieveKnowledge('pool');
    assert.deepEqual(result.results, []);
    assert.equal(result.searchMode, backend === 'atlas' ? 'atlas-vector' : backend);
  }
});

test('local limits and stale Atlas rows are explicit fallback conditions', async () => {
  const many = Array.from({ length: 501 }, () => embeddedRecords(1)[0]);
  const local = createVectorSearchService({ db: fakeDb(many).db, config: config() });
  await assert.rejects(local.local(basis(0), { limit: 5, offset: 0 }), (error) => error.code === 'LOCAL_CORPUS_LIMIT_EXCEEDED');
  const stale = embeddedRecords();
  stale[0].title = 'Modified';
  const vectors = createVectorSearchService({ db: fakeDb(stale).db, config: config() });
  await assert.rejects(vectors.atlas(basis(0), { limit: 5, offset: 0 }), (error) => error.code === 'STALE_ATLAS_EMBEDDINGS');
});

test('keyword-only operation never invokes embeddings; fallback disabled returns a safe error', async () => {
  const fixture = fakeDb(undefined, { indexes: [] });
  const embeddings = mockEmbeddings();
  const keyword = createRagRetriever({ db: fixture.db, embeddings, config: config('keyword') });
  assert.equal((await keyword.retrieveKnowledge('pool')).searchMode, 'keyword');
  assert.equal(embeddings.calls.queries, 0);
  const strict = createRagRetriever({ db: fixture.db, embeddings, config: config('atlas', 'none') });
  await assert.rejects(strict.retrieveKnowledge('pool'), (error) => error.code === 'SEMANTIC_UNAVAILABLE' && error.status === 503);
});

test('invalid requests fail before embedding, and local storage errors never become keyword success', async () => {
  const fixture = fakeDb(undefined, { findError: new Error('database down') });
  const embeddings = mockEmbeddings();
  const retriever = createRagRetriever({ db: fixture.db, embeddings, config: config('local-vector'), onFallback() { assert.fail('Unexpected fallback'); } });
  await assert.rejects(retriever.retrieveKnowledge(''), (error) => error.code === 'INVALID_REQUEST');
  await assert.rejects(retriever.retrieveKnowledge('pool', { mode: 'semantic' }), (error) => error.code === 'INVALID_REQUEST');
  assert.equal(embeddings.calls.queries, 0);
  await assert.rejects(retriever.retrieveKnowledge('pool'), (error) => error.code === 'KNOWLEDGE_UNAVAILABLE');
});

test('current metadata validation rejects wrong revision, stale text, and malformed stored signals', () => {
  const [document] = embeddedRecords(1);
  assert.equal(currentEmbedding(document), true);
  assert.equal(currentEmbedding({ ...document, title: 'stale' }), false);
  assert.equal(currentEmbedding({ ...document, symptoms: null }), false);
  assert.equal(currentEmbedding({ ...document, embeddingMetadata: { ...document.embeddingMetadata, revision: 'other' } }), false);
  assert.throws(() => validateKnowledgeDocument({ ...document, embeddingMetadata: { ...document.embeddingMetadata, embeddedAt: 'bad' } }), TypeError);
  assert.throws(() => validateKnowledgeDocument({ ...document, embeddingMetadata: { ...document.embeddingMetadata, contentHash: 'bad' } }), TypeError);
});
