'use strict';

const path = require('node:path');

const EMBEDDING_IDENTITY = Object.freeze({
  provider: 'transformers-local', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384,
  revision: '751bff37182d3f1213fa05d7196b954e230abad9', dtype: 'q8', textVersion: 'incident-signals-v1',
});
const INDEX_NAME = 'knowledge_vector_index';
const MAX_TOKENS = 256;

function readRagConfig(env = process.env) {
  for (const [key, expected] of [
    ['KNOWLEDGE_EMBEDDING_PROVIDER', EMBEDDING_IDENTITY.provider],
    ['KNOWLEDGE_EMBEDDING_MODEL', EMBEDDING_IDENTITY.model],
    ['KNOWLEDGE_EMBEDDING_DIMENSIONS', String(EMBEDDING_IDENTITY.dimensions)],
  ]) {
    if (env[key] !== undefined && env[key] !== expected) throw new TypeError(`${key} does not match the approved embedding configuration`);
  }
  const backend = env.KNOWLEDGE_SEARCH_BACKEND ?? 'atlas';
  const fallback = env.KNOWLEDGE_SEARCH_FALLBACK ?? 'local-vector';
  if (!['atlas', 'local-vector', 'keyword'].includes(backend)) throw new TypeError('Invalid KNOWLEDGE_SEARCH_BACKEND');
  if (!['local-vector', 'keyword', 'none'].includes(fallback)) throw new TypeError('Invalid KNOWLEDGE_SEARCH_FALLBACK');
  const indexName = env.KNOWLEDGE_VECTOR_INDEX ?? INDEX_NAME;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(indexName)) throw new TypeError('Invalid KNOWLEDGE_VECTOR_INDEX');
  return Object.freeze({
    backend, fallback, indexName,
    cacheDir: path.resolve(env.KNOWLEDGE_EMBEDDING_CACHE_DIR ?? path.join(__dirname, '../../../.cache/aegisops-models')),
    maxLocalRecords: 500,
  });
}

module.exports = { EMBEDDING_IDENTITY, INDEX_NAME, MAX_TOKENS, readRagConfig };
