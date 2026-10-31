export const COMPONENT_IDENTIFIER = "rca_security_analysis";

export function incidentIdOf(incident) {
  return incident?.incident_id ?? incident?.incidentId ?? incident?.id ?? null;
}

function normalizedSeverity(value) {
  const severity = String(value ?? "info").toLowerCase();
  if (severity === "fatal") return "critical";
  if (["critical", "high", "medium", "low", "info"].includes(severity)) return severity;
  return "info";
}

export function createFinding({ id, title, description, severity, confidence = null }) {
  return {
    finding_id: id,
    title,
    description,
    severity: normalizedSeverity(severity),
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null
  };
}

export function createRecommendation({ id, action, reason, priority = "medium" }) {
  const priorityValue = normalizedSeverity(priority);
  return {
    recommendation_id: id,
    action,
    reason,
    priority: ["high", "medium", "low"].includes(priorityValue) ? priorityValue : "medium",
    requires_approval: true
  };
}

export function toContractEvidence(items, ids, relevance = "Source evidence supplied for this incident analysis.") {
  const wanted = new Set(ids);
  return items.filter((item) => item.id && wanted.has(item.id)).map((item) => ({
    source: typeof item.raw.source === "string" && item.raw.source
      ? item.raw.source
      : item.source,
    reference: item.id,
    content: item.message,
    relevance
  }));
}

export function createModuleResponse({
  incident,
  status = "completed",
  summary,
  findings = [],
  evidence = [],
  recommendations = [],
  data = {},
  error = null
}) {
  const evidenceByKey = new Map();
  for (const item of evidence) {
    const key = `${item.source}|${item.reference}`;
    const existing = evidenceByKey.get(key);
    if (existing && existing.relevance !== item.relevance) {
      existing.relevance = `${existing.relevance} ${item.relevance}`;
    } else if (!existing) {
      evidenceByKey.set(key, {
        source: item.source,
        reference: item.reference,
        content: item.content,
        relevance: item.relevance
      });
    }
  }

  return {
    incident_id: incidentIdOf(incident),
    component: COMPONENT_IDENTIFIER,
    status,
    timestamp: new Date().toISOString(),
    summary,
    findings,
    evidence: [...evidenceByKey.values()],
    recommendations,
    data: {
      probable_root_cause: null,
      root_cause_category: null,
      root_cause_confidence: null,
      affected_components: [],
      security_analysis: {
        risk_detected: false,
        risk_level: "unknown",
        threats: [],
        security_observations: []
      },
      reasoning: "",
      ...data
    },
    error: error
      ? { code: error.code, message: error.message, details: null }
      : null
  };
}

export function mergeModuleResponses(incident, rca, security) {
  const evidenceByKey = new Map();
  for (const item of [...rca.evidence, ...security.evidence]) {
    const key = `${item.source}|${item.reference}`;
    const existing = evidenceByKey.get(key);
    if (existing && existing.relevance !== item.relevance) {
      existing.relevance = `${existing.relevance} ${item.relevance}`;
    } else if (!existing) {
      evidenceByKey.set(key, { ...item });
    }
  }

  const errors = [rca.error, security.error].filter(Boolean);
  return createModuleResponse({
    incident,
    status: errors.length ? "failed" : "completed",
    summary: errors.length
      ? "RCA and Security analysis failed for one or more sub-analyses."
      : `${rca.summary} ${security.summary}`.trim(),
    findings: [...rca.findings, ...security.findings],
    evidence: [...evidenceByKey.values()],
    recommendations: [...rca.recommendations, ...security.recommendations],
    data: {
      ...rca.data,
      security_analysis: security.data.security_analysis,
      reasoning: [rca.data.reasoning, security.data.reasoning].filter(Boolean).join(" ")
    },
    error: errors.length
      ? {
          code: "AGENT_ANALYSIS_FAILED",
          message: "One or more RCA/Security analyses could not be completed.",
          details: null
        }
      : null
  });
}
