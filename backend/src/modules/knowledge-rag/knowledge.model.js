'use strict';

const COLLECTION_NAME = 'knowledge_documents';
const CATEGORIES = Object.freeze(['Database', 'Backend/API', 'Deployment', 'Infrastructure', 'Network', 'Security']);
const SOURCE_TYPES = Object.freeze(['synthetic', 'curated', 'imported']);
const TEXT_FIELDS = ['incidentId', 'title', 'category', 'affectedService', 'rootCause'];
const LIST_FIELDS = ['symptoms', 'exampleLogPatterns', 'supportingEvidence', 'troubleshootingSteps',
  'recommendedResolution', 'verificationChecks', 'preventiveActions', 'tags'];
const OPTIONAL_FIELDS = ['runbookReferences', 'embedding', 'embeddingMetadata', 'seedDataset'];
const ALLOWED_FIELDS = new Set(['_id', ...TEXT_FIELDS, ...LIST_FIELDS, ...OPTIONAL_FIELDS,
  'sourceType', 'createdAt', 'updatedAt']);

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) {
    throw new TypeError(`${name} must be a non-empty string of at most 10000 characters`);
  }
}

function assertStringList(value, name, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 200) {
    throw new TypeError(`${name} must be ${allowEmpty ? 'an' : 'a non-empty'} array of at most 200 strings`);
  }
  value.forEach((item, index) => assertString(item, `${name}[${index}]`));
}

/** Validate without connecting to MongoDB or changing collection configuration. */
function validateKnowledgeDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('Knowledge document must be an object');
  }
  for (const key of Object.keys(document)) {
    if (!ALLOWED_FIELDS.has(key)) throw new TypeError(`Unknown knowledge field: ${key}`);
  }
  TEXT_FIELDS.forEach((field) => assertString(document[field], field));
  LIST_FIELDS.forEach((field) => assertStringList(document[field], field));
  if (!CATEGORIES.includes(document.category)) throw new TypeError('Unsupported category');
  if (!SOURCE_TYPES.includes(document.sourceType)) throw new TypeError('Unsupported sourceType');
  for (const field of ['createdAt', 'updatedAt']) {
    if (!(document[field] instanceof Date) || !Number.isFinite(document[field].getTime())) {
      throw new TypeError(`${field} must be a valid Date`);
    }
  }
  if (document.updatedAt < document.createdAt) throw new TypeError('updatedAt precedes createdAt');
  if (document.runbookReferences !== undefined) assertStringList(document.runbookReferences, 'runbookReferences', true);
  if (document.seedDataset !== undefined) {
    assertString(document.seedDataset, 'seedDataset');
    if (document.sourceType !== 'synthetic') throw new TypeError('Seed records must be synthetic');
  }
  if ((document.embedding === undefined) !== (document.embeddingMetadata === undefined)) {
    throw new TypeError('embedding and embeddingMetadata must be supplied together');
  }
  if (document.embedding !== undefined) {
    const { embedding, embeddingMetadata: metadata } = document;
    if (!Array.isArray(embedding) || embedding.length === 0 || embedding.length > 8192 ||
        !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('embedding must contain 1 to 8192 finite numbers');
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new TypeError('embeddingMetadata must be an object');
    }
    if (Object.keys(metadata).some((key) => !['provider', 'model', 'dimensions', 'revision', 'dtype', 'textVersion', 'contentHash', 'embeddedAt'].includes(key))) {
      throw new TypeError('Unknown embedding metadata field');
    }
    assertString(metadata.provider, 'embeddingMetadata.provider');
    assertString(metadata.model, 'embeddingMetadata.model');
    for (const field of ['revision', 'dtype', 'textVersion']) {
      if (metadata[field] !== undefined) assertString(metadata[field], `embeddingMetadata.${field}`);
    }
    if (metadata.contentHash !== undefined && !/^[a-f0-9]{64}$/.test(metadata.contentHash)) {
      throw new TypeError('Invalid embedding content hash');
    }
    if (metadata.embeddedAt !== undefined && (!(metadata.embeddedAt instanceof Date) || !Number.isFinite(metadata.embeddedAt.getTime()))) {
      throw new TypeError('embeddingMetadata.embeddedAt must be a valid Date');
    }
    if (!Number.isInteger(metadata.dimensions) || metadata.dimensions !== embedding.length) {
      throw new TypeError('Embedding dimensions do not match the vector');
    }
    if (!embedding.some((value) => value !== 0)) throw new TypeError('Embedding cannot be a zero vector');
  }
  return document;
}

function createKnowledgeDocument(input, { now = new Date() } = {}) {
  // Validate original inputs before copying so invalid Dates and non-finite vectors are not coerced.
  const document = { ...input, createdAt: input?.createdAt ?? now, updatedAt: input?.updatedAt ?? now };
  validateKnowledgeDocument(document);
  return structuredClone(document);
}

// Exported for the shared database owner's review; this module never applies collMod/createCollection.
const stringList = { bsonType: 'array', minItems: 1, maxItems: 200, items: { bsonType: 'string', minLength: 1, maxLength: 10000 } };
const mongoJsonSchema = {
  bsonType: 'object',
  required: [...TEXT_FIELDS, ...LIST_FIELDS, 'sourceType', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    _id: {},
    ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, { bsonType: 'string', minLength: 1, maxLength: 10000 }])),
    ...Object.fromEntries(LIST_FIELDS.map((field) => [field, stringList])),
    category: { enum: [...CATEGORIES] },
    sourceType: { enum: [...SOURCE_TYPES] },
    createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
    seedDataset: { bsonType: 'string', minLength: 1 },
    runbookReferences: { ...stringList, minItems: 0 },
    embedding: { bsonType: 'array', minItems: 1, maxItems: 8192, items: { bsonType: ['double', 'int', 'long', 'decimal'] } },
    embeddingMetadata: {
      bsonType: 'object', required: ['provider', 'model', 'dimensions'], additionalProperties: false,
      properties: {
        provider: { bsonType: 'string', minLength: 1 }, model: { bsonType: 'string', minLength: 1 },
        dimensions: { bsonType: 'int', minimum: 1, maximum: 8192 },
        revision: { bsonType: 'string', minLength: 1 }, dtype: { bsonType: 'string', minLength: 1 },
        textVersion: { bsonType: 'string', minLength: 1 }, contentHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
        embeddedAt: { bsonType: 'date' },
      },
    },
  },
};

module.exports = { COLLECTION_NAME, CATEGORIES, SOURCE_TYPES, createKnowledgeDocument, validateKnowledgeDocument, mongoJsonSchema };
