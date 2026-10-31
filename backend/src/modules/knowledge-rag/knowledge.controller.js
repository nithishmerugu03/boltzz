'use strict';

const { KnowledgeError, parseListInput, parseIncidentId } = require('./knowledge.validation');
const { knowledgeSuccess, knowledgeFailure, knowledgeHttpStatus } = require('./knowledge.contract');
const { createKnowledgeWorkflowNode } = require('./knowledge.workflow');

function createKnowledgeController({ service, now = () => new Date() }) {
  const workflow = createKnowledgeWorkflowNode({ retriever: service, now });
  const handle = (operation) => async (req, res, next) => {
    try {
      const output = await operation(req);
      res.status(knowledgeHttpStatus(output)).json(output);
    } catch (error) { next(error); }
  };
  return {
    list: handle(async (req) => {
      const { incident_id, ...input } = req.query ?? {};
      if (incident_id !== undefined) parseIncidentId(incident_id);
      const { query, ...filters } = parseListInput(input, { allowQueryStrings: true });
      const result = await service.listKnowledge({ ...(query === undefined ? {} : { q: query }), ...filters });
      return knowledgeSuccess({ incidentId: incident_id, query, documents: result.results, now: now() });
    }),
    details: handle(async (req) => {
      const { incident_id, ...unknown } = req.query ?? {};
      if (Object.keys(unknown).length) throw new KnowledgeError('Unsupported detail query parameter');
      if (incident_id !== undefined) parseIncidentId(incident_id);
      const document = await service.getKnowledge(parseIncidentId(req.params.id));
      return knowledgeSuccess({ incidentId: incident_id, documents: [document], now: now() });
    }),
    search: handle((req) => workflow(req.body)),
  };
}

// Express identifies error middleware by its four arguments. Unknown errors never expose internal messages or causes.
function knowledgeErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error?.type === 'entity.parse.failed') error = new KnowledgeError('Request body must be valid JSON');
  if (error?.type === 'entity.too.large') error = new KnowledgeError('Request body exceeds the configured size limit', { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  const output = knowledgeFailure({ incidentId: req.body?.incident_id ?? req.query?.incident_id,
    query: req.body?.query ?? req.query?.q, error });
  return res.status(knowledgeHttpStatus(output)).json(output);
}

module.exports = { createKnowledgeController, knowledgeErrorHandler };
