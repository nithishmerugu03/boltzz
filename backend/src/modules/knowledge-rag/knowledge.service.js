'use strict';

const { COLLECTION_NAME } = require('./knowledge.model');
const { KnowledgeError, parseListInput, parseSearchInput, parseIncidentId } = require('./knowledge.validation');

const { PROJECTION, publicDocument } = require('./knowledge.public');
const SEARCH_FIELDS = ['incidentId', 'title', 'category', 'affectedService', 'symptoms', 'tags', 'exampleLogPatterns', 'rootCause'];
const MAX_TIME_MS = 3000;

function buildFilter({ query, category, affectedService }) {
  const filter = {};
  if (category !== undefined) filter.category = category;
  if (affectedService !== undefined) filter.affectedService = affectedService;
  if (query !== undefined) {
    const terms = [...new Set(query.split(/\s+/u))];
    // Each literal term must appear in at least one searchable field; no raw regex or Mongo operators from clients.
    filter.$and = terms.map((term) => {
      const literal = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { $or: SEARCH_FIELDS.map((field) => ({ [field]: { $regex: literal, $options: 'i' } })) };
    });
  }
  return filter;
}

/** Construct once with the shared MongoDB Db. No connection, routes, auth, or startup changes. */
function createKnowledgeService({ db } = {}) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('Supply the shared MongoDB Db connection');
  const collection = db.collection(COLLECTION_NAME);

  async function readPage(options) {
    try {
      const documents = await collection.find(buildFilter(options), { projection: PROJECTION, maxTimeMS: MAX_TIME_MS })
        .sort({ incidentId: 1, _id: 1 }).skip(options.offset).limit(options.limit + 1).toArray();
      return {
        results: documents.slice(0, options.limit).map(publicDocument),
        pagination: { limit: options.limit, offset: options.offset, hasMore: documents.length > options.limit },
      };
    } catch (cause) {
      throw new KnowledgeError('Knowledge storage is unavailable', { code: 'KNOWLEDGE_UNAVAILABLE', status: 503, cause });
    }
  }

  async function listKnowledge(input = {}) {
    const options = parseListInput(input);
    const page = await readPage(options);
    return { ...page, searchMode: options.query === undefined ? 'list' : 'keyword' };
  }

  async function getKnowledge(id) {
    const incidentId = parseIncidentId(id);
    let document;
    try {
      document = await collection.findOne({ incidentId }, { projection: PROJECTION, maxTimeMS: MAX_TIME_MS });
    } catch (cause) {
      throw new KnowledgeError('Knowledge storage is unavailable', { code: 'KNOWLEDGE_UNAVAILABLE', status: 503, cause });
    }
    if (!document) throw new KnowledgeError('Knowledge incident was not found', { code: 'KNOWLEDGE_NOT_FOUND', status: 404 });
    return publicDocument(document);
  }

  async function retrieveKnowledge(query, filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.hasOwn(filters, 'query')) {
      throw new KnowledgeError('filters must be an object without a query field');
    }
    const options = parseSearchInput({ ...filters, query });
    return { ...(await readPage(options)), searchMode: 'keyword' };
  }

  return { listKnowledge, getKnowledge, retrieveKnowledge };
}

module.exports = { createKnowledgeService };
