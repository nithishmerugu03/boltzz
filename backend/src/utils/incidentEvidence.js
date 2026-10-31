const EVIDENCE_SOURCES = [
  ["logs", "log"],
  ["events", "event"],
  ["parsedEvents", "event"],
  ["correlatedEvents", "event"],
  ["metrics", "metric"],
  ["deployments", "deployment"],
  ["timeline", "event"]
];

const SEVERITIES = new Set(["TRACE", "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL", "CRITICAL"]);
const MAX_EVIDENCE_ITEMS = 500;

function asString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function evidenceId(item) {
  const value = item.id ?? item.evidenceId ?? item.eventId ?? item.logId ?? item.metricId;
  return value === undefined || value === null || value === "" ? null : String(value);
}

function timestampValue(item) {
  const value = item.timestamp ?? item.time ?? item.createdAt ?? item.occurredAt;
  if (value === undefined || value === null || value === "") return { timestamp: null, invalid: false };
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? { timestamp: null, invalid: true }
    : { timestamp: date.toISOString(), invalid: false };
}

function messageValue(item) {
  const parts = [
    item.message,
    item.msg,
    item.description,
    item.error,
    item.event,
    item.name,
    item.metricName,
    item.type,
    item.status,
    item.statusCode,
    item.code
  ].filter((part) => part !== undefined && part !== null && part !== "");

  return parts.map(asString).filter(Boolean).join(" | ").slice(0, 4000);
}

export function normalizeIncidentEvidence(incident) {
  if (!incident || typeof incident !== "object" || Array.isArray(incident)) {
    throw new TypeError("Incident must be an object.");
  }

  const items = [];
  const warnings = [];
  const seenIds = new Set();
  let unidentifiedCount = 0;
  let truncatedCount = 0;

  for (const [field, source] of EVIDENCE_SOURCES) {
    const collection = incident[field];
    if (collection === undefined || collection === null) continue;
    if (!Array.isArray(collection)) {
      warnings.push(`Ignored ${field}: expected an array.`);
      continue;
    }

    collection.forEach((value, index) => {
      if (items.length >= MAX_EVIDENCE_ITEMS) {
        truncatedCount += 1;
        return;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        warnings.push(`Ignored ${field}[${index}]: evidence must be an object.`);
        return;
      }

      const id = evidenceId(value);
      if (id && seenIds.has(id)) {
        warnings.push(`Duplicate evidence ID "${id}" was ignored after its first occurrence.`);
        return;
      }
      if (id) seenIds.add(id);

      const { timestamp, invalid } = timestampValue(value);
      if (invalid) warnings.push(`Evidence ${id ?? `${field}[${index}]`} has an invalid timestamp.`);
      if (!id) unidentifiedCount += 1;

      const rawSeverity = asString(value.severity ?? value.level).toUpperCase();
      const severity = SEVERITIES.has(rawSeverity) ? (rawSeverity === "WARNING" ? "WARN" : rawSeverity) : null;
      const type = asString(value.type ?? value.eventType ?? value.kind).toLowerCase() || source;
      const message = messageValue(value);
      const service = asString(value.service ?? value.serviceName ?? incident.service);

      items.push({
        id,
        source,
        type,
        timestamp,
        service: service || null,
        severity,
        message,
        raw: value
      });
    });
  }

  if (unidentifiedCount) {
    warnings.push(`${unidentifiedCount} evidence item(s) have no source ID and cannot be cited by an agent.`);
  }
  if (truncatedCount) warnings.push(`Ignored ${truncatedCount} evidence item(s) after the ${MAX_EVIDENCE_ITEMS}-item limit.`);
  if (items.length === 0) warnings.push("No usable incident evidence was supplied.");

  return {
    items,
    warnings,
    idSet: new Set(items.map((item) => item.id).filter(Boolean))
  };
}

export function validateEvidenceReferences(references, idSet) {
  const requested = Array.isArray(references) ? references : [];
  const verified = [];
  const unsupported = [];
  const seen = new Set();

  for (const value of requested) {
    if (typeof value !== "string" || !idSet.has(value)) {
      unsupported.push(value);
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      verified.push(value);
    }
  }

  return { verified, unsupported };
}

export function evidenceObjectsForIds(items, ids) {
  const wanted = new Set(ids);
  return items.filter((item) => item.id && wanted.has(item.id)).map((item) => ({
    id: item.id,
    source: item.source,
    type: item.type,
    timestamp: item.timestamp,
    service: item.service,
    severity: item.severity,
    message: item.message
  }));
}
