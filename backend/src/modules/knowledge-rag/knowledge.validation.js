'use strict';

const { CATEGORIES } = require('./knowledge.model');

class KnowledgeError extends Error {
  constructor(message, { code = 'INVALID_REQUEST', status = 400, cause } = {}) {
    super(message, { cause });
    this.name = 'KnowledgeError';
    this.code = code;
    this.status = status;
  }
}

function objectInput(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KnowledgeError('Request must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new KnowledgeError(`Unsupported field: ${key}`);
  }
}

function text(value, field, maxLength, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\x00-\x1F\x7F]/.test(value)) {
    throw new KnowledgeError(`${field} must be a non-empty string of at most ${maxLength} characters without control characters`);
  }
  return value.trim();
}

function integer(value, field, fallback, max, allowQueryStrings) {
  if (value === undefined) return fallback;
  const parsed = allowQueryStrings && typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  const minimum = field === 'limit' ? 1 : 0;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < minimum || parsed > max) {
    throw new KnowledgeError(`${field} must be an integer from ${minimum} to ${max}`);
  }
  return parsed;
}

function filters(input, allowQueryStrings) {
  const category = text(input.category, 'category', 50);
  if (category !== undefined && !CATEGORIES.includes(category)) throw new KnowledgeError('Unsupported category');
  return {
    category,
    affectedService: text(input.affectedService, 'affectedService', 100),
    limit: integer(input.limit, 'limit', 10, 50, allowQueryStrings),
    offset: integer(input.offset, 'offset', 0, 10000, allowQueryStrings),
  };
}

function queryText(value, required) {
  const query = text(value, 'query', 300, { required });
  if (query !== undefined && query.split(/\s+/u).length > 12) throw new KnowledgeError('query must contain at most 12 terms');
  return query;
}

function parseListInput(input = {}, { allowQueryStrings = false } = {}) {
  objectInput(input, ['q', 'category', 'affectedService', 'limit', 'offset']);
  return { query: queryText(input.q, false), ...filters(input, allowQueryStrings) };
}

function parseSearchInput(input) {
  objectInput(input, ['query', 'category', 'affectedService', 'limit', 'offset']);
  return { query: queryText(input.query, true), ...filters(input, false) };
}

function parseIncidentId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new KnowledgeError('id must be a valid incident identifier of at most 128 characters');
  }
  return value;
}

module.exports = { KnowledgeError, parseListInput, parseSearchInput, parseIncidentId };
