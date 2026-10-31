import express from "express";
import MonitoringService from "../services/monitoringService.js";

const router = express.Router();
const monitoringService = new MonitoringService();

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "IncidentIQ monitoring service is running",
    uptime: process.uptime(),
  });
});

router.get("/incidents", (req, res) => {
  res.json({
    success: true,
    incidents: monitoringService.getIncidents(),
  });
});

router.get("/incidents/:id", (req, res) => {
  const incident = monitoringService.getIncidentsById(req.params.id);

  if (!incident) {
    return res.status(404).json({ success: false, message: "Incident not found" });
  }

  return res.json({ success: true, incident });
});

router.get("/incidents/:id/timeline", (req, res) => {
  const timeline = monitoringService.getTimelineByIncidentId(req.params.id);
  res.json({ success: true, timeline });
});

router.get("/alerts", (req, res) => {
  res.json({ success: true, alerts: monitoringService.getAlerts() });
});

router.get("/metrics", (req, res) => {
  res.json({ success: true, metrics: monitoringService.getMetrics() });
});

router.post("/incidents/ingest", (req, res) => {
  const payload = req.body || {};

  try {
    const { incident, alert } = monitoringService.ingestIncident(payload);
    res.status(201).json({ success: true, incident, alert });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/events", (req, res) => {
  const payload = req.body || {};

  try {
    const result = monitoringService.addEvent(payload);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
