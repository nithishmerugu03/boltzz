import { AlertCircle, CheckCircle2, Fingerprint, LoaderCircle, ShieldAlert } from "lucide-react";
import EvidenceViewer from "../components/EvidenceViewer.jsx";

const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, UNKNOWN: 3 };

function StatePanel({ kind, title, message }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? AlertCircle : ShieldAlert;
  return (
    <div className={`state-panel state-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon className={kind === "loading" ? "spin" : ""} size={22} aria-hidden="true" />
      <div><strong>{title}</strong><p>{message}</p></div>
    </div>
  );
}

export default function SecurityFindings({ result = null, loading = false, error = null }) {
  if (loading) return <section className="analysis-card"><StatePanel kind="loading" title="Reviewing security signals" message="Checking supplied events for authentication and traffic anomalies." /></section>;
  if (error || result?.status === "ERROR") {
    return <section className="analysis-card"><StatePanel kind="error" title="Security analysis unavailable" message={error?.message ?? error ?? result?.warnings?.[0] ?? "The Security Agent could not analyze this incident."} /></section>;
  }
  if (!result) {
    return <section className="analysis-card"><StatePanel kind="empty" title="No security analysis yet" message="Security findings will appear here when the orchestrator submits investigation results." /></section>;
  }

  const details = result.details ?? {};
  const degraded = result.status !== "COMPLETED";
  const findings = [...(details.findings ?? [])].sort((a, b) =>
    (riskOrder[a.riskLevel] ?? 4) - (riskOrder[b.riskLevel] ?? 4));
  const evidence = result.evidence ?? [];

  return (
    <section className="analysis-card">
      <div className="card-header">
        <div className="card-title-wrap">
          <span className="icon-tile security-tile"><Fingerprint size={18} aria-hidden="true" /></span>
          <div><p className="eyebrow">SECURITY ANALYSIS</p><h2>Risk signals</h2></div>
        </div>
        <span className={`agent-status ${degraded ? "status-degraded" : "status-complete"}`}>
          {degraded ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {result.status ?? "UNKNOWN"}
        </span>
      </div>

      {degraded && <div className="degraded-notice" role="status"><AlertCircle size={16} /><span>Partial coverage · missing security-relevant evidence prevents a complete assessment.</span></div>}

      <div className="security-summary">
        <span className={`risk-indicator risk-${String(details.riskLevel ?? "UNKNOWN").toLowerCase()}`}><ShieldAlert size={18} /> {details.riskLevel ?? "UNKNOWN"} RISK</span>
        <span className="threat-count">{details.suspiciousEventCount ?? 0} linked event{details.suspiciousEventCount === 1 ? "" : "s"}</span>
      </div>
      <p className="security-summary-copy">{result.summary}</p>
      <p className="coverage-note">
        {details.threatDetected
          ? `Potential finding: ${(details.threatType ?? "security anomaly").replaceAll("_", " ").toLowerCase()}. Investigate before drawing conclusions.`
          : "No suspicious indicator detected in supplied events is not a guarantee of security."}
      </p>

      {findings.length > 0 ? (
        <div className="finding-list">
          {findings.map((finding) => (
            <article className="finding-card" key={finding.id}>
              <div className="finding-title-row">
                <div><span className={`risk-dot risk-${String(finding.riskLevel).toLowerCase()}`} /><h3>{finding.title}</h3></div>
                <span className={`risk-label risk-${String(finding.riskLevel).toLowerCase()}`}>{finding.riskLevel}</span>
              </div>
              <p>{finding.explanation}</p>
              {finding.distinctAccountCount > 0 && <small>{finding.distinctAccountCount} distinct account(s) observed from this source.</small>}
              <EvidenceViewer
                evidence={finding.evidence ?? evidence}
                referencedIds={finding.evidenceIds}
                relatedFinding={finding.category?.replaceAll("_", " ")}
              />
              {finding.recommendations?.length > 0 && (
                <ul className="recommendation-list">{finding.recommendations.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ul>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className={`no-findings ${degraded ? "no-findings-incomplete" : ""}`}>
          <ShieldAlert size={20} aria-hidden="true" />
          <p>{degraded ? "Insufficient security-relevant evidence to assess suspicious activity." : "No suspicious indicators were found in the supplied security events. This does not establish that the service is secure."}</p>
        </div>
      )}

      {findings.length === 0 && evidence.length > 0 && (
        <EvidenceViewer evidence={evidence} referencedIds={result.evidenceIds} />
      )}

      {result.warnings?.length > 0 && (
        <div className="warning-list" role="status">
          {result.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
        </div>
      )}
    </section>
  );
}
