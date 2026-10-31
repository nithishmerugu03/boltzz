'use strict';

const { createKnowledgeController, knowledgeErrorHandler } = require('./knowledge.controller');

/** Router and service are injected by the shared Express application. Mount behind its authentication/authorisation. */
function createKnowledgeRouter({ Router, service } = {}) {
  if (typeof Router !== 'function') throw new TypeError('Supply the shared Express Router factory');
  for (const method of ['listKnowledge', 'getKnowledge', 'retrieveKnowledge']) {
    if (typeof service?.[method] !== 'function') throw new TypeError(`Knowledge service requires ${method}`);
  }
  const router = Router();
  const controller = createKnowledgeController({ service });
  router.get('/', controller.list);
  router.post('/search', controller.search);
  router.get('/:id', controller.details);
  router.use(knowledgeErrorHandler);
  return router;
}

module.exports = { createKnowledgeRouter };
