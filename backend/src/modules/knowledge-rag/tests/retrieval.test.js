'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syntheticIncidents } = require('../data/synthetic-incidents');
const { prepareSeedDocuments } = require('../seed-knowledge');
const { createKnowledgeService } = require('../knowledge.service');
const { createKnowledgeController, knowledgeErrorHandler } = require('../knowledge.controller');
const { createKnowledgeRouter } = require('../knowledge.routes');
const { KnowledgeError, parseSearchInput, parseListInput } = require('../knowledge.validation');

// This fixture evaluates generated filters locally; it is not MongoDB or a live integration.
function matches(document, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matches(document, part));
    if (key === '$or') return condition.some((part) => matches(document, part));
    const values = Array.isArray(document[key]) ? document[key] : [document[key]];
    if (typeof condition === 'object' && condition !== null) {
      const regex = new RegExp(condition.$regex, condition.$options);
      return values.some((value) => typeof value === 'string' && regex.test(value));
    }
    return values.includes(condition);
  });
}

function fixture(records = prepareSeedDocuments(syntheticIncidents, new Date('2026-01-01'))) {
  const calls = [];
  const db = { collection(name) {
    assert.equal(name, 'knowledge_documents');
    return {
      find(filter, options) {
        calls.push({ filter, options });
        let rows = records.filter((record) => matches(record, filter));
        const cursor = {
          sort(sort) {
            assert.deepEqual(sort, { incidentId: 1, _id: 1 });
            rows = [...rows].sort((a, b) => a.incidentId.localeCompare(b.incidentId) || String(a._id).localeCompare(String(b._id)));
            return cursor;
          },
          skip(offset) { rows = rows.slice(offset); return cursor; },
          limit(limit) { rows = rows.slice(0, limit); return cursor; },
          async toArray() { return rows; },
        };
        return cursor;
      },
      async findOne(filter, options) {
        calls.push({ filter, options });
        return records.find((record) => matches(record, filter)) ?? null;
      },
    };
  } };
  return { service: createKnowledgeService({ db }), calls };
}

async function invoke(handler, req) {
  const response = { statusCode: undefined, body: undefined, error: undefined, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, response, (error) => { response.error = error; });
  if (response.error) knowledgeErrorHandler(response.error, req, response, () => {});
  return response;
}

test('listing has deterministic pages, bounded defaults and hasMore', async () => {
  const { service, calls } = fixture();
  const first = await service.listKnowledge();
  assert.equal(first.searchMode, 'list');
  assert.equal(first.results.length, 10);
  assert.equal(first.results[0].incidentId, 'HIST-001');
  assert.deepEqual(first.pagination, { limit: 10, offset: 0, hasMore: true });
  const last = await service.listKnowledge({ offset: 35 });
  assert.equal(last.results.length, 5);
  assert.equal(last.pagination.hasMore, false);
  assert.deepEqual((await service.listKnowledge({ offset: 100 })).results, []);
  assert.equal(calls[0].options.maxTimeMS, 3000);
  assert.equal(calls[0].options.projection._id, 0);
});

test('category and service filters combine and keyword terms can match different fields', async () => {
  const { service } = fixture();
  const database = await service.listKnowledge({ category: 'Database', limit: 50 });
  assert.equal(database.results.length, 7);
  assert.ok(database.results.every((record) => record.category === 'Database'));
  const found = await service.retrieveKnowledge('PAYMENT connection timeout', { category: 'Database', affectedService: 'payment-api' });
  assert.equal(found.searchMode, 'keyword');
  assert.deepEqual(found.results.map((record) => record.incidentId), ['HIST-001']);
  const noMatch = await service.retrieveKnowledge('payment', { category: 'Network' });
  assert.deepEqual(noMatch.results, []);
  assert.equal(noMatch.pagination.hasMore, false);
});

test('title, category, symptoms, incident IDs and tags are searchable', async () => {
  const { service } = fixture();
  for (const query of ['pool exhaustion', 'Infrastructure', 'HTTP 413', 'HIST-001', 'synthetic']) {
    assert.ok((await service.retrieveKnowledge(query)).results.length > 0, query);
  }
  assert.equal((await service.listKnowledge({ q: 'pool exhaustion' })).searchMode, 'keyword');
});

test('regex metacharacters are literal, never wildcards or operators', async () => {
  const records = prepareSeedDocuments(syntheticIncidents.slice(0, 1), new Date());
  records[0].title = 'Literal [pool] a+b .* (a+)+$';
  const { service } = fixture(records);
  for (const query of ['[pool]', 'a+b', '.*', '(a+)+$']) {
    assert.equal((await service.retrieveKnowledge(query)).results.length, 1);
  }
  assert.deepEqual((await service.retrieveKnowledge('^anything$')).results, []);
});

test('retrieved details preserve evidence and resolution fields but omit vectors and private storage fields', async () => {
  const records = prepareSeedDocuments(syntheticIncidents.slice(0, 1), new Date());
  Object.assign(records[0], { embedding: [0.1, 0.2], embeddingMetadata: { model: 'test' }, internalSecret: 'never-return' });
  const { service } = fixture(records);
  const detail = await service.getKnowledge('HIST-001');
  const result = (await service.retrieveKnowledge('pool')).results[0];
  for (const document of [detail, result]) {
    assert.equal(document.incidentId, 'HIST-001');
    assert.deepEqual(document.supportingEvidence, records[0].supportingEvidence);
    assert.deepEqual(document.troubleshootingSteps, records[0].troubleshootingSteps);
    assert.deepEqual(document.recommendedResolution, records[0].recommendedResolution);
    assert.deepEqual(document.verificationChecks, records[0].verificationChecks);
    assert.deepEqual(document.preventiveActions, records[0].preventiveActions);
    for (const field of ['_id', 'embedding', 'embeddingMetadata', 'seedDataset', 'internalSecret', 'score']) {
      assert.equal(Object.hasOwn(document, field), false, field);
    }
  }
});

test('invalid input is rejected before MongoDB reads', async () => {
  const { service, calls } = fixture();
  for (const input of [
    { query: '' }, { query: { $ne: null } }, { query: ['pool'] }, { query: 'x'.repeat(301) },
    { query: 'a '.repeat(13).trim() }, { query: 'pool\nerror' },
    { query: 'pool', limit: 0 }, { query: 'pool', limit: 51 }, { query: 'pool', limit: '5' },
    { query: 'pool', limit: 1.5 }, { query: 'pool', offset: -1 }, { query: 'pool', offset: 10001 },
    { query: 'pool', category: 'Unknown' }, { query: 'pool', category: { $ne: '' } },
    { query: 'pool', affectedService: '' }, { query: 'pool', mode: 'semantic' },
  ]) {
    const { query, ...filters } = input;
    await assert.rejects(service.retrieveKnowledge(query, filters), (error) => error.status === 400);
  }
  await assert.rejects(service.retrieveKnowledge('pool', { query: 'override' }), /without a query/);
  await assert.rejects(service.retrieveKnowledge('pool', null), /filters/);
  await assert.rejects(service.getKnowledge({ $ne: null }), /identifier/);
  await assert.rejects(service.getKnowledge('../secret'), /identifier/);
  await assert.rejects(service.listKnowledge({ offset: true }), /integer/);
  assert.equal(calls.length, 0);
});

test('HTTP list accepts numeric query strings but POST requires JSON numeric values', () => {
  const parsed = parseListInput({ limit: '5', offset: '10' }, { allowQueryStrings: true });
  assert.equal(parsed.limit, 5);
  assert.equal(parsed.offset, 10);
  for (const limit of ['1e1', '-1', '', '01', '1.5', ['5']]) {
    assert.throws(() => parseListInput({ limit }, { allowQueryStrings: true }), KnowledgeError);
  }
  for (const input of [undefined, null, [], 'pool', { query: 'pool', limit: '5' }]) {
    assert.throws(() => parseSearchInput(input), KnowledgeError);
  }
});

test('missing incidents return 404 and empty keyword results remain a successful page', async () => {
  const { service } = fixture([]);
  await assert.rejects(service.getKnowledge('HIST-999'), (error) => error.status === 404 && error.code === 'KNOWLEDGE_NOT_FOUND');
  assert.deepEqual((await service.retrieveKnowledge('no-match')).results, []);
});

test('database failures become safe 503 errors with internal cause retained', async () => {
  const cause = new Error('mongodb://sensitive-connection-details');
  const service = createKnowledgeService({ db: { collection() {
    return { find() { throw cause; }, async findOne() { throw cause; } };
  } } });
  for (const operation of [() => service.listKnowledge(), () => service.getKnowledge('HIST-001'), () => service.retrieveKnowledge('pool')]) {
    await assert.rejects(operation(), (error) => error.status === 503 && error.code === 'KNOWLEDGE_UNAVAILABLE' && error.cause === cause);
  }
  const controller = createKnowledgeController({ service });
  const response = await invoke(controller.list, { query: {} });
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.stringify(response.body).includes('sensitive'), false);
});

test('controllers implement documented list, details, search and invalid-request responses', async () => {
  const { service } = fixture();
  const controller = createKnowledgeController({ service });
  const list = await invoke(controller.list, { query: { category: 'Database', limit: '2' } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.data.retrieved_incidents.length, 2);
  assert.equal(list.body.component, 'knowledge');
  const detail = await invoke(controller.details, { params: { id: 'HIST-001' } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.data.retrieved_incidents[0].incident_id, 'HIST-001');
  const search = await invoke(controller.search, { body: { incident_id: 'INC-001', query: 'payment connection timeout', limit: 5 } });
  assert.equal(search.statusCode, 200);
  assert.equal(search.body.data.retrieved_incidents[0].incident_id, 'HIST-001');
  assert.equal(search.body.incident_id, 'INC-001');
  const invalid = await invoke(controller.search, { body: { incident_id: 'INC-001', query: '' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error.code, 'INVALID_REQUEST');
  const missing = await invoke(controller.details, { params: { id: 'HIST-999' } });
  assert.equal(missing.statusCode, 404);
});

test('router registers only module endpoints and its local error handler', () => {
  const calls = [];
  const router = {
    get(path, handler) { calls.push(['GET', path, handler]); },
    post(path, handler) { calls.push(['POST', path, handler]); },
    use(handler) { calls.push(['ERROR', handler]); },
  };
  const { service } = fixture();
  assert.equal(createKnowledgeRouter({ Router: () => router, service }), router);
  assert.deepEqual(calls.slice(0, 3).map(([method, path]) => [method, path]), [['GET', '/'], ['POST', '/search'], ['GET', '/:id']]);
  assert.equal(calls[3][1], knowledgeErrorHandler);
  assert.equal(knowledgeErrorHandler.length, 4);
  assert.throws(() => createKnowledgeRouter(), /Router/);
  assert.throws(() => createKnowledgeRouter({ Router: () => router, service: {} }), /listKnowledge/);
  assert.throws(() => createKnowledgeService(), /shared MongoDB/);
});

test('unexpected errors are sanitised and sent-header errors delegate', async () => {
  const controller = createKnowledgeController({ service: {
    async listKnowledge() { throw new Error('internal secret'); }, async retrieveKnowledge() { return { results: [] }; },
  } });
  const response = await invoke(controller.list, { query: {} });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
  let delegated;
  const error = new Error('connection closed');
  knowledgeErrorHandler(error, {}, { headersSent: true }, (value) => { delegated = value; });
  assert.equal(delegated, error);
});
