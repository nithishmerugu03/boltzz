'use strict';

const { COLLECTION_NAME } = require('./knowledge.model');
const { EMBEDDING_IDENTITY, readRagConfig } = require('./rag.config');
const { currentEmbedding, validVector, RetrievalUnavailable } = require('./embedding.service');
const { cosineSimilarity } = require('./vector.math');
const { KnowledgeError } = require('./knowledge.validation');
const expectedIndex = require('./atlas-index.json');

function storageError(cause) {
  return new KnowledgeError('Knowledge storage is unavailable', { code: 'KNOWLEDGE_UNAVAILABLE', status: 503, cause });
}

function vectorFilter({ category, affectedService }) {
  const filter = Object.fromEntries(Object.entries(EMBEDDING_IDENTITY)
    .filter(([field]) => field !== 'dimensions').map(([field, value]) => [`embeddingMetadata.${field}`, value]));
  if (category !== undefined) filter.category = category;
  if (affectedService !== undefined) filter.affectedService = affectedService;
  return filter;
}

function indexMatches(index) {
  const fields = index.latestDefinition?.fields;
  return index.type === 'vectorSearch' && index.status === 'READY' && index.queryable === true && Array.isArray(fields) &&
    expectedIndex.fields.every((expected) => fields.some((actual) =>
      Object.entries(expected).every(([key, value]) => actual[key] === value)));
}

// Only known search capability errors trigger fallback. Network/auth-to-database errors remain errors.
function atlasCapabilityError(error) {
  if ([27, 59, 115, 40324, 50].includes(error.code)) return true;
  if (error.code === 9 && /unknown|unrecognized|unsupported/i.test(error.message ?? '')) return true;
  return error.code === 13 && /listSearchIndexes|\$vectorSearch|search index/i.test(error.message ?? '');
}

function createVectorSearchService({ db, config = readRagConfig() } = {}) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('Supply the shared MongoDB Db connection');
  const collection = db.collection(COLLECTION_NAME);

  async function local(vector, options) {
    if (!validVector(vector)) throw new TypeError('Invalid query vector');
    let documents;
    try {
      const filter = {};
      if (options.category !== undefined) filter.category = options.category;
      if (options.affectedService !== undefined) filter.affectedService = options.affectedService;
      documents = await collection.find(filter, { maxTimeMS: 3000 })
        .limit(config.maxLocalRecords + 1).toArray();
    } catch (cause) { throw storageError(cause); }
    if (documents.length > config.maxLocalRecords) throw new RetrievalUnavailable('LOCAL_CORPUS_LIMIT_EXCEEDED');
    if (!documents.length) return page([], options);
    const compatible = documents.filter(currentEmbedding);
    if (!compatible.length) throw new RetrievalUnavailable('NO_CURRENT_EMBEDDINGS');
    if (compatible.length !== documents.length) throw new RetrievalUnavailable('INCOMPLETE_EMBEDDINGS');
    const ranked = compatible.map((document) => ({ document, similarity: cosineSimilarity(vector, document.embedding) }))
      .sort((a, b) => b.similarity - a.similarity || a.document.incidentId.localeCompare(b.document.incidentId));
    return page(ranked.map((entry) => entry.document), options,
      Object.fromEntries(ranked.map((entry) => [entry.document.incidentId, (1 + entry.similarity) / 2])));
  }

  async function atlas(vector, options) {
    if (!validVector(vector)) throw new TypeError('Invalid query vector');
    if (typeof collection.listSearchIndexes !== 'function') throw new RetrievalUnavailable('ATLAS_DRIVER_UNSUPPORTED');
    let indexes;
    try { indexes = await collection.listSearchIndexes(config.indexName, { maxTimeMS: 3000 }).toArray(); }
    catch (cause) {
      if (atlasCapabilityError(cause)) throw new RetrievalUnavailable('ATLAS_UNAVAILABLE', { cause });
      throw storageError(cause);
    }
    if (!indexes.some(indexMatches)) throw new RetrievalUnavailable('ATLAS_INDEX_NOT_READY_OR_MISMATCHED');
    let documents;
    try {
      // Exact nearest neighbours are sufficient for this small corpus. No ANN tuning or quantisation.
      documents = await collection.aggregate([
        { $vectorSearch: { index: config.indexName, path: 'embedding', queryVector: vector,
          exact: true, limit: options.offset + options.limit + 1, filter: vectorFilter(options) } },
        { $set: { _knowledgeSimilarity: { $meta: 'vectorSearchScore' } } },
      ], { maxTimeMS: 3000 }).toArray();
    } catch (cause) {
      if (atlasCapabilityError(cause)) throw new RetrievalUnavailable('ATLAS_UNAVAILABLE', { cause });
      throw storageError(cause);
    }
    if (!documents.length) return page([], options);
    // Reject stale content. Do not silently discard rows and claim a complete ranked page.
    if (documents.some((document) => !currentEmbedding(document))) throw new RetrievalUnavailable('STALE_ATLAS_EMBEDDINGS');
    return page(documents, options, Object.fromEntries(documents
      .filter((document) => typeof document._knowledgeSimilarity === 'number' && Number.isFinite(document._knowledgeSimilarity) && document._knowledgeSimilarity >= 0 && document._knowledgeSimilarity <= 1)
      .map((document) => [document.incidentId, document._knowledgeSimilarity])));
  }

  return { local, atlas };
}

function page(documents, { limit, offset }, scores = {}) {
  const selected = documents.slice(offset, offset + limit);
  return { documents: selected, similarityScores: Object.fromEntries(selected
    .filter((document) => Object.hasOwn(scores, document.incidentId))
    .map((document) => [document.incidentId, scores[document.incidentId]])),
    pagination: { limit, offset, hasMore: documents.length > offset + limit } };
}

module.exports = { createVectorSearchService, indexMatches };
