export const knownIncidents = [
  {
    name: "database connection exhaustion",
    expectedCategory: "DATABASE_CONNECTION_EXHAUSTION",
    incident: {
      incidentId: "INC-DB-001",
      service: "payment-service",
      severity: "critical",
      logs: [
        { id: "DB-LOG-001", message: "Database connection pool exhausted", severity: "ERROR", timestamp: "2026-10-31T10:04:00Z" },
        { id: "DB-LOG-002", message: "Connection acquisition timeout", severity: "ERROR", timestamp: "2026-10-31T10:04:30Z" }
      ],
      events: [
        { id: "DB-EVT-003", type: "alert", message: "HTTP 500 errors increased for payment service", timestamp: "2026-10-31T10:05:00Z" }
      ],
      deployments: [
        { id: "DB-DEP-004", message: "Deployment completed", timestamp: "2026-10-31T10:02:00Z" }
      ]
    }
  },
  {
    name: "memory exhaustion",
    expectedCategory: "MEMORY_EXHAUSTION",
    incident: {
      incidentId: "INC-MEM-002",
      service: "order-service",
      severity: "critical",
      logs: [
        { id: "MEM-LOG-001", message: "JavaScript heap out of memory", severity: "FATAL", timestamp: "2026-10-31T11:00:00Z" }
      ],
      events: [
        { id: "MEM-EVT-002", message: "Order process restarted after OOM", timestamp: "2026-10-31T11:01:00Z" }
      ],
      metrics: [
        { id: "MEM-MET-003", metricName: "memory_usage", value: 95, threshold: 80, timestamp: "2026-10-31T10:59:00Z" }
      ]
    }
  },
  {
    name: "authentication traffic anomaly",
    expectedCategory: "AUTHENTICATION_TRAFFIC_ANOMALY",
    incident: {
      incidentId: "INC-AUTH-003",
      service: "auth-service",
      severity: "high",
      logs: Array.from({ length: 5 }, (_, index) => ({
        id: `AUTH-LOG-${String(index + 1).padStart(3, "0")}`,
        message: "Failed login attempt for account",
        ip: "203.0.113.42",
        timestamp: `2026-10-31T12:00:0${index}Z`
      }))
    }
  },
  {
    name: "upstream dependency failure",
    expectedCategory: "DEPENDENCY_FAILURE",
    incident: {
      incidentId: "INC-DEP-004",
      service: "checkout-service",
      severity: "high",
      logs: [
        { id: "DEP-LOG-001", message: "Downstream payment-provider timeout", severity: "ERROR", timestamp: "2026-10-31T13:00:00Z" },
        { id: "DEP-LOG-002", message: "Retry attempts failed for upstream dependency", severity: "ERROR", timestamp: "2026-10-31T13:00:10Z" }
      ],
      events: [
        { id: "DEP-EVT-003", message: "Upstream payment provider unavailable", timestamp: "2026-10-31T13:00:20Z" }
      ]
    }
  },
  {
    name: "possible deployment regression",
    expectedCategory: "POSSIBLE_DEPLOYMENT_REGRESSION",
    incident: {
      incidentId: "INC-REL-005",
      service: "inventory-service",
      severity: "high",
      events: [
        { id: "REL-EVT-001", message: "Service was stable before deployment", timestamp: "2026-10-31T13:58:00Z" },
        { id: "REL-EVT-002", message: "Version 2.4 deployment completed", timestamp: "2026-10-31T14:00:00Z" },
        { id: "REL-EVT-003", message: "HTTP 500 errors introduced after deployment", severity: "ERROR", timestamp: "2026-10-31T14:02:00Z" }
      ]
    }
  }
];
