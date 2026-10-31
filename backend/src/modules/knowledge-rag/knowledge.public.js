'use strict';

const PUBLIC_FIELDS = Object.freeze(['incidentId', 'title', 'category', 'affectedService', 'symptoms',
  'exampleLogPatterns', 'rootCause', 'supportingEvidence', 'troubleshootingSteps', 'recommendedResolution',
  'verificationChecks', 'preventiveActions', 'sourceType', 'tags', 'runbookReferences', 'createdAt', 'updatedAt']);
const PROJECTION = Object.freeze({ _id: 0, ...Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, 1])) });

function publicDocument(document) {
  return Object.fromEntries(PUBLIC_FIELDS.filter((field) => document[field] !== undefined)
    .map((field) => [field, document[field]]));
}

module.exports = { PUBLIC_FIELDS, PROJECTION, publicDocument };
