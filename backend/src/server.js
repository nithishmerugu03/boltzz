require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const remediationRoutes = require('./routes/remediation.js');
const { errorEnvelope, successEnvelope } = require('./services/responseContract.js');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => res.json(successEnvelope({ summary: 'Remediation service health checked.', data: { service_status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', groq_configured: Boolean(process.env.GROQ_API_KEY), review_workflow: 'LOCAL_TEMPORARY', runbook_source: 'SIMULATED_SAMPLE_RUNBOOK' } })));
app.use('/api/remediation', remediationRoutes);
app.use((req, res) => res.status(404).json(errorEnvelope({ status: 404, message: `No remediation endpoint exists for ${req.method} ${req.path}.` })));
app.use((err, _req, res, _next) => {
  console.error('API error:', err.message);
  const status = err.statusCode || 500;
  res.status(status).json(errorEnvelope({ status, message: status < 500 ? err.message : 'The remediation request could not be completed.' }));
});

const port = Number(process.env.PORT) || 4000;
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => console.log('Connected to MongoDB Atlas.'))
    .catch((err) => console.error(`MongoDB connection unavailable: ${err.message}`));
} else console.warn('MONGODB_URI is not configured; persistence APIs will return 503.');

app.listen(port, () => console.log(`Remediation API listening on http://localhost:${port}`));
module.exports = app;
