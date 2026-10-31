import { knownIncidents } from "../tests/fixtures/knownIncidents.js";
import { runRcaAgent } from "../src/agents/rcaAgent.js";

function sourceIds(incident) {
  return new Set(
    ["logs", "events", "parsedEvents", "correlatedEvents", "metrics", "deployments", "timeline"]
      .flatMap((key) => Array.isArray(incident[key]) ? incident[key] : [])
      .map((item) => item.id ?? item.evidenceId ?? item.eventId ?? item.logId ?? item.metricId)
      .filter((id) => id !== undefined && id !== null)
      .map(String)
  );
}

async function evaluate({ live = false } = {}) {
  let deterministicCorrect = 0;
  let citationFailures = 0;
  let errors = 0;
  const cases = [];

  for (const fixture of knownIncidents) {
    const result = await runRcaAgent(fixture.incident, [], { useLLM: false });
    const correct = result.details.category === fixture.expectedCategory;
    if (correct) deterministicCorrect += 1;
    if (result.status === "ERROR") errors += 1;
    const ids = sourceIds(fixture.incident);
    const unsupported = result.evidenceIds.filter((id) => !ids.has(id));
    if (unsupported.length) citationFailures += unsupported.length;
    cases.push({
      name: fixture.name,
      expected: fixture.expectedCategory,
      predicted: result.details.category,
      correct,
      unsupportedEvidenceIds: unsupported
    });
  }

  const deterministicAccuracy = knownIncidents.length
    ? deterministicCorrect / knownIncidents.length * 100
    : 0;
  console.log("Deterministic local RCA evaluation (not LLM accuracy)");
  for (const item of cases) {
    console.log(`${item.correct ? "PASS" : "FAIL"} ${item.name}: expected=${item.expected}, predicted=${item.predicted}, unsupportedRefs=${item.unsupportedEvidenceIds.length}`);
  }
  console.log(`Classification accuracy: ${deterministicCorrect}/${knownIncidents.length} (${deterministicAccuracy.toFixed(1)}%)`);
  console.log(`Unsupported evidence references: ${citationFailures}`);
  console.log(`Agent errors: ${errors}`);
  console.log("LLM RCA accuracy: not measured by this deterministic run.");

  if (!live) return;
  if (!process.env.GROQ_API_KEY) {
    console.log("Live Groq evaluation: skipped (GROQ_API_KEY is not configured; no API calls were made).");
    return;
  }

  let modelAccepted = 0;
  let modelCorrect = 0;
  let degraded = 0;
  for (const fixture of knownIncidents) {
    const result = await runRcaAgent(fixture.incident);
    if (result.details.mode === "GROQ" || result.details.mode === "GROQ_VALIDATED_WITH_WARNINGS") {
      modelAccepted += 1;
      if (result.details.category === fixture.expectedCategory) modelCorrect += 1;
    } else {
      degraded += 1;
    }
  }

  console.log(`Live Groq requests attempted: ${knownIncidents.length}`);
  console.log(`Accepted Groq analyses: ${modelAccepted}`);
  console.log(`Degraded/fallback results: ${degraded}`);
  if (modelAccepted) {
    console.log(`Accepted Groq classification accuracy: ${modelCorrect}/${modelAccepted} (${(modelCorrect / modelAccepted * 100).toFixed(1)}%)`);
  } else {
    console.log("Accepted Groq classification accuracy: not measurable (no model analysis passed validation).");
  }
}

const live = process.argv.includes("--live");
evaluate({ live }).catch((error) => {
  console.error("RCA evaluation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
