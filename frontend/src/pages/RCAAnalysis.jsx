import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Database, LoaderCircle, Search, Sparkles } from "lucide-react";
import EvidenceViewer from "../components/EvidenceViewer.jsx";

function display(value, fallback = "Not available") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function StatePanel({ kind, title, message }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? AlertCircle : Search;
  return (
    <div className={`state-panel state-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon className={kind === "loading" ? "spin" : ""} size={22} aria-hidden="true" />
      <div><strong>{title}</strong><p>{message}</p></div>
    </div>
  );
}

export default function RCAAnalysis({ incident = null, result = null, loading = false, error = null }) {
  if (loading) return <section className="analysis-card"><StatePanel kind="loading" title="Analyzing incident" message="Correlating source evidence and preparing RCA findings." /></section>;
  if (error || result?.status === "ERROR") {
    return <section className="analysis-card"><StatePanel kind="error" title="RCA analysis unavailable" message={error?.message ?? error ?? result?.warnings?.[0] ?? "The RCA agent could not analyze this incident."} /></section>;
  }
  if (!result) {
    return <section className="analysis-card"><StatePanel kind="empty" title="No investigation yet" message="RCA findings will appear here after the orchestrator submits an incident for analysis." /></section>;
  }

  const details = result.details ?? {};
  const degraded = result.status !== "COMPLETED";
  const incidentId = incident?.incidentId ?? incident?.id;
  const service = incident?.service ?? incident?.serviceName;
  const severity = incident?.severity;

  return (
    <section className="analysis-card">
      <div className="card-header">
        <div className="card-title-wrap">
          <span className="icon-tile rca-tile"><Database size={18} aria-hidden="true" /></span>
          <div><p className="eyebrow">ROOT CAUSE ANALYSIS</p><h2>Probable cause</h2></div>
        </div>
        <span className={`agent-status ${degraded ? "status-degraded" : "status-complete"}`}>
          {degraded ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {display(result.status, "UNKNOWN")}
        </span>
      </div>

      <div className="incident-context">
        <span><small>INCIDENT</small>{display(incidentId, "Unspecified")}</span>
        <span><small>SERVICE</small>{display(service, "Unspecified")}</span>
        <span><small>SEVERITY</small><span className={`severity-badge ${String(severity ?? "unknown").toLowerCase()}`}>{display(severity, "UNKNOWN")}</span></span>
      </div>

      {degraded && (
        <div className="degraded-notice" role="status">
          <AlertCircle size={16} aria-hidden="true" />
          <span>Partial analysis · {details.mode ?? "Fallback mode"} · verify findings before relying on them.</span>
        </div>
      )}

      <div className="cause-block">
        <div className="cause-label"><Sparkles size={15} aria-hidden="true" /> PROBABLE ROOT CAUSE</div>
        <h3>{display(details.probableRootCause, result.summary)}</h3>
        <p>{display(details.explanation, "No explanation was returned.")}</p>
      </div>

      <div className="support-card">
        <div className="support-header">
          <span>Evidence support</span>
          <strong>{Number.isFinite(details.evidenceSupportScore) ? `${details.evidenceSupportScore}/100` : "Not scored"}</strong>
        </div>
        <div className="support-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, Number(details.evidenceSupportScore) || 0))}%` }} /></div>
        <p>Explainable evidence-support score; not a calibrated probability of correctness.</p>
        {details.scoreFactors && (
          <ul className="score-factors">
            {Object.entries(details.scoreFactors).map(([name, value]) => (
              <li key={name}><span>{name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span><strong>{value}</strong></li>
            ))}
          </ul>
        )}
      </div>

      {Array.isArray(details.possibleTriggers) && details.possibleTriggers.length > 0 && (
        <div className="inline-notice"><Clock3 size={15} aria-hidden="true" /><span>{details.possibleTriggers.join(" ")}</span></div>
      )}

      <EvidenceViewer evidence={result.evidence} referencedIds={result.evidenceIds} relatedFinding={details.probableRootCause} />

      {Array.isArray(details.similarIncidents) && details.similarIncidents.length > 0 && (
        <section className="detail-section">
          <div className="section-heading"><div><p className="eyebrow">RETRIEVED CONTEXT</p><h3>Similar incidents</h3></div><ArrowUpRight size={17} className="muted-icon" /></div>
          <div className="similar-list">
            {details.similarIncidents.map((item, index) => (
              <article className="similar-card" key={item.incidentId ?? item.reference ?? index}>
                <div><strong>{display(item.incidentId, "Historical record")}</strong><span>{display(item.service, "Service not specified")}</span></div>
                <p>{display(item.validatedRootCause, "Validated cause not supplied")}</p>
                {Number.isFinite(item.similarityScore) && <small>Similarity {Math.round(item.similarityScore * 100)}% · Context only, not proof</small>}
                {item.relevanceNote && <small>{item.relevanceNote}</small>}
              </article>
            ))}
          </div>
        </section>
      )}

      {Array.isArray(details.validationSteps) && details.validationSteps.length > 0 && (
        <section className="detail-section">
          <div className="section-heading"><div><p className="eyebrow">NEXT CHECKS</p><h3>Validation steps</h3></div></div>
          <ol className="validation-list">{details.validationSteps.map((step, index) => <li key={`${step}-${index}`}><span>{index + 1}</span>{step}</li>)}</ol>
        </section>
      )}

      {(details.missingEvidence?.length > 0 || result.warnings?.length > 0 || result.unsupportedEvidenceIds?.length > 0) && (
        <div className="warning-list" role="status">
          <strong><AlertCircle size={15} /> Evidence gaps and warnings</strong>
          {[...(details.missingEvidence ?? []), ...(result.warnings ?? []),
            ...(result.unsupportedEvidenceIds ?? []).map((id) => `Unsupported evidence reference removed: ${id}`)]
            .map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
        </div>
      )}
    </section>
  );
}
