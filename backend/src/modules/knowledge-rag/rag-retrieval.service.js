'use strict';

const { createEmbeddingService, RetrievalUnavailable } = require('./embedding.service');
const { createVectorSearchService } = require('./vector-search.service');
const { createKnowledgeService } = require('./knowledge.service');
const { parseSearchInput, KnowledgeError } = require('./knowledge.validation');
const { readRagConfig } = require('./rag.config');
const { publicDocument } = require('./knowledge.public');

/** Opt-in internal retriever. Existing HTTP routes and keyword service remain unchanged. */
function createRagRetriever({ db, config = readRagConfig(), embeddings = createEmbeddingService({ config }),
  onFallback = (event) => console.warn('Knowledge retrieval fallback:', event) } = {}) {
  if (typeof onFallback !== 'function') throw new TypeError('onFallback must be a function');
  const vectors = createVectorSearchService({ db, config });
  const keyword = createKnowledgeService({ db });

  async function notify(from, to, reason) {
    // Diagnostics contain codes only, never queries, credentials, document bodies or raw exceptions.
    await onFallback({ from, to, reason });
  }

  async function retrieve(query, filters = {}, includeScores = false) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.hasOwn(filters, 'query')) {
      throw new KnowledgeError('filters must be an object without a query field');
    }
    const options = parseSearchInput({ ...filters, query });
    const keywordResult = async () => {
      const result = await keyword.retrieveKnowledge(query, filters);
      return includeScores ? { ...result, similarityScores: {} } : result;
    };
    if (config.backend === 'keyword') return keywordResult();
    const backends = config.backend === 'atlas' ? ['atlas', ...(config.fallback === 'local-vector' ? ['local-vector', 'keyword'] : config.fallback === 'keyword' ? ['keyword'] : [])]
      : ['local-vector', ...(config.fallback === 'none' ? [] : ['keyword'])];
    let vector;
    for (let index = 0; index < backends.length; index += 1) {
      const backend = backends[index];
      if (backend === 'keyword') return keywordResult();
      try {
        if (!vector) vector = (await embeddings.embedQuery(query)).vector;
        const result = await (backend === 'atlas' ? vectors.atlas(vector, options) : vectors.local(vector, options));
        return { results: result.documents.map(publicDocument), pagination: result.pagination,
          searchMode: backend === 'atlas' ? 'atlas-vector' : 'local-vector',
          ...(includeScores ? { similarityScores: result.similarityScores } : {}) };
      } catch (error) {
        if (!(error instanceof RetrievalUnavailable)) throw error;
        // Loading/encoding failure cannot be repaired by changing the vector search backend.
        const embeddingFailed = error.code.startsWith('EMBEDDING_');
        const next = embeddingFailed && config.fallback !== 'none' ? backends.indexOf('keyword') : index + 1;
        if (next <= index || next >= backends.length) {
          throw new KnowledgeError('Semantic retrieval is unavailable', { code: 'SEMANTIC_UNAVAILABLE', status: 503, cause: error });
        }
        await notify(backend, backends[next], error.code);
        index = next - 1;
      }
    }
    throw new KnowledgeError('Semantic retrieval is unavailable', { code: 'SEMANTIC_UNAVAILABLE', status: 503 });
  }

  return { retrieveKnowledge: (query, filters) => retrieve(query, filters),
    retrieveKnowledgeWithScores: (query, filters) => retrieve(query, filters, true) };
}

module.exports = { createRagRetriever };
