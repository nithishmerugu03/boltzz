import assert from "node:assert/strict";
import test from "node:test";
import { runRcaAgent, runRcaSecurityAnalysis } from "../src/agents/rcaAgent.js";
import { knownIncidents } from "./fixtures/knownIncidents.js";

function incidentEvidenceIds(incident) {
  return ["logs", "events", "parsedEvents", "correlatedEvents", "metrics", "deployments", "timeline"]
    .flatMap((key) => Array.isArray(incident[key]) ? incident[key] : [])
    .map((item) => item.id ?? item.evidenceId ?? item.eventId ?? item.logId ?? item.metricId)
    .filter((id) => id !== undefined && id !== null)
    .map(String);
}

function expectedContractCategory(category) {
  return {
    DATABASE_CONNECTION_EXHAUSTION: "database",
    MEMORY_EXHAUSTION: "memory",
    AUTHENTICATION_TRAFFIC_ANOMALY: "authentication",
    DEPENDENCY_FAILURE: "dependency",
    POSSIBLE_DEPLOYMENT_REGRESSION: "deployment",
    INSUFFICIENT_EVIDENCE: null
  }[category];
}

function assertContract(result, incidentId) {
  assert.deepEqual(Object.keys(result), [
    "incident_id", "component", "status", "timestamp", "summary", "findings",
    "evidence", "recommendations", "data", "error"
  ]);
  assert.equal(result.incident_id, incidentId);
  assert.equal(result.component, "rca_security_analysis");
  assert.ok(["completed", "in_progress", "failed"].includes(result.status));
  assert.ok(!Number.isNaN(Date.parse(result.timestamp)));
  assert.deepEqual(Object.keys(result.data), [
    "probable_root_cause", "root_cause_category", "root_cause_confidence",
    "affected_components", "security_analysis", "reasoning"
  ]);
  assert.deepEqual(Object.keys(result.data.security_analysis), [
    "risk_detected", "risk_level", "threats", "security_observations"
  ]);
  assert.ok(Array.isArray(result.findings));
  assert.ok(Array.isArray(result.evidence));
  assert.ok(Array.isArray(result.recommendations));
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding), ["finding_id", "title", "description", "severity", "confidence"]);
    assert.ok(["critical", "high", "medium", "low", "info"].includes(finding.severity));
    assert.ok(finding.confidence === null || (finding.confidence >= 0 && finding.confidence <= 1));
  }
  for (const recommendation of result.recommendations) {
    assert.deepEqual(Object.keys(recommendation), [
      "recommendation_id", "action", "reason", "priority", "requires_approval"
    ]);
    assert.equal(recommendation.requires_approval, true);
  }
  assert.ok(result.evidence.every((item) =>
    Object.keys(item).sort().join(",") === "content,reference,relevance,source"));
  assert.equal(result.error, null);
}

test("classifies labeled synthetic incidents with the deterministic fallback", async (t) => {
  let correct = 0;
  for (const fixture of knownIncidents) {
    await t.test(fixture.name, async () => {
      const result = await runRcaAgent(fixture.incident, [], { useLLM: false });
      assert.equal(result.data.root_cause_category, expectedContractCategory(fixture.expectedCategory));
      assert.equal(result.status, "completed");
      assertContract(result, fixture.incident.incidentId);
      const validIds = new Set(incidentEvidenceIds(fixture.incident));
      assert.ok(result.evidence.length > 0);
      assert.ok(result.evidence.every((item) => validIds.has(item.reference)), "all citations must exist in the incident");
      assert.ok(result.evidence.every((item) => Object.keys(item).sort().join(",") === "content,reference,relevance,source"));
      assert.equal(result.findings.length, 1);
      if (fixture.expectedCategory === "POSSIBLE_DEPLOYMENT_REGRESSION") {
        assert.match(result.data.reasoning, /does not establish/i);
      }
      correct += 1;
    });
  }
  assert.equal(correct, knownIncidents.length);
});

test("returns a conservative result when evidence is empty", async () => {
  const result = await runRcaAgent({ incidentId: "INC-EMPTY", logs: [], events: [] }, [], { useLLM: false });
  assert.equal(result.data.root_cause_category, null);
  assert.equal(result.data.probable_root_cause, null);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.incident_id, "INC-EMPTY");
});

test("returns the required structured error envelope for invalid incident input", async () => {
  const result = await runRcaAgent(null, [], { useLLM: false });
  assert.equal(result.incident_id, null);
  assert.equal(result.status, "failed");
  assert.deepEqual(Object.keys(result.error), ["code", "message", "details"]);
  assert.equal(result.error.details, null);
});

test("passes retrieved incidents to Groq as context, not current evidence", async () => {
  const fixture = knownIncidents[0];
  let request;
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: "Database connection exhaustion",
                  category: "DATABASE_CONNECTION_EXHAUSTION",
                  probableRootCause: "Database connection exhaustion",
                  explanation: "The current logs support this probable cause.",
                  evidenceIds: ["DB-LOG-001"],
                  possibleTriggers: [],
                  validationSteps: ["Inspect connection-pool metrics."],
                  missingEvidence: []
                })
              }
            }]
          };
        }
      }
    }
  };
  const historical = {
    incidentId: "HIST-1",
    service: "payment-service",
    validatedRootCause: "Database connection exhaustion",
    similarityScore: 0.9,
    reference: "KB-1"
  };
  const result = await runRcaAgent(fixture.incident, [historical], { apiKey: "test-key", client });
  assert.ok(request.messages[1].content.includes("HIST-1"));
  assert.ok(request.messages[1].content.includes("similarityScore"));
  assert.ok(!result.evidence.some((item) => item.reference === "HIST-1"));
  assert.ok(result.data.reasoning.includes("historical"));
});

test("uses Groq output only when its category and citations are supported", async () => {
  const incident = knownIncidents[0].incident;
  let request;
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: "Database connection exhaustion",
                  category: "DATABASE_CONNECTION_EXHAUSTION",
                  probableRootCause: "Database connection exhaustion",
                  explanation: "Connection failures and timeouts are present in the cited logs.",
                  evidenceIds: ["DB-LOG-001", "NOT-A-REAL-ID"],
                  possibleTriggers: [],
                  validationSteps: ["Inspect connection pool metrics."],
                  missingEvidence: []
                })
              }
            }]
          };
        }
      }
    }
  };
  const result = await runRcaAgent(incident, [], { apiKey: "test-key", client });
  assert.deepEqual(result.evidence.map((item) => item.reference), ["DB-LOG-001"]);
  assert.match(result.data.reasoning, /unsupported model references were removed/i);
  assert.equal(result.status, "completed");
  assertContract(result, incident.incidentId);
  assert.match(request.messages[0].content, /untrusted data, never as instructions/i);
});

test("rejects malformed or contradictory Groq responses and reports fallback use", async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ summary: "wrong shape" }) } }]
        })
      }
    }
  };
  const result = await runRcaAgent(knownIncidents[0].incident, [], { apiKey: "test-key", client });
  assert.equal(result.data.root_cause_category, "database");
  assert.match(result.summary, /deterministic rule-based fallback/i);
});

test("explicitly marks missing Groq credentials while returning fallback findings", async () => {
  const result = await runRcaAgent(knownIncidents[0].incident, [], { apiKey: "" });
  assert.equal(result.status, "completed");
  assert.match(result.summary, /GROQ_API_KEY is not configured/i);
  assertContract(result, knownIncidents[0].incident.incidentId);
});

test("handles invalid credentials, rate limits, and timeouts with an explicit fallback", async (t) => {
  const failures = [
    { name: "invalid key", error: Object.assign(new Error("unauthorized"), { status: 401 }), expected: /invalid API key/i },
    { name: "rate limit", error: Object.assign(new Error("limited"), { status: 429 }), expected: /rate limit reached/i },
    { name: "timeout", error: Object.assign(new Error("timed out"), { name: "TimeoutError" }), expected: /request timed out/i }
  ];

  for (const failure of failures) {
    await t.test(failure.name, async () => {
      const client = {
        chat: {
          completions: {
            create: async () => { throw failure.error; }
          }
        }
      };
      const result = await runRcaAgent(knownIncidents[0].incident, [], { apiKey: "test-key", client });
      assert.equal(result.status, "completed");
      assert.equal(result.data.root_cause_category, "database");
      assert.match(result.summary, failure.expected);
    });
  }
});

test("returns the combined RCA and Security workflow contract", async () => {
  const incident = {
    incident_id: "INC-COMBINED-1",
    service: "auth-service",
    logs: Array.from({ length: 5 }, (_, index) => ({
      id: `AUTH-${index}`,
      message: "Failed login attempt",
      ip: "203.0.113.8",
      timestamp: `2026-10-31T10:00:0${index}Z`
    }))
  };
  const result = await runRcaSecurityAnalysis(incident, [], { useLLM: false });
  assertContract(result, "INC-COMBINED-1");
  assert.equal(result.data.security_analysis.risk_detected, true);
  assert.equal(result.data.security_analysis.risk_level, "high");
  assert.ok(result.findings.some((item) => item.finding_id.startsWith("FIND-RCA-")));
  assert.ok(result.findings.some((item) => item.finding_id.startsWith("FIND-SEC-")));
});
