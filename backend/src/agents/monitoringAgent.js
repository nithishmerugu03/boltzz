const severityRank = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const defaultIncident = {
  id: "INC-1000",
  title: "Unknown incident",
  severity: "medium",
  status: "open",
  source: "monitoring",
  service: "unknown",
  owner: "oncall",
  summary: "No additional details received.",
  impact: "Service impact not yet confirmed.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  correlationKey: "unknown",
  timeline: [],
};

export const normalizeIncidentPayload = (payload = {}) => {
  const incident = {
    ...defaultIncident,
    ...payload,
    id: payload.id || `INC-${Date.now()}`,
    severity: payload.severity || "medium",
    status: payload.status || "open",
    source: payload.source || "monitoring",
    service: payload.service || "unknown",
    owner: payload.owner || "oncall",
    impact: payload.impact || defaultIncident.impact,
    summary: payload.summary || defaultIncident.summary,
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: payload.updatedAt || new Date().toISOString(),
    correlationKey: payload.correlationKey || `${payload.service || "unknown"}:${payload.source || "monitoring"}`,
    timeline: Array.isArray(payload.timeline) ? payload.timeline : [],
  };

  return incident;
};

export const normalizeEvent = (event = {}) => ({
  id: event.id || `EVT-${Date.now()}`,
  timestamp: event.timestamp || new Date().toISOString(),
  source: event.source || "monitoring",
  service: event.service || "unknown",
  type: event.type || "event",
  level: event.level || "info",
  message: event.message || "Monitoring event received.",
  metadata: event.metadata || {},
  incidentId: event.incidentId || null,
});

export const correlateEvent = (event, incidents) => {
  if (!Array.isArray(incidents) || incidents.length === 0) {
    return [];
  }

  return incidents.filter((incident) => {
    const sameService = incident.service === event.service;
    const sameSource = incident.source === event.source;
    const sameCorrelation = incident.correlationKey === `${event.service}:${event.source}`;
    return sameService || sameSource || sameCorrelation;
  });
};

export const buildTimeline = (events = []) =>
  [...events]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      level: event.level,
      source: event.source,
      message: event.message,
      service: event.service,
    }));

export const buildDashboardMetrics = (incidents = [], alerts = [], events = []) => ({
  totalIncidents: incidents.length,
  activeIncidents: incidents.filter((incident) => incident.status !== "resolved").length,
  criticalIncidents: incidents.filter((incident) => incident.severity === "critical").length,
  openAlerts: alerts.filter((alert) => alert.status !== "resolved").length,
  totalEvents: events.length,
  avgSeverity: incidents.length
    ? Math.round(
        incidents.reduce((total, incident) => total + (severityRank[incident.severity] || 0), 0) / incidents.length
      )
    : 0,
});

export const buildAlertFromIncident = (incident) => ({
  id: `ALT-${Date.now()}`,
  incidentId: incident.id,
  ruleId: "monitoring-threshold",
  severity: incident.severity,
  status: "open",
  source: incident.source,
  description: `${incident.title} is currently active for service ${incident.service}`,
  createdAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
});

export default {
  normalizeIncidentPayload,
  normalizeEvent,
  correlateEvent,
  buildTimeline,
  buildDashboardMetrics,
  buildAlertFromIncident,
};
