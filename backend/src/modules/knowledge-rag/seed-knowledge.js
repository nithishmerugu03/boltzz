'use strict';

const { COLLECTION_NAME, createKnowledgeDocument } = require('./knowledge.model');
const { SEED_DATASET, syntheticIncidents } = require('./data/synthetic-incidents');

function prepareSeedDocuments(documents, now) {
  if (!Array.isArray(documents) || documents.length === 0) throw new TypeError('Seed dataset must be non-empty');
  const ids = new Set();
  return documents.map((input) => {
    if (input.sourceType !== 'synthetic' || input.seedDataset !== SEED_DATASET) {
      throw new TypeError('Only this module synthetic dataset may be seeded');
    }
    if (ids.has(input.incidentId)) throw new TypeError(`Duplicate seed incidentId: ${input.incidentId}`);
    ids.add(input.incidentId);
    const document = createKnowledgeDocument({
      ...input, _id: `${SEED_DATASET}:${input.incidentId}`,
    }, { now });
    return document;
  });
}

/**
 * Use a MongoDB Db supplied by the shared application's connection owner.
 * No driver import, credentials, connection lifecycle, index creation, or startup hook here.
 * Dry-run is the default. Existing documents are NEVER updated or deleted.
 */
async function seedKnowledge({ db, environment, dryRun = true, documents = syntheticIncidents, now = new Date() } = {}) {
  if (!['development', 'test'].includes(environment)) {
    throw new Error('Seeding requires an explicit development or test environment');
  }
  if (typeof dryRun !== 'boolean') throw new TypeError('dryRun must be a boolean');
  const prepared = prepareSeedDocuments(documents, now);
  if (!db || typeof db.collection !== 'function') throw new TypeError('Supply the shared MongoDB Db connection');
  const collection = db.collection(COLLECTION_NAME);
  const existing = await collection.find({
    $or: [
      { incidentId: { $in: prepared.map((document) => document.incidentId) } },
      { _id: { $in: prepared.map((document) => document._id) } },
    ],
  }, { projection: { _id: 1, incidentId: 1, sourceType: 1, seedDataset: 1 } }).toArray();
  const byIncidentId = new Map(prepared.map((document) => [document.incidentId, document]));
  const seen = new Set();
  for (const record of existing) {
    const expected = byIncidentId.get(record.incidentId);
    if (!expected || record._id !== expected._id || record.sourceType !== 'synthetic' ||
        record.seedDataset !== SEED_DATASET || seen.has(record.incidentId)) {
      throw new Error('Seed identity conflict: existing knowledge records require manual review; no writes performed');
    }
    seen.add(record.incidentId);
  }
  if (dryRun) {
    return { dataset: SEED_DATASET, dryRun: true, total: prepared.length, wouldInsert: prepared.length - seen.size, existing: seen.size };
  }
  // Identity predicates plus MongoDB's unique _id protect concurrent runs of this seeder.
  // $setOnInsert preserves all existing content, including curated edits to seed records.
  const result = await collection.bulkWrite(prepared.map((document) => ({
    updateOne: {
      filter: { _id: document._id, incidentId: document.incidentId, sourceType: 'synthetic', seedDataset: SEED_DATASET },
      update: { $setOnInsert: document }, upsert: true,
    },
  })), { ordered: true });
  return { dataset: SEED_DATASET, dryRun: false, total: prepared.length, inserted: result.upsertedCount, existing: result.matchedCount };
}

module.exports = { seedKnowledge, prepareSeedDocuments };
