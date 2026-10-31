'use strict';

const { KnowledgeError } = require('./knowledge.validation');
const { publicDocument } = require('./knowledge.public');

const COMPONENT = 'knowledge';
const COMMON_FIELDS = Object.freeze(['incident_id', 'component', 'status', 'timestamp', 'summary',
  'findings', 'evidence', 'recommendations', 'data', 'error']);

function contextString(value) { return typeof value === 'string' ? value : null; }

function envelope({ incidentId, query, now }) {
  return {
    incident_id: contextString(incidentId), component: COMPONENT, status: 'completed',
    timestamp: now.toISOString(), summary: '', findings: [], evidence: [], recommendations: [],
    data: { query: contextString(query), retrieved_incidents: [], retrieval_count: 0 }, error: null,
  };
}

function knowledgeSuccess({ incidentId = null, query = null, documents, similarityScores = {}, now = new Date() }) {
  const output = envelope({ incidentId, query, now });
  output.data.retrieved_incidents = documents.map((document) => {
    if (typeof document.incidentId !== 'string' || !document.incidentId) throw new TypeError('Retrieved knowledge is missing its citation ID');
    const score = similarityScores[document.incidentId];
    return {
      incident_id: document.incidentId,
      title: contextString(document.title),
      description: contextString(document.rootCause),
      similarity_score: typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? score : null,
      resolution: Array.isArray(document.recommendedResolution) && document.recommendedResolution.length
        ? document.recommendedResolution.join('\n') : null,
    };
  });
  output.data.retrieval_count = output.data.retrieved_incidents.length;
  output.summary = output.data.retrieval_count
    ? `Retrieved ${output.data.retrieval_count} historical knowledge record(s). Historical causes are not confirmed findings about the current incident.`
    : 'No historical knowledge records were retrieved.';
  output.evidence = documents.flatMap((document) => {
    const source = `knowledge_documents/${document.incidentId}`;
    const evidence = [{
      source, reference: document.incidentId,
      content: JSON.stringify(publicDocument(document)),
      relevance: 'Retrieved source for the historical description and resolution. Synthetic records are fictional context, not evidence of the current incident.',
    }];
    for (const [index, content] of (document.supportingEvidence ?? []).entries()) {
      if (typeof content !== 'string') throw new TypeError('Invalid retrieved supporting evidence');
      evidence.push({ source, reference: `${document.incidentId}#supportingEvidence[${index}]`, content,
        relevance: 'Supporting evidence recorded in this historical source; not a confirmed observation of the current incident.' });
    }
    return evidence;
  });
  return output;
}

function knowledgeFailure({ incidentId = null, query = null, error, now = new Date() }) {
  const output = envelope({ incidentId, query, now });
  output.status = 'failed';
  output.summary = 'Knowledge retrieval did not complete.';
  output.error = {
    code: error instanceof KnowledgeError ? error.code : 'INTERNAL_ERROR',
    message: error instanceof KnowledgeError ? error.message : 'An unexpected knowledge module error occurred',
    details: null,
  };
  return output;
}

function knowledgeHttpStatus(output) {
  if (output.status !== 'failed') return 200;
  return { INVALID_REQUEST: 400, PAYLOAD_TOO_LARGE: 413, KNOWLEDGE_NOT_FOUND: 404, KNOWLEDGE_UNAVAILABLE: 503, SEMANTIC_UNAVAILABLE: 503 }[output.error.code] ?? 500;
}

module.exports = { COMPONENT, COMMON_FIELDS, contextString, knowledgeSuccess, knowledgeFailure, knowledgeHttpStatus };
