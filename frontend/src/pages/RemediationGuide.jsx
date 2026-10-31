import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, ClipboardCheck, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";

const demoIncident = {
  incident_id: "INC-101",
  incidentTitle: "Payment Service Failure",
  severity: "critical",
  rootCause: "Database connection pool exhaustion following deployment",
  evidence: [
    "10:00 AM: New payment service deployment",
    "10:02 AM: API latency spike",
    "10:03 AM: Database connection timeout",
    "10:04 AM: Payment failures reach 45%"
  ]
};

async function requestApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new Error(`Remediation API returned an unreadable response (${response.status}).`);
  }
  if (envelope?.component !== "remediation" || !["completed", "in_progress", "failed"].includes(envelope.status)) {
    throw new Error(`Remediation API returned an invalid response (${response.status}).`);
  }
  if (!response.ok || envelope.status === "failed") {
    throw new Error(envelope.error?.message ?? `Remediation request failed (${response.status}).`);
  }
  return envelope;
}

function MermaidFlow({ steps }) {
  const containerRef = useRef(null);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [renderError, setRenderError] = useState("");
  const source = useMemo(() => {
    if (!steps?.length) return "";
    const safeTitle = (value) => String(value ?? "Review step")
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48) || "Review step";
    const lines = ["flowchart TD", "start([Review incident evidence])"];
    let previous = "start";
    let approvalPending = false;
    steps.forEach((step, index) => {
      const current = `step${index + 1}`;
      lines.push(`${current}["${safeTitle(step.title)}"]`);
      lines.push(`${previous} -->${approvalPending ? "|Approved|" : ""} ${current}`);
      if (step.requiresApproval) {
        const approval = `approval${index + 1}`;
        lines.push(`${approval}{"Engineer approval required"}`);
        lines.push(`${current} --> ${approval}`);
        lines.push(`${approval} -->|Rejected| stop([Stop and record reason])`);
        previous = approval;
        approvalPending = true;
      } else {
        previous = current;
        approvalPending = false;
      }
    });
    lines.push("verify([Verify expected outcomes])");
    lines.push(`${previous} -->${approvalPending ? "|Approved|" : ""} verify`);
    return lines.join("\n");
  }, [steps]);

  useEffect(() => {
    let active = true;
    if (!source) {
      containerRef.current?.replaceChildren();
      setRenderError("");
      return () => { active = false; };
    }

    async function renderDiagram() {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        flowchart: { curve: "basis", htmlLabels: false }
      });
      const { svg } = await mermaid.render(`remediation-${reactId}`, source);
      if (!active || !containerRef.current) return;
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const graphic = parsed.documentElement;
      if (graphic.tagName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) {
        throw new Error("Diagram output was invalid.");
      }
      containerRef.current.replaceChildren(document.importNode(graphic, true));
      setRenderError("");
    }

    renderDiagram().catch(() => {
      if (!active) return;
      containerRef.current?.replaceChildren();
      setRenderError("The flowchart could not be rendered. The step list below remains available.");
    });

    return () => { active = false; };
  }, [reactId, source]);

  return (
    <section className="rem-panel">
      <div className="rem-section-heading">
        <div><p className="eyebrow">RECOVERY PATH</p><h2>Troubleshooting flow</h2></div>
        <span className="rem-muted">Based on the generated steps</span>
      </div>
      {renderError && <p className="rem-inline-error" role="status">{renderError}</p>}
      {steps.length
        ? <div className="rem-diagram" ref={containerRef} aria-label="Remediation workflow diagram" />
        : <p className="rem-muted">Generate a plan to view its workflow diagram.</p>}
    </section>
  );
}

export default function RemediationGuide({ incident = null, result = null }) {
  const incidentIdFromProps = incident?.incident_id ?? incident?.incidentId ?? incident?.id ?? result?.incident_id;
  const incidentId = incidentIdFromProps ?? demoIncident.incident_id;
  const probableCause = result?.data?.probable_root_cause ?? incident?.rootCause ?? demoIncident.rootCause;
  const evidenceFromResult = Array.isArray(result?.evidence)
    ? result.evidence.map((item) => item.content).filter(Boolean)
    : null;
  const [selectedIncidentId, setSelectedIncidentId] = useState(incidentId);
  const [rootCause, setRootCause] = useState(probableCause);
  const [evidenceText, setEvidenceText] = useState(
    (evidenceFromResult ?? incident?.evidence ?? demoIncident.evidence).join("\n")
  );
  const [plan, setPlan] = useState(null);
  const [reviewer, setReviewer] = useState("");
  const [reviewReasons, setReviewReasons] = useState({});
  const [expandedStep, setExpandedStep] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let active = true;
    requestApi("/api/health")
      .then((envelope) => { if (active) setHealth(envelope.data); })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, []);

  async function loadPlan(id = selectedIncidentId) {
    if (!id.trim()) {
      setError("Enter an incident ID before loading a plan.");
      return;
    }
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const envelope = await requestApi(`/api/remediation/${encodeURIComponent(id.trim())}`);
      setPlan(envelope.data?.plans?.[0] ?? null);
      setNotice(envelope.data?.plans?.length ? "Saved remediation plan loaded." : "No saved plan exists for this incident.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function generatePlan(event) {
    event.preventDefault();
    const evidence = evidenceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const envelope = await requestApi("/api/remediation/generate", {
        method: "POST",
        body: JSON.stringify({
          incident_id: selectedIncidentId.trim(),
          incident_title: incident?.incidentTitle ?? incident?.title ?? demoIncident.incidentTitle,
          severity: incident?.severity ?? demoIncident.severity,
          root_cause: rootCause.trim(),
          evidence,
          security_findings: result?.data?.security_analysis?.threats ?? []
        })
      });
      setPlan(envelope.data?.plan ?? null);
      setNotice(envelope.summary);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStep(step, status) {
    if (!plan?._id) return;
    setBusy(step._id);
    setError("");
    setNotice("");
    try {
      const envelope = await requestApi(
        `/api/remediation/${encodeURIComponent(plan._id)}/steps/${encodeURIComponent(step._id)}`,
        { method: "PATCH", body: JSON.stringify({ status }) }
      );
      setPlan(envelope.data?.plan ?? null);
      setNotice(status === "COMPLETED"
        ? "Engineer recorded this step as complete; no operational action was executed."
        : "Engineer review was recorded.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  async function reviewStep(step, decision) {
    if (!plan?._id) return;
    const reason = reviewReasons[step._id] ?? "";
    if (!reviewer.trim()) {
      setError("Enter the reviewing engineer's name before recording a decision.");
      return;
    }
    if (decision !== "APPROVE" && !reason.trim()) {
      setError("Provide a reason for rejection or requested changes.");
      return;
    }
    setBusy(step._id);
    setError("");
    setNotice("");
    try {
      const envelope = await requestApi(`/api/remediation/${encodeURIComponent(plan._id)}/review`, {
        method: "POST",
        body: JSON.stringify({ stepId: step._id, decision, reason: reason.trim(), reviewer: reviewer.trim() })
      });
      setPlan(envelope.data?.plan ?? null);
      setNotice(envelope.data?.approval_integration?.message ?? envelope.summary);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  async function validateRunbook() {
    if (!plan?._id) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const envelope = await requestApi(`/api/remediation/${encodeURIComponent(plan._id)}/validate`, {
        method: "POST",
        body: "{}"
      });
      setPlan(envelope.data?.plan ?? null);
      setNotice(envelope.summary);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  const steps = plan?.steps ?? [];
  const completedCount = steps.filter((step) => step.status === "COMPLETED").length;
  const progress = steps.length ? Math.round((completedCount / steps.length) * 100) : 0;
  const runbook = plan?.runbookValidation;

  return (
    <section className="remediation-section" aria-labelledby="remediation-heading">
      <div className="remediation-intro">
        <div>
          <p className="eyebrow">REMEDIATION &amp; ENGINEER REVIEW</p>
          <h2 id="remediation-heading">A guided path from diagnosis to recovery.</h2>
          <p>Review recommendations, check them against the available runbooks, and record engineer decisions. Nothing is executed by this module.</p>
        </div>
        <span className={`rem-health ${health?.database === "connected" ? "connected" : ""}`}>
          <span /> {health?.database === "connected" ? "Database connected" : health ? "Database unavailable" : "Checking service"}
        </span>
      </div>

      {error && <div className="rem-banner error" role="alert"><AlertCircle size={17} />{error}</div>}
      {notice && <div className="rem-banner success" role="status"><Check size={17} />{notice}</div>}
      {health?.database !== "connected" && (
        <div className="rem-banner info" role="status">
          <AlertCircle size={17} />
          <span>Local API is running, but persistence requires <code>MONGODB_URI</code>. Configure it in <code>backend/.env</code> to save and review plans.</span>
        </div>
      )}

      <div className="remediation-grid">
        <form className="rem-panel rem-plan-form" onSubmit={generatePlan}>
          <div className="rem-section-heading">
            <div><p className="eyebrow">PLAN INPUT</p><h2>Incident context</h2></div>
            <button type="button" className="rem-button secondary" onClick={() => loadPlan()} disabled={loading}>
              <RefreshCw size={15} /> Load saved plan
            </button>
          </div>
          <label>Incident ID
            <input value={selectedIncidentId} onChange={(event) => setSelectedIncidentId(event.target.value)} required maxLength={100} />
          </label>
          <label>Probable root cause
            <textarea value={rootCause} onChange={(event) => setRootCause(event.target.value)} required minLength={4} maxLength={2000} rows={2} />
          </label>
          <label>Evidence (one item per line)
            <textarea value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} maxLength={10000} rows={4} />
          </label>
          <button type="submit" className="rem-button primary" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <ClipboardCheck size={16} />}
            {loading ? "Working..." : "Generate review plan"}
          </button>
          <p className="rem-footnote">The sample incident is synthetic. Recommendations require human review and do not execute production changes.</p>
        </form>

        <div className="rem-plan-content">
          {plan ? (
            <>
              <section className="rem-panel">
                <div className="rem-section-heading">
                  <div><p className="eyebrow">PLAN STATUS</p><h2>{plan.incident?.title ?? "Remediation plan"}</h2></div>
                  <span className={`rem-status ${String(plan.overallStatus ?? "AWAITING_REVIEW").toLowerCase()}`}>
                    {String(plan.overallStatus ?? "AWAITING_REVIEW").replaceAll("_", " ")}
                  </span>
                </div>
                <p className="rem-root-cause">{plan.rootCause}</p>
                <div className="rem-progress-label"><span>{completedCount} of {steps.length} steps recorded complete</span><strong>{progress}%</strong></div>
                <div className="rem-progress"><span style={{ width: `${progress}%` }} /></div>
                <p className="rem-meta">Generation: {plan.generation?.fallbackUsed ? "Deterministic fallback" : `${plan.generation?.provider ?? "Unknown"} model`} · Approval mode: {plan.approvalIntegration?.mode ?? "Not specified"}</p>
              </section>

              {plan.safetyWarnings?.length > 0 && (
                <div className="rem-warning">
                  <ShieldAlert size={18} />
                  <div><strong>Safety and runbook notices</strong>{plan.safetyWarnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>
                </div>
              )}

              <MermaidFlow steps={steps} />

              <section className="rem-panel">
                <div className="rem-section-heading rem-step-heading">
                  <div><p className="eyebrow">ENGINEER REVIEW</p><h2>Recommended steps <span className="rem-count">{steps.length}</span></h2></div>
                  <button type="button" className="rem-button secondary" onClick={validateRunbook} disabled={loading}>
                    {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Validate runbooks
                  </button>
                </div>
                {runbook && (
                  <p className="rem-runbook-state">
                    Runbook check: <strong>{String(runbook.status).replaceAll("_", " ")}</strong> · {runbook.source}
                  </p>
                )}
                <label className="rem-reviewer">Reviewing engineer
                  <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={120} placeholder="Enter your name" />
                </label>
                <div className="rem-steps">
                  {steps.map((step) => {
                    const validation = runbook?.stepResults?.find((item) => item.stepNumber === step.stepNumber);
                    const isExpanded = expandedStep === step._id;
                    return (
                      <article key={step._id ?? step.stepNumber} className={`rem-step ${step.safetyStatus === "BLOCKED" ? "blocked" : ""}`}>
                        <button type="button" className="rem-step-summary" onClick={() => setExpandedStep(isExpanded ? "" : step._id)} aria-expanded={isExpanded}>
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span className="rem-step-number">{String(step.stepNumber).padStart(2, "0")}</span>
                          <span className="rem-step-title">{step.title}<small>{String(step.actionType).replaceAll("_", " ")}</small></span>
                          <span className={`rem-risk ${String(step.riskLevel).toLowerCase()}`}>{step.riskLevel} risk</span>
                          {validation && <span className={`rem-validation ${String(validation.status).toLowerCase()}`}>{String(validation.status).replaceAll("_", " ")}</span>}
                        </button>
                        {isExpanded && (
                          <div className="rem-step-detail">
                            <dl>
                              <div><dt>What to do</dt><dd>{step.description}</dd></div>
                              <div><dt>Why it matters</dt><dd>{step.reason}</dd></div>
                              <div><dt>Expected outcome</dt><dd>{step.expectedOutcome}</dd></div>
                              <div><dt>Prerequisites</dt><dd>{step.prerequisites?.length ? step.prerequisites.join(" · ") : "None specified"}</dd></div>
                            </dl>
                            {validation && <p className="rem-validation-reason">{validation.reason}</p>}
                            {step.requiresApproval && <p className="rem-approval-note">Engineer approval is required before this recommendation can be marked complete.</p>}
                            {step.requiresApproval && step.safetyStatus !== "BLOCKED" && (
                              <label>Reason (required for rejection or change request)
                                <textarea rows={2} maxLength={1000} value={reviewReasons[step._id] ?? ""} onChange={(event) => setReviewReasons((current) => ({ ...current, [step._id]: event.target.value }))} />
                              </label>
                            )}
                            <div className="rem-step-actions">
                              {step.status === "PENDING" && <button type="button" className="rem-button secondary" disabled={busy === step._id} onClick={() => updateStep(step, "REVIEWED")}>Mark reviewed</button>}
                              {step.requiresApproval && step.safetyStatus !== "BLOCKED" && step.review?.decision !== "APPROVE" && (
                                <>
                                  <button type="button" className="rem-button approve" disabled={busy === step._id} onClick={() => reviewStep(step, "APPROVE")}>Approve recommendation</button>
                                  <button type="button" className="rem-button reject" disabled={busy === step._id} onClick={() => reviewStep(step, "REJECT")}>Reject</button>
                                  <button type="button" className="rem-button secondary" disabled={busy === step._id} onClick={() => reviewStep(step, "REQUEST_CHANGES")}>Request changes</button>
                                </>
                              )}
                              {step.status !== "COMPLETED" && step.safetyStatus !== "BLOCKED" && (!step.requiresApproval || step.review?.decision === "APPROVE") && (
                                <button type="button" className="rem-button secondary" disabled={busy === step._id} onClick={() => updateStep(step, "COMPLETED")}>Mark complete</button>
                              )}
                              {step.safetyStatus === "BLOCKED" && <strong className="rem-blocked-label">Blocked by safety policy</strong>}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <section className="rem-panel rem-empty">
              <ClipboardCheck size={28} />
              <h2>No remediation plan loaded</h2>
              <p>Generate a review plan from the incident context. In a local setup, first configure MongoDB to enable plan persistence.</p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
