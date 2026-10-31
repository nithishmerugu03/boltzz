import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });
import { createRequire } from 'node:module';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { createIncidentAnalysis } from './services/incidentAnalysis.js';
import remediationRoutes from './routes/remediation.js';
import { errorEnvelope, successEnvelope } from './services/responseContract.js';

const require = createRequire(import.meta.url);
const { createKnowledgeService } = require('./modules/knowledge-rag/knowledge.service.js');
const { createKnowledgeRouter } = require('./modules/knowledge-rag/knowledge.routes.js');
const { createRagRetriever } = require('./modules/knowledge-rag/rag-retrieval.service.js');
const { readRagConfig } = require('./modules/knowledge-rag/rag.config.js');
const { knowledgeFailure } = require('./modules/knowledge-rag/knowledge.contract.js');
const { KnowledgeError } = require('./modules/knowledge-rag/knowledge.validation.js');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => res.json(successEnvelope({
  summary: 'Incident analysis and remediation service health checked.',
  data: {
    service_status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    groq_configured: Boolean(process.env.GROQ_API_KEY),
    groq_model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    knowledge_search_backend: process.env.KNOWLEDGE_SEARCH_BACKEND || 'keyword',
    review_workflow: 'LOCAL_TEMPORARY',
    runbook_source: 'SIMULATED_SAMPLE_RUNBOOK'
  }
})));
app.use('/api/remediation', remediationRoutes);

let knowledgeRouter;
let knowledgeRouterDb;
app.use('/api/knowledge', (req, res, next) => {
  const db = mongoose.connection.readyState === 1 ? mongoose.connection.db : null;
  if (!db) {
    const error = new KnowledgeError('MongoDB is not connected. Configure MONGODB_URI before using knowledge retrieval.', {
      code: 'KNOWLEDGE_UNAVAILABLE',
      status: 503
    });
    const output = knowledgeFailure({
      incidentId: req.body?.incident_id ?? req.query?.incident_id ?? null,
      query: req.body?.query ?? req.query?.q ?? null,
      error
    });
    return res.status(503).json(output);
  }
  if (db !== knowledgeRouterDb) {
    const config = readRagConfig({
      ...process.env,
      KNOWLEDGE_SEARCH_BACKEND: process.env.KNOWLEDGE_SEARCH_BACKEND || 'keyword'
    });
    const service = {
      ...createKnowledgeService({ db }),
      ...createRagRetriever({ db, config })
    };
    knowledgeRouter = createKnowledgeRouter({ Router: express.Router, service });
    knowledgeRouterDb = db;
  }
  return knowledgeRouter(req, res, next);
});

const analyzeIncident = createIncidentAnalysis({
  getRetriever() {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      throw new KnowledgeError('MongoDB is not connected.', { code: 'KNOWLEDGE_UNAVAILABLE', status: 503 });
    }
    const config = readRagConfig({
      ...process.env,
      KNOWLEDGE_SEARCH_BACKEND: process.env.KNOWLEDGE_SEARCH_BACKEND || 'keyword'
    });
    return createRagRetriever({ db: mongoose.connection.db, config });
  }
});

app.post('/api/analysis', async (req, res, next) => {
  try {
    const result = await analyzeIncident(req.body);
    const status = result.status === 'failed' ? 400 : 200;
    return res.status(status).json(result);
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => res.status(404).json(errorEnvelope({ status: 404, message: `No remediation endpoint exists for ${req.method} ${req.path}.` })));
app.use((err, _req, res, _next) => {
  console.error('API error:', err.message);
  const status = err.statusCode || 500;
  res.status(status).json(errorEnvelope({ status, message: status < 500 ? err.message : 'The remediation request could not be completed.' }));
});

const port = Number(process.env.PORT) || 4000;
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => console.log('Connected to MongoDB.'))
    .catch(() => console.error('MongoDB connection unavailable. Check MONGODB_URI, database availability, and access permissions.'));
} else console.warn('MONGODB_URI is not configured; persistence APIs will return 503.');

app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Remediation API listening on port ${port}`));
export default app;
