'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createEmbeddingService } = require('./embedding.service');
const { cosineSimilarity } = require('./vector.math');
const { syntheticIncidents } = require('./data/synthetic-incidents');
const queries = require('./evaluation/queries');

async function evaluateRetrieval({ embeddings = createEmbeddingService(), networkDisabled = false } = {}) {
  const documents = [];
  for (const incident of syntheticIncidents) {
    const { vector, tokenCount } = await embeddings.embedDocument(incident);
    documents.push({ incidentId: incident.incidentId, vector, tokenCount });
  }
  const results = [];
  for (const { query, incidentId } of queries) {
    const { vector } = await embeddings.embedQuery(query);
    const top = documents.map((document) => ({ incidentId: document.incidentId, similarity: cosineSimilarity(document.vector, vector) }))
      .sort((a, b) => b.similarity - a.similarity || a.incidentId.localeCompare(b.incidentId)).slice(0, 3);
    results.push({ query, expected: incidentId, top, top1: top[0].incidentId === incidentId, top3: top.some((entry) => entry.incidentId === incidentId) });
  }
  return {
    testedAt: new Date().toISOString(), type: 'real-local-model; no database or Atlas',
    identity: embeddings.identity, documents: documents.length, queries: results.length,
    transformersVersion: require('../../../package.json').dependencies['@huggingface/transformers'],
    networkDisabled,
    maxDocumentTokens: Math.max(...documents.map((document) => document.tokenCount)),
    top1: results.filter((result) => result.top1).length / results.length,
    top3: results.filter((result) => result.top3).length / results.length,
    limitations: 'Small hand-written synthetic relevance set; not a production benchmark. No chunk averaging.',
    results,
  };
}

if (require.main === module) {
  const offline = process.argv.includes('--offline');
  if (offline) globalThis.fetch = async () => { throw new Error('Network disabled by offline evaluation'); };
  const embeddings = createEmbeddingService();
  (async () => {
    try {
      const report = await evaluateRetrieval({ embeddings, networkDisabled: offline });
      const output = path.join(__dirname, 'evaluation/local-model-results.json');
      await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ documents: report.documents, queries: report.queries, top1: report.top1, top3: report.top3, maxDocumentTokens: report.maxDocumentTokens, report: output }));
      if (report.top3 < 0.85) process.exitCode = 1;
    } finally { await embeddings.dispose(); }
  })().catch((error) => { console.error(error.code ?? error.name); process.exitCode = 1; });
}

module.exports = { evaluateRetrieval };
