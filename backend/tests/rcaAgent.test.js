import assert from "node:assert/strict";
import test from "node:test";
import { runRcaAgent } from "../src/agents/rcaAgent.js";
import { knownIncidents } from "./fixtures/knownIncidents.js";

function incidentEvidenceIds(incident) {
  return ["logs", "events", "parsedEvents", "correlatedEvents", "metrics", "deployments", "timeline"]
    .flatMap((key) => Array.isArray(incident[key]) ? incident[key] : [])
    .map((item) => item.id ?? item.evidenceId ?? item.eventId ?? item.logId ?? item.metricId)
    .filter((id) => id !== undefined && id !== null)
    .map(String);
}

test("classifies labeled synthetic incidents with the deterministic fallback", async (t) => {
  let correct = 0;
  for (const fixture of knownIncidents) {
    await t.test(fixture.name, async () => {
      const result = await runRcaAgent(fixture.incident, [], { useLLM: false });
      assert.equal(result.details.category, fixture.expectedCategory);
      assert.equal(result.details.mode, "RULE_BASED_FALLBACK");
      assert.ok(result.details.evidenceSupportScore >= 0 && result.details.evidenceSupportScore <= 100);
      const validIds = new Set(incidentEvidenceIds(fixture.incident));
      assert.ok(result.evidenceIds.length > 0);
      assert.ok(result.evidenceIds.every((id) => validIds.has(id)), "all citations must exist in the incident");
      assert.deepEqual(result.evidence.map((item) => item.id), result.evidenceIds);
      if (result.details.category === "POSSIBLE_DEPLOYMENT_REGRESSION") {
        assert.match(result.details.explanation, /does not establish/i);
      }
      correct += 1;
    });
  }
  assert.equal(correct, knownIncidents.length);
});

test("returns a conservative result when evidence is empty", async () => {
  const result = await runRcaAgent({ incidentId: "INC-EMPTY", logs: [], events: [] }, [], { useLLM: false });
  assert.equal(result.details.category, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.details.evidenceSupportScore, 0);
  assert.equal(result.evidence.length, 0);
  assert.ok(result.details.missingEvidence.length > 0);
});

test("uses retrieved incidents as context without treating them as current evidence", async () => {
  const fixture = knownIncidents[0];
  const result = await runRcaAgent(fixture.incident, [{
    incidentId: "HIST-1",
    service: "payment-service",
    validatedRootCause: "Database connection exhaustion",
    similarityScore: 0.9,
    reference: "KB-1"
  }], { useLLM: false });
  assert.equal(result.details.similarIncidents[0].incidentId, "HIST-1");
  assert.ok(result.details.similarIncidents[0].relevanceNote.includes("not proof"));
  assert.ok(!result.evidenceIds.includes("HIST-1"));
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
  assert.deepEqual(result.evidenceIds, ["DB-LOG-001"]);
  assert.deepEqual(result.unsupportedEvidenceIds, ["NOT-A-REAL-ID"]);
  assert.equal(result.details.mode, "GROQ_VALIDATED_WITH_WARNINGS");
  assert.equal(result.status, "DEGRADED");
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
  assert.equal(result.details.category, "DATABASE_CONNECTION_EXHAUSTION");
  assert.equal(result.details.mode, "RULE_BASED_FALLBACK");
  assert.ok(result.warnings.some((warning) => /did not match the RCA response contract/i.test(warning)));
});

test("explicitly marks missing Groq credentials while returning fallback findings", async () => {
  const result = await runRcaAgent(knownIncidents[0].incident, [], { apiKey: "" });
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.details.mode, "RULE_BASED_FALLBACK");
  assert.ok(result.warnings.some((warning) => /GROQ_API_KEY is not configured/i.test(warning)));
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
      assert.equal(result.details.mode, "RULE_BASED_FALLBACK");
      assert.equal(result.details.category, "DATABASE_CONNECTION_EXHAUSTION");
      assert.ok(result.warnings.some((warning) => failure.expected.test(warning)));
    });
  }
});
