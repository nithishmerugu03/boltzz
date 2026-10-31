import assert from "node:assert/strict";
import test from "node:test";
import { createIncidentAnalysis, incidentSearchQuery } from "../src/services/incidentAnalysis.js";

test("builds a bounded knowledge query from incident service and evidence", () => {
  const query = incidentSearchQuery({
    service: "payment-service",
    description: "Database connections timeout during payment processing",
    logs: [{ message: "Pool acquisition failed" }]
  });
  assert.ok(query.length <= 300);
  assert.ok(query.split(/\s+/).length <= 8);
  assert.match(query, /payment/);
  assert.match(query, /database/);
});

test("retrieves historical Mongo knowledge and passes genuine scores to RCA/Security", async () => {
  let retrievedQuery;
  let similarIncidents;
  const analyze = async (incident, similar) => {
    similarIncidents = similar;
    return {
      incident_id: incident.incident_id,
      component: "rca_security_analysis",
      status: "completed",
      timestamp: "2026-10-31T10:00:00.000Z",
      summary: "Analysis complete.",
      findings: [],
      evidence: [],
      recommendations: [],
      data: { reasoning: "RCA hypothesis." },
      error: null
    };
  };
  const analyzeIncident = createIncidentAnalysis({
    getRetriever: async () => ({
      retrieveKnowledgeWithScores: async (query, filters) => {
        retrievedQuery = query;
        assert.deepEqual(filters, { limit: 5 });
        return {
          results: [{
            incidentId: "HIST-001",
            affectedService: "payment-service",
            symptoms: ["connection timeout"],
            rootCause: "Database connection exhaustion",
            recommendedResolution: ["Inspect pool usage"]
          }],
          similarityScores: { "HIST-001": 0.82 },
          searchMode: "local-vector"
        };
      }
    }),
    analyze
  });
  const incident = {
    incident_id: "INC-101",
    service: "payment-service",
    logs: [{ id: "LOG-1", message: "Database connection timeout" }]
  };

  const response = await analyzeIncident(incident);

  assert.equal(response.incident_id, "INC-101");
  assert.equal(response.status, "completed");
  assert.match(retrievedQuery, /payment/);
  assert.equal(similarIncidents[0].incidentId, "HIST-001");
  assert.equal(similarIncidents[0].similarityScore, 0.82);
  assert.equal(similarIncidents[0].resolution, "Inspect pool usage");
});

test("reports missing Mongo knowledge while still returning the RCA/Security result", async () => {
  const analyzeIncident = createIncidentAnalysis({
    getRetriever() {
      throw new Error("private Mongo connection detail");
    },
    analyze: async (incident, similarIncidents) => {
      assert.deepEqual(similarIncidents, []);
      return {
        incident_id: incident.incident_id,
        component: "rca_security_analysis",
        status: "completed",
        timestamp: "2026-10-31T10:00:00.000Z",
        summary: "Analysis complete.",
        findings: [],
        evidence: [],
        recommendations: [],
        data: { reasoning: "RCA hypothesis." },
        error: null
      };
    }
  });

  const response = await analyzeIncident({ incident_id: "INC-102" });
  assert.equal(response.status, "completed");
  assert.match(response.summary, /knowledge retrieval was unavailable/i);
  assert.doesNotMatch(response.summary, /private Mongo connection detail/);
});

test("rejects malformed or unidentified incidents with the canonical error envelope", async () => {
  const analyzeIncident = createIncidentAnalysis({
    getRetriever: () => { throw new Error("must not retrieve"); }
  });
  for (const incident of [null, [], {}, { incident_id: " " }]) {
    const response = await analyzeIncident(incident);
    assert.equal(response.status, "failed");
    assert.equal(response.error.code, "VALIDATION_ERROR");
    assert.equal(response.error.details, null);
    assert.deepEqual(Object.keys(response), [
      "incident_id", "component", "status", "timestamp", "summary", "findings",
      "evidence", "recommendations", "data", "error"
    ]);
  }
});
