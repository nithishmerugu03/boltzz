import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceObjectsForIds,
  normalizeIncidentEvidence,
  validateEvidenceReferences
} from "../src/utils/incidentEvidence.js";

test("normalizes timestamps, severities, unknown types, duplicate IDs, and missing IDs", () => {
  const normalized = normalizeIncidentEvidence({
    service: "api",
    logs: [
      { id: "L-1", message: "First", level: "warning", timestamp: "2026-10-31T10:00:00Z" },
      { id: "L-1", message: "Duplicate" },
      { message: "Unidentified evidence", timestamp: "not-a-date" },
      { id: "E-1", type: "unrecognized-event", message: "Unknown type", timestamp: "2026-10-31T10:01:00Z" }
    ]
  });
  assert.equal(normalized.items.length, 3);
  assert.equal(normalized.items[0].severity, "WARN");
  assert.equal(normalized.items[0].timestamp, "2026-10-31T10:00:00.000Z");
  assert.equal(normalized.items[2].type, "unrecognized-event");
  assert.ok(normalized.items[1].timestamp === null);
  assert.ok(normalized.warnings.some((warning) => /Duplicate evidence ID/i.test(warning)));
  assert.ok(normalized.warnings.some((warning) => /invalid timestamp/i.test(warning)));
  assert.ok(normalized.warnings.some((warning) => /no source ID/i.test(warning)));
});

test("drops unsupported evidence citations and returns source objects for verified IDs", () => {
  const normalized = normalizeIncidentEvidence({
    events: [{ id: "EV-1", message: "Observed timeout", timestamp: "2026-10-31T10:00:00Z" }]
  });
  const references = validateEvidenceReferences(["EV-1", "FABRICATED", "EV-1"], normalized.idSet);
  assert.deepEqual(references.verified, ["EV-1"]);
  assert.deepEqual(references.unsupported, ["FABRICATED"]);
  assert.deepEqual(evidenceObjectsForIds(normalized.items, references.verified).map((item) => item.id), ["EV-1"]);
});

test("rejects non-object incidents rather than fabricating evidence", () => {
  assert.throws(() => normalizeIncidentEvidence(null), /Incident must be an object/);
});
