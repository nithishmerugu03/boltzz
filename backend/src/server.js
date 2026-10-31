// Express API gateway. Workflow orchestration lives in the Python ai-workflow service;
// this layer only forwards /api/* requests so the frontend talks to a single backend.
import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const AI_WORKFLOW_URL = (process.env.AI_WORKFLOW_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', async (req, res) => {
  const target = `${AI_WORKFLOW_URL}${req.url}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    console.error(`AI workflow service error for ${req.method} ${req.url}: ${err.message}`);
    res.status(502).json({ error: { code: 'AI_WORKFLOW_UNAVAILABLE', message: 'AI workflow service is unreachable' } });
  }
});

app.listen(PORT, () => console.log(`AegisOps backend listening on http://localhost:${PORT} -> ${AI_WORKFLOW_URL}`));
