import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import monitoringRoutes from "./routes/monitoring.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
// War Room workflow orchestration lives in the Python ai-workflow service (FastAPI + LangGraph).
const AI_WORKFLOW_URL = (process.env.AI_WORKFLOW_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "IncidentIQ backend is running",
    module: "monitoring-dashboard",
  });
});

// War Room: forward /api/workflow/* to the AI workflow service (no orchestration logic here).
app.use("/api/workflow", async (req, res) => {
  try {
    const upstream = await fetch(`${AI_WORKFLOW_URL}${req.url}`, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
  } catch (err) {
    console.error(`AI workflow service error for ${req.method} ${req.url}: ${err.message}`);
    res.status(502).json({ error: { code: "AI_WORKFLOW_UNAVAILABLE", message: "AI workflow service is unreachable" } });
  }
});

app.use("/api", monitoringRoutes);

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (AI workflow: ${AI_WORKFLOW_URL})`);
  });
};

startServer();
