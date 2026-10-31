import monitoringAgent from "../agents/monitoringAgent.js";

class MonitoringService {
  constructor() {
    this.incidents = [
      {
        id: "INC-1001",
        title: "API latency spike",
        severity: "high",
        status: "investigating",
        source: "monitoring",
        service: "payments-api",
        owner: "platform-team",
        summary: "Customer-facing API latency increased by 42% over the last 20 minutes.",
        impact: "Checkout requests are timing out intermittently.",
        createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
        updatedAt: new Date().toISOString(),
        correlationKey: "payments-api:monitoring",
        timeline: [
          { id: "EVT-1", timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), type: "latency", level: "warning", source: "monitoring", message: "Latency exceeded baseline threshold." },
        ],
      },
      {
        id: "INC-1002",
        title: "Database connection burst",
        severity: "critical",
        status: "open",
        source: "monitoring",
        service: "user-service",
        owner: "data-services",
        summary: "Multiple write failures are occurring during peak traffic.",
        impact: "User profile updates are failing for a subset of customers.",
        createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
        updatedAt: new Date().toISOString(),
        correlationKey: "user-service:monitoring",
        timeline: [
          { id: "EVT-2", timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(), type: "db-error", level: "critical", source: "monitoring", message: "Write failures detected on primary database connection pool." },
        ],
      },
    ];

    this.alerts = [
      {
        id: "ALT-1001",
        incidentId: "INC-1001",
        ruleId: "latency-rule",
        severity: "high",
        status: "open",
        source: "monitoring",
        description: "Latency spike for payments-api",
        createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      },
    ];

    this.events = [
      {
        id: "EVT-1",
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        source: "monitoring",
        service: "payments-api",
        type: "latency",
        level: "warning",
        message: "Latency exceeded baseline threshold.",
        metadata: { p95: 1200 },
        incidentId: "INC-1001",
      },
      {
        id: "EVT-2",
        timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
        source: "monitoring",
        service: "user-service",
        type: "db-error",
        level: "critical",
        message: "Write failures detected on primary database connection pool.",
        metadata: { failedWrites: 45 },
        incidentId: "INC-1002",
      },
    ];
  }

  getIncidents() {
    return this.incidents;
  }

  getIncidentsById(id) {
    return this.incidents.find((incident) => incident.id === id) || null;
  }

  getAlerts() {
    return this.alerts;
  }

  getMetrics() {
    return monitoringAgent.buildDashboardMetrics(this.incidents, this.alerts, this.events);
  }

  getTimelineByIncidentId(id) {
    const incident = this.getIncidentsById(id);
    const timeline = incident?.timeline || [];
    return monitoringAgent.buildTimeline(timeline.length ? timeline : this.events.filter((event) => event.incidentId === id));
  }

  ingestIncident(payload) {
    const incident = monitoringAgent.normalizeIncidentPayload(payload);
    const existingIndex = this.incidents.findIndex((item) => item.id === incident.id);

    if (existingIndex >= 0) {
      this.incidents[existingIndex] = {
        ...this.incidents[existingIndex],
        ...incident,
        updatedAt: new Date().toISOString(),
      };
    } else {
      this.incidents.unshift(incident);
    }

    const alert = monitoringAgent.buildAlertFromIncident(incident);
    this.alerts.unshift(alert);

    return { incident, alert };
  }

  addEvent(payload) {
    const event = monitoringAgent.normalizeEvent(payload);
    this.events.unshift(event);

    const relatedIncidents = monitoringAgent.correlateEvent(event, this.incidents);

    if (relatedIncidents.length > 0) {
      this.incidents = this.incidents.map((incident) => {
        if (relatedIncidents.some((related) => related.id === incident.id)) {
          return {
            ...incident,
            updatedAt: new Date().toISOString(),
            timeline: [...(incident.timeline || []), event],
          };
        }
        return incident;
      });
    }

    return { event, relatedIncidents: relatedIncidents.map((incident) => incident.id) };
  }
}

export default MonitoringService;
