import {
  evidenceObjectsForIds,
  normalizeIncidentEvidence,
  validateEvidenceReferences
} from "../utils/incidentEvidence.js";
import {
  createFinding,
  createModuleResponse,
  createRecommendation,
  toContractEvidence
} from "../utils/agentResponse.js";

const AUTH_PATTERN = /login|authenticat|credential|token|unauthorized|forbidden|(?:^|\D)401(?:\D|$)|(?:^|\D)403(?:\D|$)/i;
const FAILED_AUTH_PATTERN = /failed.{0,30}(?:login|auth)|(?:login|auth).{0,30}(?:failed|failure)|invalid credentials|authentication denied/i;

function configuredThreshold(name, fallback, minimum = 1) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function textFor(evidence) {
  return `${evidence.message} ${evidence.type} ${evidence.service ?? ""}`;
}

function ipFor(raw) {
  const value = raw.ip ?? raw.sourceIp ?? raw.clientIp ?? raw.remoteAddress ??
    raw.source?.ip ?? raw.request?.ip ?? raw.request?.remoteAddress;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountFor(raw) {
  const value = raw.username ?? raw.user ?? raw.userId ?? raw.account ?? raw.request?.username;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusCodeFor(raw) {
  const value = Number(raw.statusCode ?? raw.response?.statusCode ?? raw.response?.status);
  return Number.isInteger(value) ? value : null;
}

function evidenceWithinWindow(items, windowMs) {
  const result = [];
  for (const item of items) {
    if (!item.timestamp) continue;
    const time = Date.parse(item.timestamp);
    if (!Number.isFinite(time)) continue;
    result.push({ item, bucket: Math.floor(time / windowMs) });
  }
  return result;
}

function collectFindings(items) {
  const failedThreshold = configuredThreshold("SECURITY_FAILED_LOGIN_THRESHOLD", 5);
  const authSpikeThreshold = configuredThreshold("SECURITY_AUTH_SPIKE_THRESHOLD", 20);
  const windowMs = configuredThreshold("SECURITY_EVENT_WINDOW_MS", 5 * 60 * 1000, 60 * 1000);
  const windowLabel = windowMs % 60000 === 0
    ? `${windowMs / 60000}-minute window`
    : `${windowMs}-millisecond window`;
  const authEvidence = items.filter((item) => AUTH_PATTERN.test(textFor(item)) || [401, 403].includes(statusCodeFor(item.raw)));
  const failedAuth = authEvidence.filter((item) =>
    FAILED_AUTH_PATTERN.test(textFor(item)) || [401, 403].includes(statusCodeFor(item.raw)));
  const findings = [];

  const failedBySource = new Map();
  for (const item of failedAuth) {
    const ip = ipFor(item.raw);
    if (!ip) continue;
    const timeBucket = item.timestamp ? Math.floor(Date.parse(item.timestamp) / windowMs) : "undated";
    const key = `${ip}|${timeBucket}`;
    if (!failedBySource.has(key)) failedBySource.set(key, { ip, bucket: timeBucket, items: [] });
    failedBySource.get(key).items.push(item);
  }

  for (const { ip, bucket, items: sourceEvents } of failedBySource.values()) {
    if (sourceEvents.length < failedThreshold) continue;
    const uniqueAccounts = new Set(sourceEvents.map((item) => accountFor(item.raw)).filter(Boolean));
    const interval = bucket === "undated" ? "in the supplied events" : `within the configured ${windowLabel}`;
    findings.push({
      category: "REPEATED_AUTHENTICATION_FAILURES",
      riskLevel: "HIGH",
      title: "Repeated authentication failures from one source",
      explanation: `${sourceEvents.length} failed authentication-related events from the same source address were observed ${interval}. This may indicate brute-force activity but does not confirm malicious access.`,
      evidenceIds: sourceEvents.map((item) => item.id).filter(Boolean),
      recommendations: [
        "Review authentication logs grouped by source address and account.",
        "Check whether any authentication succeeded after the failures.",
        "Confirm whether the source and request rate are expected before taking action."
      ],
      sourceIp: ip,
      distinctAccountCount: uniqueAccounts.size
    });
  }

  if (failedAuth.length >= failedThreshold) {
    findings.push({
      category: "ELEVATED_UNAUTHORIZED_RESPONSES",
      riskLevel: failedAuth.length >= authSpikeThreshold ? "HIGH" : "MEDIUM",
      title: "Elevated authentication failure responses",
      explanation: `${failedAuth.length} authentication-related 401/403 or failed-login events were supplied. Response codes alone do not prove an attack.`,
      evidenceIds: failedAuth.map((item) => item.id).filter(Boolean),
      recommendations: [
        "Compare authentication failure rates with the normal baseline.",
        "Inspect affected accounts, request routes, and successful sign-ins in the same interval."
      ]
    });
  }

  const metricEvidence = items.filter((item) => {
    const raw = item.raw;
    const metricName = String(raw.metricName ?? raw.name ?? raw.type ?? "");
    const value = Number(raw.value ?? raw.current ?? raw.count);
    const baseline = Number(raw.baseline ?? raw.previous ?? raw.expected);
    return /request|traffic|auth|login|api/i.test(metricName) &&
      Number.isFinite(value) && Number.isFinite(baseline) && baseline > 0;
  });
  for (const item of metricEvidence) {
    const raw = item.raw;
    const value = Number(raw.value ?? raw.current ?? raw.count);
    const baseline = Number(raw.baseline ?? raw.previous ?? raw.expected);
    const ratio = value / baseline;
    if (value < authSpikeThreshold || ratio < 3) continue;
    findings.push({
      category: "UNUSUAL_API_REQUEST_SPIKE",
      riskLevel: ratio >= 5 ? "HIGH" : "MEDIUM",
      title: "Unusual request-volume spike",
      explanation: `The supplied ${raw.metricName ?? raw.name ?? "request"} metric is ${ratio.toFixed(1)} times its stated baseline. A spike is an anomaly requiring context, not proof of malicious activity.`,
      evidenceIds: item.id ? [item.id] : [],
      recommendations: [
        "Compare request volume by route, source, and authentication outcome against a representative baseline.",
        "Check for planned load tests, retries, or legitimate traffic changes."
      ],
      observedValue: value,
      baseline,
      ratio
    });
  }

  const trafficGroups = new Map();
  for (const { item, bucket } of evidenceWithinWindow(authEvidence, windowMs)) {
    const ip = ipFor(item.raw);
    if (!ip) continue;
    const key = `${ip}|${bucket}`;
    if (!trafficGroups.has(key)) trafficGroups.set(key, { ip, items: [] });
    trafficGroups.get(key).items.push(item);
  }
  for (const { ip, items: sourceEvents } of trafficGroups.values()) {
    if (sourceEvents.length < authSpikeThreshold || sourceEvents.every((item) => failedAuth.includes(item))) continue;
    findings.push({
      category: "AUTHENTICATION_TRAFFIC_SPIKE",
      riskLevel: "MEDIUM",
      title: "High authentication request volume from one source",
      explanation: `${sourceEvents.length} authentication-related events from one source were observed within the configured ${windowLabel}; expected traffic baselines were not provided.`,
      evidenceIds: sourceEvents.map((item) => item.id).filter(Boolean),
      recommendations: [
        "Compare this source's authentication request rate with the service's normal baseline.",
        "Review request outcomes and account distribution before treating the activity as malicious."
      ],
      sourceIp: ip
    });
  }

  const authDegradation = items.filter((item) =>
    AUTH_PATTERN.test(textFor(item)) &&
    /timeout|unavailable|connection refused|service degradation|degraded|5\d\d/i.test(textFor(item)));
  if (authDegradation.length) {
    findings.push({
      category: "AUTHENTICATION_SERVICE_DEGRADATION",
      riskLevel: "MEDIUM",
      title: "Authentication service degradation indicator",
      explanation: `${authDegradation.length} authentication-related timeout, availability, or server-error event(s) were supplied. This may indicate an operational issue and is not by itself evidence of an attack.`,
      evidenceIds: authDegradation.map((item) => item.id).filter(Boolean),
      recommendations: [
        "Check identity-provider and authentication-service health for the incident interval.",
        "Correlate authentication errors with dependency latency and service resource metrics."
      ]
    });
  }

  const seen = new Set();
  return findings.filter((finding) => {
    const signature = `${finding.category}|${finding.sourceIp ?? ""}|${finding.evidenceIds.join(",")}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export async function runSecurityAgent(incident) {
  try {
    const normalized = normalizeIncidentEvidence(incident);
    const findings = collectFindings(normalized.items).map((finding, index) => {
      const validated = validateEvidenceReferences(finding.evidenceIds, normalized.idSet);
      return {
        id: `SEC-FIND-${String(index + 1).padStart(3, "0")}`,
        ...finding,
        evidenceIds: validated.verified,
        unsupportedEvidenceIds: validated.unsupported,
        evidence: evidenceObjectsForIds(normalized.items, validated.verified)
      };
    });
    const threatDetected = findings.length > 0;
    const hasSecurityCoverage = normalized.items.some((item) =>
      AUTH_PATTERN.test(textFor(item)) ||
      [401, 403].includes(statusCodeFor(item.raw)) ||
      /request|traffic|auth|login/i.test(String(item.raw.metricName ?? item.raw.name ?? "")));
    const coverageComplete = normalized.items.length > 0 && hasSecurityCoverage;
    const riskLevel = findings.some((finding) => finding.riskLevel === "HIGH")
      ? "HIGH"
      : findings.some((finding) => finding.riskLevel === "MEDIUM")
        ? "MEDIUM"
        : coverageComplete ? "LOW" : "UNKNOWN";
    const summary = threatDetected
      ? `${findings.length} potential security finding(s) require investigation.`
      : !coverageComplete
        ? "Security analysis is incomplete because security-relevant evidence is missing."
        : "No suspicious indicator was detected in the supplied security-relevant events; this is not assurance that the service is secure.";
    const evidenceIds = [...new Set(findings.flatMap((finding) => finding.evidenceIds))];
    const contractFindings = findings.map((finding, index) => createFinding({
      id: `FIND-SEC-${String(index + 1).padStart(3, "0")}`,
      title: finding.title,
      description: [
        finding.explanation,
        finding.sourceIp ? `Source address observed in input: ${finding.sourceIp}.` : ""
      ].filter(Boolean).join(" "),
      severity: finding.riskLevel,
      confidence: null
    }));
    const contractEvidence = findings.flatMap((finding) => toContractEvidence(
      normalized.items,
      finding.evidenceIds,
      `Supports security finding: ${finding.title}.`
    ));
    const contractRecommendations = [...new Set(findings.flatMap((finding) => finding.recommendations))]
      .map((action, index) => createRecommendation({
        id: `REC-SEC-${String(index + 1).padStart(3, "0")}`,
        action,
        reason: "Investigate the cited security indicator before taking further action.",
        priority: riskLevel.toLowerCase() === "unknown" ? "low" : riskLevel.toLowerCase()
      }));
    const securityObservations = findings.map((finding) => finding.explanation);
    if (!coverageComplete) {
      securityObservations.push("Security-relevant evidence coverage is insufficient; no assurance about the absence of threats is implied.");
    }

    return createModuleResponse({
      incident,
      summary,
      findings: contractFindings,
      evidence: contractEvidence,
      recommendations: contractRecommendations,
      data: {
        security_analysis: {
          risk_detected: threatDetected,
          risk_level: riskLevel.toLowerCase(),
          threats: findings.map((finding) => finding.category),
          security_observations: securityObservations
        },
        reasoning: `Reviewed ${normalized.items.length} evidence item(s); ${normalized.items.filter((item) =>
          AUTH_PATTERN.test(textFor(item)) || [401, 403].includes(statusCodeFor(item.raw))).length} contained security-relevant authentication indicators.${normalized.warnings.length
          ? ` Input notes: ${normalized.warnings.join(" ")}`
          : ""}`
      }
    });
  } catch (error) {
    return createModuleResponse({
      incident,
      status: "failed",
      summary: "Security analysis could not process the incident.",
      data: {
        security_analysis: {
          risk_detected: false,
          risk_level: "unknown",
          threats: [],
          security_observations: []
        }
      },
      error: {
        code: "SECURITY_ANALYSIS_FAILED",
        message: "Security analysis could not process incident evidence.",
        details: error instanceof Error ? error.message : null
      }
    });
  }
}
