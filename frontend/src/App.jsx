import { useCallback, useEffect, useMemo, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', flowchart: { curve: 'basis', htmlLabels: false } });
const demo = { incidentId: 'INC-101', severity: 'CRITICAL', incidentTitle: 'Payment Service Failure', rootCause: 'Database connection pool exhaustion following deployment', evidence: ['10:00 AM: New payment service deployment', '10:02 AM: API latency spike', '10:03 AM: Database connection timeout', '10:04 AM: Payment failures reach 45%'], securityFindings: [], rcaReference: 'RCA-INC-101' };
const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const envelope = await res.json().catch(() => null);
  if (!envelope || !['completed', 'in_progress', 'failed'].includes(envelope.status) || envelope.component !== 'remediation') throw new Error(`Remediation service returned an invalid response (${res.status}).`);
  if (!res.ok || envelope.status === 'failed') throw new Error(envelope.error?.message || `Request failed (${res.status})`);
  return envelope.data;
};
const safeLabel = (s) => String(s).replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 42) || 'Recovery step';

function Flowchart({ steps }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const source = useMemo(() => {
    if (!steps?.length) return '';
    const lines = ['flowchart TD', 'start([Review incident evidence])'];
    let prev = 'start';
    steps.forEach((step, i) => {
      const id = `s${i + 1}`;
      lines.push(`${id}["${safeLabel(step.title)}"]`);
      lines.push(`${prev} --> ${id}`);
      if (step.requiresApproval) {
        const gate = `g${i + 1}`;
        lines.push(`${gate}{"Engineer approval required"}`);
        lines.push(`${id} --> ${gate}`);
        lines.push(`${gate} -->|Approved| ${i < steps.length - 1 ? `s${i + 2}` : 'verify'}`);
        lines.push(`${gate} -->|Rejected| stop([Stop and record reason])`);
        prev = `g${i + 1}`;
      } else prev = id;
    });
    lines.push('verify([Verify expected outcomes])');
    if (!steps.some((s) => s.requiresApproval)) lines.push(`${prev} --> verify`);
    return lines.join('\n');
  }, [steps]);
  useEffect(() => {
    let active = true;
    if (!source) { setSvg(''); return; }
    mermaid.render(`remediation-${Date.now()}`, source).then(({ svg: rendered }) => { if (active) { setSvg(rendered); setError(''); } }).catch(() => { if (active) { setSvg(''); setError('The flowchart could not be rendered. The step list remains available below.'); } });
    return () => { active = false; };
  }, [source]);
  return <section className="panel flow-panel"><div className="section-head"><div><p className="eyebrow">RECOVERY PATH</p><h2>Troubleshooting flow</h2></div><span className="subtle">Generated from structured steps</span></div>{error ? <p className="inline-error">{error}</p> : <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />}</section>;
}

export default function App() {
  const [incidentId, setIncidentId] = useState(demo.incidentId);
  const [plan, setPlan] = useState(null);
  const [expanded, setExpanded] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [busyStep, setBusyStep] = useState('');

  const refresh = useCallback(async (id = incidentId) => {
    setError(''); setLoading(true);
    try { const data = await api(`/api/remediation/${encodeURIComponent(id)}`); setPlan(data.plans?.[0] || null); }
    catch (e) { setPlan(null); setError(e.message); }
    finally { setLoading(false); }
  }, [incidentId]);
  useEffect(() => { refresh(demo.incidentId); }, []);

  async function generate() {
    setError(''); setNotice(''); setLoading(true);
    try {
      const data = await api('/api/remediation/generate', { method: 'POST', body: JSON.stringify({ ...demo, incidentId: incidentId.trim() || demo.incidentId }) });
      setPlan(data.plan); setIncidentId(data.plan.incidentId); setNotice('Plan generated and saved to MongoDB.');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function patchStep(step, status) {
    setBusyStep(step._id); setError(''); setNotice('');
    try { const data = await api(`/api/remediation/${plan._id}/steps/${step._id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setPlan(data.plan); setNotice(status === 'COMPLETED' ? 'Step marked complete by engineer.' : 'Step marked reviewed.'); }
    catch (e) { setError(e.message); } finally { setBusyStep(''); }
  }
  async function review(step, decision) {
    if (!reviewer.trim()) { setError('Enter your name before recording a review decision.'); return; }
    const reason = decision === 'APPROVE' ? '' : window.prompt(decision === 'REJECT' ? 'Reason for rejection:' : 'Changes requested:');
    if (decision !== 'APPROVE' && !reason?.trim()) return;
    setBusyStep(step._id); setError(''); setNotice('');
    try { const data = await api(`/api/remediation/${plan._id}/review`, { method: 'POST', body: JSON.stringify({ stepId: step._id, decision, reason, reviewer }) }); setPlan(data.plan); setNotice(data.approval_integration.message); }
    catch (e) { setError(e.message); } finally { setBusyStep(''); }
  }
  async function validateRunbook() {
    setLoading(true); setError('');
    try { const data = await api(`/api/remediation/${plan._id}/validate`, { method: 'POST', body: '{}' }); setPlan(data.plan); setNotice('Runbook validation refreshed.'); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  const done = plan?.steps?.filter((s) => s.status === 'COMPLETED').length || 0;
  const progress = plan?.steps?.length ? Math.round(100 * done / plan.steps.length) : 0;
  return <main className="shell">
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">A</span><span>AEGIS<span className="brand-light">OPS</span><small>INCIDENT RESPONSE</small></span></a><div className="top-meta"><span className="live-dot"/> REMEDIATION WAR ROOM <span className="divider"/> <span className="muted">ENGINEER CONSOLE</span></div><button className="button ghost" onClick={() => refresh()}>↻ Refresh</button></header>
    <section className="hero" id="top"><div><div className="breadcrumb">INCIDENTS <span>/</span> REMEDIATION <span>/</span> {plan?.incidentId || incidentId}</div><div className="hero-title"><span className="severity-icon">!</span><div><p className="eyebrow">ACTIVE INCIDENT <span className="severity-text">{plan?.incident?.severity || demo.severity}</span></p><h1>{plan?.incident?.title || demo.incidentTitle}</h1><p className="hero-sub">Engineer guided recovery recommendations</p></div></div></div><div className="hero-actions"><label className="incident-input">Incident ID<input value={incidentId} onChange={(e) => setIncidentId(e.target.value)} aria-label="Incident ID" /></label><button className="button primary" onClick={generate} disabled={loading}>{loading ? 'Working…' : '＋ Generate plan'}</button></div></section>
    {error && <div role="alert" className="banner error"><b>Could not complete request</b><span>{error}</span><button onClick={() => refresh()}>Retry</button></div>}
    {notice && <div className="banner success"><span>✓</span>{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
    {loading && !plan && <div className="empty-state"><div className="loader"/><h2>Loading incident plan</h2><p>Connecting to the remediation service…</p></div>}
    {!loading && !plan && !error && <div className="empty-state"><div className="empty-icon">⌁</div><h2>No remediation plan yet</h2><p>Generate a plan from the synthetic payment incident scenario, or enter an incident ID above to load an existing plan.</p><button className="button primary" onClick={generate}>Generate synthetic demo plan</button><small>Demo data is simulated. No production recovery is performed.</small></div>}
    {plan && <>
      <section className="summary-grid">
        <article className="panel root-panel"><div className="section-head"><div><p className="eyebrow">PROBABLE ROOT CAUSE</p><h2>Investigation summary</h2></div><span className="tag">RCA {plan.rcaReference || 'LINKED'}</span></div><p className="root-cause">{plan.rootCause}</p><h3 className="mini-heading">Supporting evidence <span className="count">{plan.evidence?.length || 0}</span></h3><ul className="evidence-list">{plan.evidence?.map((item, i) => <li key={i}><span className="evidence-marker">{String(i + 1).padStart(2, '0')}</span>{item}</li>)}</ul></article>
        <article className="panel status-panel"><p className="eyebrow">PLAN STATUS</p><div className="status-line"><strong>{(plan.overallStatus || 'AWAITING_REVIEW').replaceAll('_', ' ')}</strong><span className={`status-pill ${plan.overallStatus?.toLowerCase()}`}/></div><div className="progress-label"><span>Recovery progress</span><b>{done}/{plan.steps.length} complete</b></div><div className="progress-track"><div style={{ width: `${progress}%` }}/></div><div className="status-meta"><span>Created</span><b>{new Date(plan.createdAt).toLocaleString()}</b></div><div className="status-meta"><span>Generation</span><b>{plan.generation?.fallbackUsed ? 'Deterministic fallback' : `${plan.generation?.provider || 'Unknown'} AI`}</b></div><div className="integration-note">Local review adapter · Shaanvi workflow not connected</div></article>
      </section>
      {plan.safetyWarnings?.length > 0 && <section className="warning-box"><div className="warning-symbol">⚠</div><div><h3>Safety notices</h3>{plan.safetyWarnings.map((w, i) => <p key={i}>{w}</p>)}</div></section>}
      <Flowchart steps={plan.steps}/>
      <section className="panel steps-panel"><div className="section-head"><div><p className="eyebrow">ENGINEER REVIEW</p><h2>Remediation plan <span className="count">{plan.steps.length} steps</span></h2></div><div className="plan-actions"><input className="reviewer-input" placeholder="Reviewer name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer name"/><button className="button secondary" onClick={validateRunbook} disabled={loading}>Validate runbook</button></div></div><p className="section-copy">Review each recommendation. Completion reflects an explicit engineer action and does not execute a production change.</p>
      <div className="step-list">{plan.steps.map((step) => {
        const validation = plan.runbookValidation?.stepResults?.find((r) => r.stepNumber === step.stepNumber);
        const expandedNow = expanded === step._id;
        return <article className={`step-card ${step.riskLevel === 'HIGH' ? 'high-risk' : ''} ${step.safetyStatus === 'BLOCKED' ? 'blocked' : ''}`} key={step._id}>
          <button className="step-summary" onClick={() => setExpanded(expandedNow ? '' : step._id)} aria-expanded={expandedNow}><span className="step-num">{String(step.stepNumber).padStart(2, '0')}</span><span className="step-main"><b>{step.title}</b><small>{step.actionType.replaceAll('_', ' ')}</small></span><span className={`risk ${step.riskLevel.toLowerCase()}`}>{step.riskLevel} RISK</span><span className={`runbook-status ${(validation?.status || 'not_validated').toLowerCase()}`}>{(validation?.status || 'NOT VALIDATED').replaceAll('_', ' ')}</span><span className={`step-state ${step.status.toLowerCase()}`}>{step.status.replaceAll('_', ' ')}</span><span className="chevron">{expandedNow ? '−' : '+'}</span></button>
          {expandedNow && <div className="step-detail"><div className="detail-grid"><div><label>WHAT TO DO</label><p>{step.description}</p></div><div><label>WHY IT MATTERS</label><p>{step.reason}</p></div><div><label>EXPECTED OUTCOME</label><p>{step.expectedOutcome}</p></div><div><label>PREREQUISITES</label><p>{step.prerequisites?.length ? step.prerequisites.join(' · ') : 'None specified'}</p></div></div>{step.requiresApproval && <div className="approval-callout">Engineer approval required before completion. This module records a local review only.</div>}{validation && <div className="runbook-result"><b>Runbook check:</b> {validation.reason} {plan.runbookValidation?.references?.map((r) => <span className="ref-chip" key={r.id}>{r.title} · {r.source}</span>)}</div>}<div className="step-buttons">{step.status === 'PENDING' && <button className="button secondary" disabled={busyStep === step._id} onClick={() => patchStep(step, 'REVIEWED')}>Mark reviewed</button>}{step.requiresApproval && step.review?.decision !== 'APPROVE' && step.safetyStatus !== 'BLOCKED' && <><button className="button approve" disabled={busyStep === step._id} onClick={() => review(step, 'APPROVE')}>Approve recommendation</button><button className="button reject" disabled={busyStep === step._id} onClick={() => review(step, 'REJECT')}>Reject</button><button className="button ghost" disabled={busyStep === step._id} onClick={() => review(step, 'REQUEST_CHANGES')}>Request changes</button></>}{step.review?.decision === 'APPROVE' && <span className="approved-label">✓ Approved by {step.review.reviewer}</span>}{step.status !== 'COMPLETED' && <button className="button primary" disabled={busyStep === step._id || step.safetyStatus === 'BLOCKED'} onClick={() => patchStep(step, 'COMPLETED')}>Mark complete</button>}</div>{step.review?.reason && <p className="review-reason">{step.review.decision.replaceAll('_', ' ')} by {step.review.reviewer}: {step.review.reason}</p>}</div>}
        </article>;
      })}</div></section>
      <section className="runbook-footer"><span className="book-icon">▤</span><div><b>Runbook validation</b><p>{plan.runbookValidation?.status?.replaceAll('_', ' ') || 'NOT VALIDATED'} · {plan.runbookValidation?.source || 'No source'} · Sample procedures are simulated pending knowledge base integration.</p></div><button className="button ghost" onClick={() => setExpanded(plan.steps[0]?._id || '')}>View steps</button></section>
    </>}
    <footer><span>AEGISOPS <i>ENGINEER GUIDANCE</i></span><span>Synthetic demonstration · No actions are executed by this interface</span></footer>
  </main>;
}
