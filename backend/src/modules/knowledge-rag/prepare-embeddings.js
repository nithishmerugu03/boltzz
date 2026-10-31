'use strict';

const { COLLECTION_NAME, validateKnowledgeDocument } = require('./knowledge.model');
const { createEmbeddingService, currentEmbedding, contentHash } = require('./embedding.service');
const { EMBEDDING_IDENTITY } = require('./rag.config');

/** Explicit development/test task. The connection and its lifecycle belong to the shared app. */
async function prepareStoredEmbeddings({ db, environment, dryRun = true, embeddings = createEmbeddingService(), now = new Date() } = {}) {
  if (!['development', 'test'].includes(environment)) throw new Error('Embedding preparation requires an explicit development or test environment');
  if (typeof dryRun !== 'boolean') throw new TypeError('dryRun must be a boolean');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('now must be a valid Date');
  if (!db || typeof db.collection !== 'function') throw new TypeError('Supply the shared MongoDB Db connection');
  const collection = db.collection(COLLECTION_NAME);
  const documents = await collection.find({}, { maxTimeMS: 3000 }).limit(501).toArray();
  if (documents.length > 500) throw new Error('Preparation is limited to 500 records; review a larger-corpus strategy');
  // Validate the entire batch before generating anything or writing. Never alter incident content.
  for (const document of documents) {
    validateKnowledgeDocument(document);
    if (document._id === undefined) throw new TypeError('Stored document is missing _id');
  }
  const pending = documents.filter((document) => !currentEmbedding(document));
  const summary = { dryRun, total: documents.length, unchanged: documents.length - pending.length, pending: pending.length, updated: 0, conflicts: 0 };
  if (dryRun) return summary;
  for (const document of pending) {
    const { vector } = await embeddings.embedDocument(document);
    const metadata = { ...EMBEDDING_IDENTITY, contentHash: contentHash(document), embeddedAt: now };
    validateKnowledgeDocument({ ...document, embedding: vector, embeddingMetadata: metadata });
    // Content fields are optimistic-lock predicates, even if another writer forgets updatedAt.
    // No upsert: a concurrently deleted document must not be recreated.
    const result = await collection.updateOne({
      _id: document._id, updatedAt: document.updatedAt,
      title: document.title, symptoms: document.symptoms,
      affectedService: document.affectedService, exampleLogPatterns: document.exampleLogPatterns,
    }, { $set: { embedding: vector, embeddingMetadata: metadata } }, { upsert: false });
    if (result.matchedCount === 1) summary.updated += 1;
    else summary.conflicts += 1;
  }
  return summary;
}

// The CLI delegates to an explicit adapter supplied by the shared connection owner.
// Adapter contract: async withKnowledgeDb(callback), which supplies Db and closes its own resources.
if (require.main === module) {
  const path = require('node:path');
  const args = process.argv.slice(2);
  const adapterAt = args.indexOf('--db-adapter');
  if (adapterAt < 0 || !args[adapterAt + 1] || args.some((arg, index) => index !== adapterAt + 1 && !['--db-adapter', '--write'].includes(arg)) || args.filter((arg) => arg === '--db-adapter').length !== 1) {
    console.error('Usage: node prepare-embeddings.js --db-adapter <shared-connection-adapter.js> [--write]');
    process.exitCode = 1;
  } else {
    const embeddings = createEmbeddingService();
    (async () => {
      try {
        const { withKnowledgeDb } = require(path.resolve(args[adapterAt + 1]));
        if (typeof withKnowledgeDb !== 'function') throw new TypeError('Adapter must export withKnowledgeDb(callback)');
        const summary = await withKnowledgeDb((db) => prepareStoredEmbeddings({ db,
          environment: process.env.NODE_ENV, dryRun: !args.includes('--write'), embeddings }));
        console.log(JSON.stringify(summary));
      } finally { await embeddings.dispose(); }
    })().catch((error) => { console.error(error.code ?? error.name); process.exitCode = 1; });
  }
}

module.exports = { prepareStoredEmbeddings };
