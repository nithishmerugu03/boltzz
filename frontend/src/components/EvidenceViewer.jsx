import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, FileSearch } from "lucide-react";

function severityClass(value) {
  const severity = String(value ?? "unknown").toLowerCase();
  return ["critical", "fatal", "error", "warn", "warning", "info", "debug"].includes(severity)
    ? `severity-${severity === "warning" ? "warn" : severity}`
    : "severity-unknown";
}

function evidenceMessage(item) {
  return item.content ?? item.message ?? item.raw?.message ?? item.description ?? item.event ?? "No message was provided for this evidence item.";
}

export default function EvidenceViewer({ evidence = [], referencedIds = [], relatedFinding = null }) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const available = Array.isArray(evidence) ? evidence.filter((item) => item && typeof item === "object") : [];
  const references = Array.isArray(referencedIds) ? [...new Set(referencedIds.filter(Boolean))] : [];
  const availableIds = new Set(available.map((item) => String(item.reference ?? item.id ?? item.evidenceId ?? "")).filter(Boolean));
  const unresolved = references.filter((id) => !availableIds.has(String(id)));

  function toggle(id) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="evidence-section" aria-label="Evidence viewer">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">SOURCE RECORDS</p>
          <h3>Evidence <span className="count-pill">{available.length}</span></h3>
        </div>
        <FileSearch size={18} className="muted-icon" aria-hidden="true" />
      </div>

      {relatedFinding && <p className="related-label">Related finding: {relatedFinding}</p>}

      {unresolved.length > 0 && (
        <div className="unresolved-notice" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>Evidence references could not be resolved</strong>
            <p>{unresolved.join(", ")}</p>
          </div>
        </div>
      )}

      {available.length === 0 && unresolved.length === 0 ? (
        <p className="empty-evidence">No evidence records were supplied for this analysis.</p>
      ) : (
        <div className="evidence-list">
          {available.map((item, index) => {
            const reference = item.reference ?? item.id ?? item.evidenceId;
            const id = String(reference ?? `unidentified-${index}`);
            const expandable = expandedIds.has(id);
            return (
              <article className="evidence-item" key={`${id}-${index}`}>
                <button
                  type="button"
                  className="evidence-toggle"
                  onClick={() => toggle(id)}
                  aria-expanded={expandable}
                  aria-label={`${expandable ? "Collapse" : "Expand"} evidence ${reference ?? "without an ID"}`}
                >
                  {expandable ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="evidence-id">{reference ?? "Unidentified source"}</span>
                  <span className={`severity-badge ${severityClass(item.severity)}`}>{item.severity ?? "UNKNOWN"}</span>
                </button>
                <p className="evidence-message">{evidenceMessage(item)}</p>
                <div className="evidence-meta">
                  <span>{item.type ?? item.source ?? "event"}</span>
                  <span>{item.service ?? "Service not specified"}</span>
                  <time>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "Timestamp unavailable"}</time>
                </div>
                {item.relevance && <p className="related-label">{item.relevance}</p>}
                {expandable && (
                  <pre className="evidence-raw">{JSON.stringify(item.raw ?? item, null, 2)}</pre>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
