'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { COLLECTION_NAME, CATEGORIES, createKnowledgeDocument, validateKnowledgeDocument, mongoJsonSchema } = require('../knowledge.model');
const { syntheticIncidents } = require('../data/synthetic-incidents');
const { seedKnowledge, prepareSeedDocuments } = require('../seed-knowledge');
const now = new Date('2026-01-01T00:00:00Z');

// In-memory driver-shaped test double: these are NOT live MongoDB integration tests.
function fakeDb(initial = []) {
  const records = structuredClone(initial);
  const calls = { writes: 0, collections: [] };
  return {
    records, calls,
    collection(name) {
      calls.collections.push(name);
      return {
        find(query) {
          const ids = query.$or[0].incidentId.$in;
          const mongoIds = query.$or[1]._id.$in;
          return { async toArray() { return records.filter((record) => ids.includes(record.incidentId) || mongoIds.includes(record._id)); } };
        },
        async bulkWrite(operations, options) {
          calls.writes += 1;
          assert.deepEqual(options, { ordered: true });
          let upsertedCount = 0;
          let matchedCount = 0;
          for (const { updateOne } of operations) {
            assert.equal(updateOne.upsert, true);
            assert.deepEqual(Object.keys(updateOne.update), ['$setOnInsert']);
            const match = records.find((record) => Object.entries(updateOne.filter).every(([key, value]) => record[key] === value));
            if (match) { matchedCount += 1; continue; }
            if (records.some((record) => record._id === updateOne.filter._id)) throw new Error('Duplicate _id');
            records.push(structuredClone(updateOne.update.$setOnInsert));
            upsertedCount += 1;
          }
          return { upsertedCount, matchedCount };
        },
      };
    },
  };
}

test('40 distinct synthetic scenarios cover all six categories and validate', () => {
  const prepared = prepareSeedDocuments(syntheticIncidents, now);
  assert.equal(prepared.length, 40);
  assert.equal(new Set(prepared.map((record) => record.incidentId)).size, 40);
  assert.equal(new Set(prepared.map((record) => record._id)).size, 40);
  assert.deepEqual([...new Set(prepared.map((record) => record.category))].sort(), [...CATEGORIES].sort());
  for (const record of prepared) {
    assert.equal(validateKnowledgeDocument(record), record);
    assert.equal(record.sourceType, 'synthetic');
    assert.ok(record.supportingEvidence.every((item) => item.startsWith('Synthetic evidence:')));
    assert.ok(record.createdAt instanceof Date);
    assert.equal(record.embedding, undefined);
  }
  assert.ok(mongoJsonSchema.required.includes('supportingEvidence'));
});

test('factory copies inputs so later mutation cannot change the document', () => {
  const input = structuredClone(syntheticIncidents[0]);
  const output = createKnowledgeDocument(input, { now });
  input.symptoms.push('mutated');
  assert.equal(output.symptoms.length, 2);
});

test('rejects missing, unknown, malformed and inconsistent fields', () => {
  for (const change of [
    { title: '' }, { category: 'unknown' }, { sourceType: 'real' }, { symptoms: [] },
    { supportingEvidence: [''] }, { tags: 'database' }, { extra: true },
    { createdAt: 'yesterday' }, { updatedAt: new Date('invalid') },
    { createdAt: new Date('2027-01-01'), updatedAt: now },
  ]) assert.throws(() => createKnowledgeDocument({ ...syntheticIncidents[0], ...change }, { now }), TypeError);
});

test('requires matching embedding metadata and rejects invalid vectors', () => {
  const metadata = { provider: 'test-only-provider', model: 'test-only-model', dimensions: 2 };
  const input = { ...syntheticIncidents[0], embedding: [0.2, 0.3], embeddingMetadata: metadata };
  assert.deepEqual(createKnowledgeDocument(input, { now }).embedding, [0.2, 0.3]);
  for (const change of [
    { embeddingMetadata: undefined }, { embedding: undefined }, { embedding: [1] },
    { embedding: [NaN, 1] }, { embedding: [Infinity, 1] }, { embedding: [0, 0] },
    { embeddingMetadata: { ...metadata, model: '' } },
    { embeddingMetadata: { ...metadata, unexpected: true } },
  ]) assert.throws(() => createKnowledgeDocument({ ...input, ...change }, { now }), TypeError);
});

test('seed refuses production, omitted environment, and missing connection', async () => {
  const db = fakeDb();
  for (const environment of [undefined, 'production', 'staging']) {
    await assert.rejects(seedKnowledge({ db, environment }), /explicit development or test/);
  }
  await assert.rejects(seedKnowledge({ environment: 'test' }), /shared MongoDB/);
  assert.equal(db.calls.writes, 0);
  assert.equal(db.calls.collections.length, 0);
});

test('dry-run is default and makes no writes', async () => {
  const db = fakeDb();
  const result = await seedKnowledge({ db, environment: 'development', now });
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldInsert, 40);
  assert.equal(db.calls.writes, 0);
  assert.deepEqual(db.calls.collections, [COLLECTION_NAME]);
});

test('seed is repeatable and preserves unrelated user records and edited seed content', async () => {
  const userRecord = { _id: 'user-1', incidentId: 'CUSTOM-1', sourceType: 'curated', title: 'User-owned record' };
  const db = fakeDb([userRecord]);
  const first = await seedKnowledge({ db, environment: 'test', dryRun: false, now });
  assert.equal(first.inserted, 40);
  db.records[1].title = 'Human-edited seed';
  const second = await seedKnowledge({ db, environment: 'test', dryRun: false, now: new Date('2026-02-01') });
  assert.equal(second.inserted, 0);
  assert.equal(second.existing, 40);
  assert.equal(db.records.length, 41);
  assert.deepEqual(db.records[0], userRecord);
  assert.equal(db.records[1].title, 'Human-edited seed');
  assert.equal(db.records[1].updatedAt.getTime(), now.getTime());
  const preview = await seedKnowledge({ db, environment: 'test', now });
  assert.equal(preview.wouldInsert, 0);
});

test('identity collisions fail before any writes', async () => {
  const prepared = prepareSeedDocuments(syntheticIncidents, now);
  for (const existing of [
    [{ _id: 'user-owned', incidentId: 'HIST-001', sourceType: 'curated' }],
    [{ _id: prepared[0]._id, incidentId: 'OTHER', sourceType: 'imported' }],
    [{ ...prepared[0], sourceType: 'curated' }],
    [prepared[0], { ...prepared[0], _id: 'duplicate' }],
  ]) {
    const db = fakeDb(existing);
    const before = structuredClone(db.records);
    await assert.rejects(seedKnowledge({ db, environment: 'test', dryRun: false, now }), /identity conflict/);
    assert.equal(db.calls.writes, 0);
    assert.deepEqual(db.records, before);
  }
});

test('bad datasets are rejected before database access', async () => {
  for (const documents of [[], [syntheticIncidents[0], syntheticIncidents[0]],
    [{ ...syntheticIncidents[0], sourceType: 'curated' }], [{ ...syntheticIncidents[0], title: '' }]]) {
    const db = fakeDb();
    await assert.rejects(seedKnowledge({ db, environment: 'test', dryRun: false, documents, now }));
    assert.equal(db.calls.collections.length, 0);
  }
});

test('database failures propagate without hiding partial-write risk', async () => {
  const readFailure = { collection() { return { find() { return { async toArray() { throw new Error('connection unavailable'); } }; } }; } };
  await assert.rejects(seedKnowledge({ db: readFailure, environment: 'test' }), /connection unavailable/);
  const writeFailure = { collection() { return {
    find() { return { async toArray() { return []; } }; },
    async bulkWrite() { throw new Error('write unavailable'); },
  }; } };
  await assert.rejects(seedKnowledge({ db: writeFailure, environment: 'test', dryRun: false }), /write unavailable/);
});
