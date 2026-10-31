'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { COMMON_FIELDS, knowledgeSuccess, knowledgeFailure } = require('../knowledge.contract');
const { createKnowledgeWorkflowNode } = require('../knowledge.workflow');
const { createKnowledgeController, knowledgeErrorHandler } = require('../knowledge.controller');
const { KnowledgeError } = require('../knowledge.validation');
const { syntheticIncidents } = require('../data/synthetic-incidents');
const { createRagRetriever } = require('../rag-retrieval.service');
const { readRagConfig, EMBEDDING_IDENTITY } = require('../rag.config');
const { contentHash } = require('../embedding.service');
const outputSchema = require('../knowledge-output.schema.json');
const atlasIndex = require('../atlas-index.json');
const fixedNow = () => new Date('2026-10-31T10:30:00Z');
const record = syntheticIncidents[0];

function assertContract(output) {
  assert.deepEqual(COMMON_FIELDS, outputSchema.required);
  assert.deepEqual(Object.keys(output), COMMON_FIELDS);
  assert.equal(output.component, 'knowledge');
  assert.ok(['completed', 'in_progress', 'failed'].includes(output.status));
  assert.equal(new Date(output.timestamp).toISOString(), output.timestamp);
  assert.ok(output.incident_id === null || typeof output.incident_id === 'string');
  assert.equal(typeof output.summary, 'string');
  for (const field of ['findings', 'evidence', 'recommendations']) assert.ok(Array.isArray(output[field]));
  assert.deepEqual(Object.keys(output.data), ['query', 'retrieved_incidents', 'retrieval_count']);
  assert.ok(output.data.query === null || typeof output.data.query === 'string');
  assert.equal(output.data.retrieval_count, output.data.retrieved_incidents.length);
  for (const document of output.data.retrieved_incidents) {
    assert.deepEqual(Object.keys(document), ['incident_id', 'title', 'description', 'similarity_score', 'resolution']);
    for (const field of ['title', 'description', 'resolution']) assert.ok(document[field] === null || typeof document[field] === 'string');
    assert.ok(document.similarity_score === null || (Number.isFinite(document.similarity_score) && document.similarity_score >= 0 && document.similarity_score <= 1));
  }
  for (const evidence of output.evidence) {
    assert.deepEqual(Object.keys(evidence), ['source', 'reference', 'content', 'relevance']);
    for (const value of Object.values(evidence)) assert.equal(typeof value, 'string');
  }
  if (output.status === 'failed') {
    assert.deepEqual(Object.keys(output.error), ['code', 'message', 'details']);
    assert.equal(output.error.details, null);
  } else assert.equal(output.error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
}

test('workflow success uses exact common and module fields, preserves ID, and cites synthetic sources honestly', async () => {
  const calls = [];
  const node = createKnowledgeWorkflowNode({ now: fixedNow, retriever: {
    async retrieveKnowledge(query, filters) { calls.push({ query, filters }); return { results: [record] }; },
  } });
  const output = await node({ incident_id: 'INC-Team:Case-007', query: 'pool exhaustion', limit: 5 });
  assertContract(output);
  assert.equal(output.incident_id, 'INC-Team:Case-007');
  assert.equal(output.status, 'completed');
  assert.equal(output.timestamp, '2026-10-31T10:30:00.000Z');
  assert.equal(output.data.retrieved_incidents[0].incident_id, 'HIST-001');
  assert.equal(output.data.retrieved_incidents[0].description, record.rootCause);
  assert.equal(output.data.retrieved_incidents[0].resolution, record.recommendedResolution.join('\n'));
  assert.equal(output.data.retrieved_incidents[0].similarity_score, null);
  assert.ok(output.evidence[0].content.includes('"sourceType":"synthetic"'));
  assert.equal(output.evidence[1].content, record.supportingEvidence[0]);
  assert.equal(output.evidence[1].reference, 'HIST-001#supportingEvidence[0]');
  assert.deepEqual(output.findings, []);
  assert.deepEqual(output.recommendations, []);
  assert.equal(calls[0].filters.limit, 5);
});

test('workflow uses genuine supplied similarity scores and never manufactures keyword confidence', async () => {
  const node = createKnowledgeWorkflowNode({ now: fixedNow, retriever: {
    async retrieveKnowledge() { assert.fail('Scored retriever should be selected'); },
    async retrieveKnowledgeWithScores() { return { results: [record], similarityScores: { 'HIST-001': 0.8123 } }; },
  } });
  const output = await node({ incident_id: 'INC-002', query: 'database' });
  assertContract(output);
  assert.equal(output.data.retrieved_incidents[0].similarity_score, 0.8123);
});

test('invalid or unavailable scores become null instead of fabricated values', () => {
  for (const score of [undefined, NaN, Infinity, -0.1, 1.1, '0.9']) {
    const output = knowledgeSuccess({ documents: [record], similarityScores: { 'HIST-001': score }, now: fixedNow() });
    assertContract(output);
    assert.equal(output.data.retrieved_incidents[0].similarity_score, null);
  }
});

test('empty retrieval is completed with empty arrays and a zero count', async () => {
  const node = createKnowledgeWorkflowNode({ now: fixedNow, retriever: { async retrieveKnowledge() { return { results: [] }; } } });
  const output = await node({ incident_id: 'INC-003', query: 'nothing matches' });
  assertContract(output);
  assert.equal(output.status, 'completed');
  assert.equal(output.data.retrieval_count, 0);
  assert.deepEqual(output.evidence, []);
});

test('missing/malformed input fails in the same envelope without calling retrieval or inventing an incident ID', async () => {
  const node = createKnowledgeWorkflowNode({ now: fixedNow, retriever: { async retrieveKnowledge() { assert.fail('Invalid input reached storage'); } } });
  for (const input of [undefined, null, [], {}, { query: 'pool' }, { incident_id: 'INC-004' },
    { incident_id: 'INC-004', query: { $ne: null } }, { incident_id: 'INC-004', query: 'pool', unexpected: true }]) {
    const output = await node(input);
    assertContract(output);
    assert.equal(output.status, 'failed');
    assert.equal(output.error.code, 'INVALID_REQUEST');
    assert.equal(output.incident_id, input?.incident_id ?? null);
  }
});

test('known and unexpected failures retain context and never expose causes, connection strings, or stacks', async () => {
  for (const error of [
    new KnowledgeError('Knowledge storage is unavailable', { code: 'KNOWLEDGE_UNAVAILABLE', status: 503, cause: new Error('mongodb://private-secret') }),
    new Error('private-secret in provider stack'),
  ]) {
    const node = createKnowledgeWorkflowNode({ now: fixedNow, retriever: { async retrieveKnowledge() { throw error; } } });
    const output = await node({ incident_id: 'INC-005', query: 'pool' });
    assertContract(output);
    assert.equal(output.incident_id, 'INC-005');
    assert.equal(output.data.query, 'pool');
    assert.equal(output.status, 'failed');
    assert.equal(JSON.stringify(output).includes('private-secret'), false);
  }
});

test('missing source IDs fail rather than inventing evidence references', async () => {
  const node = createKnowledgeWorkflowNode({ now: fixedNow, retriever: { async retrieveKnowledge() { return { results: [{ title: 'uncitable' }] }; } } });
  const output = await node({ incident_id: 'INC-006', query: 'pool' });
  assertContract(output);
  assert.equal(output.status, 'failed');
  assert.equal(output.error.code, 'INTERNAL_ERROR');
});

async function invoke(handler, req) {
  const res = { headersSent: false, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res, (error) => knowledgeErrorHandler(error, req, res, () => {}));
  return res;
}

test('every HTTP success and failure uses the team envelope; current ID remains distinct from historical ID', async () => {
  const service = {
    async listKnowledge() { return { results: [record], pagination: { limit: 10 }, searchMode: 'list' }; },
    async getKnowledge(id) { assert.equal(id, 'HIST-001'); return record; },
    async retrieveKnowledge() { return { results: [record] }; },
  };
  const controller = createKnowledgeController({ service, now: fixedNow });
  for (const [handler, req] of [
    [controller.list, { query: { incident_id: 'INC-007' } }],
    [controller.details, { query: { incident_id: 'INC-007' }, params: { id: 'HIST-001' } }],
    [controller.search, { body: { incident_id: 'INC-007', query: 'pool' } }],
  ]) {
    const response = await invoke(handler, req);
    assertContract(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.incident_id, 'INC-007');
    assert.equal(response.body.data.retrieved_incidents[0].incident_id, 'HIST-001');
    assert.equal(response.body.results, undefined);
    assert.equal(response.body.pagination, undefined);
  }
  const missingId = await invoke(controller.search, { body: { query: 'pool' } });
  assertContract(missingId.body);
  assert.equal(missingId.statusCode, 400);
  assert.equal(missingId.body.incident_id, null);
  const browsing = await invoke(controller.list, { query: {} });
  assertContract(browsing.body);
  assert.equal(browsing.body.incident_id, null);
});

test('HTTP middleware preserves incident/query context on database failure', async () => {
  const controller = createKnowledgeController({ now: fixedNow, service: {
    async retrieveKnowledge() { return { results: [] }; },
    async listKnowledge() { throw new KnowledgeError('Knowledge storage is unavailable', { code: 'KNOWLEDGE_UNAVAILABLE', status: 503 }); },
  } });
  const response = await invoke(controller.list, { query: { incident_id: 'INC-008', q: 'pool' } });
  assertContract(response.body);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.incident_id, 'INC-008');
  assert.equal(response.body.data.query, 'pool');
});

test('local cosine scores reach workflow output; legacy retrieval shape remains unchanged internally', async () => {
  const vector = Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);
  const stored = { ...record, embedding: vector, embeddingMetadata: { ...EMBEDDING_IDENTITY, contentHash: contentHash(record) } };
  const db = { collection() { return { find() { return { limit() { return this; }, async toArray() { return [stored]; } }; } }; } };
  const retriever = createRagRetriever({ db, config: readRagConfig({ KNOWLEDGE_SEARCH_BACKEND: 'local-vector' }),
    embeddings: { async embedQuery() { return { vector }; } } });
  const node = createKnowledgeWorkflowNode({ retriever, now: fixedNow });
  const output = await node({ incident_id: 'INC-009', query: 'pool' });
  assertContract(output);
  assert.equal(output.data.retrieved_incidents[0].similarity_score, 1);
  const legacy = await retriever.retrieveKnowledge('pool');
  assert.deepEqual(Object.keys(legacy), ['results', 'pagination', 'searchMode']);
});

test('failure formatter always includes unavailable values as null', () => {
  const output = knowledgeFailure({ error: new Error('secret'), now: fixedNow() });
  assertContract(output);
  assert.equal(output.incident_id, null);
  assert.equal(output.data.query, null);
});

test('Atlas score metadata maps to the agreed similarity field without adding output fields', async () => {
  const vector = Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);
  const row = { ...record, embedding: vector, embeddingMetadata: { ...EMBEDDING_IDENTITY, contentHash: contentHash(record) }, _knowledgeSimilarity: 0.91 };
  const db = { collection() { return {
    listSearchIndexes() { return { async toArray() { return [{ type: 'vectorSearch', status: 'READY', queryable: true, latestDefinition: atlasIndex }]; } }; },
    aggregate(pipeline) {
      assert.deepEqual(pipeline[1], { $set: { _knowledgeSimilarity: { $meta: 'vectorSearchScore' } } });
      return { async toArray() { return [row]; } };
    },
  }; } };
  const retriever = createRagRetriever({ db, embeddings: { async embedQuery() { return { vector }; } } });
  const output = await createKnowledgeWorkflowNode({ retriever, now: fixedNow })({ incident_id: 'INC-010', query: 'pool' });
  assertContract(output);
  assert.equal(output.data.retrieved_incidents[0].similarity_score, 0.91);
  assert.equal(JSON.stringify(output).includes('_knowledgeSimilarity'), false);
});

test('parser errors use the common failure envelope without exposing invalid bodies', () => {
  for (const [type, status] of [['entity.parse.failed', 400], ['entity.too.large', 413]]) {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    knowledgeErrorHandler(Object.assign(new Error('sensitive invalid body'), { type }), {}, res, () => {});
    assertContract(res.body);
    assert.equal(res.statusCode, status);
    assert.equal(JSON.stringify(res.body).includes('sensitive'), false);
  }
});
