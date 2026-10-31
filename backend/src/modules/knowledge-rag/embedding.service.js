'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EMBEDDING_IDENTITY, MAX_TOKENS, readRagConfig } = require('./rag.config');

class RetrievalUnavailable extends Error {
  constructor(code, { cause } = {}) {
    super(code, { cause });
    this.name = 'RetrievalUnavailable';
    this.code = code;
  }
}

function buildEmbeddingText(document) {
  const lines = [
    ['Title', document.title], ['Symptoms', document.symptoms],
    ['Service', document.affectedService], ['Error logs', document.exampleLogPatterns],
  ];
  return lines.map(([label, value]) => {
    const entries = Array.isArray(value) ? value : [value];
    if (!entries.length || entries.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      throw new TypeError(`Missing embedding input: ${label}`);
    }
    return `${label}: ${entries.map((entry) => entry.trim()).join('; ')}`;
  }).join('\n');
}

function contentHash(document) {
  return createHash('sha256').update(buildEmbeddingText(document)).digest('hex');
}

function validVector(vector) {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_IDENTITY.dimensions ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  const squaredNorm = vector.reduce((sum, value) => sum + value * value, 0);
  return Number.isFinite(squaredNorm) && squaredNorm > 0;
}

function compatibleMetadata(metadata) {
  return metadata && Object.entries(EMBEDDING_IDENTITY).every(([key, value]) => metadata[key] === value);
}

function currentEmbedding(document) {
  if (!compatibleMetadata(document.embeddingMetadata) || !validVector(document.embedding)) return false;
  try { return document.embeddingMetadata.contentHash === contentHash(document); }
  catch { return false; }
}

async function loadPipeline(config) {
  const { pipeline } = await import('@huggingface/transformers');
  const modelDirectory = path.join(config.cacheDir, ...EMBEDDING_IDENTITY.model.split('/'), EMBEDDING_IDENTITY.revision);
  let cached = true;
  try {
    await Promise.all(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
      .map((file) => fs.access(path.join(modelDirectory, file))));
  } catch { cached = false; }
  // The v4 helper probes Hub metadata for model IDs even when weights are cached.
  // A complete pinned directory can instead be loaded as a fully local model.
  return pipeline('feature-extraction', cached ? modelDirectory : EMBEDDING_IDENTITY.model, {
    revision: EMBEDDING_IDENTITY.revision, dtype: EMBEDDING_IDENTITY.dtype,
    device: 'cpu', cache_dir: config.cacheDir, local_files_only: cached,
  });
}

function createEmbeddingService({ config = readRagConfig(), pipelineFactory = loadPipeline } = {}) {
  let pending;
  const getPipeline = () => {
    if (!pending) pending = Promise.resolve().then(() => pipelineFactory(config)).catch((cause) => {
      pending = undefined; // A failed download/load can be retried explicitly on a later request.
      throw new RetrievalUnavailable('EMBEDDING_UNAVAILABLE', { cause });
    });
    return pending;
  };

  async function embed(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new TypeError('Embedding text must contain 1 to 20000 characters');
    const pipe = await getPipeline();
    try {
      const tokens = await pipe.tokenizer(text, { truncation: false });
      const tokenCount = Number(tokens.input_ids.size);
      if (!Number.isInteger(tokenCount) || tokenCount < 1) throw new Error('Invalid tokenizer output');
      if (tokenCount > MAX_TOKENS) throw new RetrievalUnavailable('EMBEDDING_TEXT_TOO_LONG');
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const vector = output.tolist()[0];
      if (!validVector(vector)) throw new Error('Invalid model vector');
      return { vector, tokenCount };
    } catch (cause) {
      if (cause instanceof RetrievalUnavailable) throw cause;
      throw new RetrievalUnavailable('EMBEDDING_UNAVAILABLE', { cause });
    }
  }

  return {
    identity: EMBEDDING_IDENTITY,
    embedQuery: (query) => embed(query),
    embedDocument: (document) => embed(buildEmbeddingText(document)),
    async dispose() {
      const loading = pending;
      pending = undefined;
      if (loading) await (await loading).dispose();
    },
  };
}

module.exports = { createEmbeddingService, buildEmbeddingText, contentHash, validVector,
  compatibleMetadata, currentEmbedding, RetrievalUnavailable };
