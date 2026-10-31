'use strict';

const { parseIncidentId, parseSearchInput, KnowledgeError } = require('./knowledge.validation');
const { knowledgeSuccess, knowledgeFailure } = require('./knowledge.contract');

/** LangGraph-compatible async node. Only knowledge-module input is needed; no assumptions about other agents. */
function createKnowledgeWorkflowNode({ retriever, now = () => new Date() } = {}) {
  if (typeof retriever?.retrieveKnowledge !== 'function') throw new TypeError('Supply the knowledge retriever');
  return async function knowledgeNode(input) {
    const incidentId = typeof input?.incident_id === 'string' ? input.incident_id : null;
    const query = typeof input?.query === 'string' ? input.query : null;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KnowledgeError('Knowledge input must be an object');
      const { incident_id, ...searchInput } = input;
      parseIncidentId(incident_id); // Validate without replacing or trimming the workflow incident ID.
      const { query: validatedQuery, ...filters } = parseSearchInput(searchInput);
      const result = typeof retriever.retrieveKnowledgeWithScores === 'function'
        ? await retriever.retrieveKnowledgeWithScores(validatedQuery, filters)
        : await retriever.retrieveKnowledge(validatedQuery, filters);
      return knowledgeSuccess({ incidentId, query, documents: result.results,
        similarityScores: result.similarityScores, now: now() });
    } catch (error) {
      return knowledgeFailure({ incidentId, query, error, now: now() });
    }
  };
}

module.exports = { createKnowledgeWorkflowNode };
