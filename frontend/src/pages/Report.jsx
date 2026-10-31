import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/incidents.js';
import {
  Card, Empty, ErrorBox, EvidenceList, FindingsList, MockBanner, SeverityBadge, StatusBadge, Timeline, formatTime,
} from '../components/ui.jsx';
import { useReport } from './WarRoom.jsx';

function Unavailable({ output, label }) {
  if (output?.status === 'completed') return null;
  return <Empty>{label} unavailable{output?.error ? ` — ${output.error.code}: ${output.error.message}` : ' — module did not produce a result.'}</Empty>;
}

function Section({ title, output, status, children }) {
  return (
    <Card title={title} actions={status && <StatusBadge status={status} />}>
      {output?.status === 'completed' ? children : <Unavailable output={output} label={title} />}
    </Card>
  );
}

function Recommendations({ incident, onChange }) {
  const recs = incident.remediation?.recommendations || [];
  const approvals = incident.approvals || [];
  const checks = incident.remediation?.data?.safety_checks || [];
  const [error, setError] = useState('');
  const [reviewer, setReviewer] = useState('');

  async function decide(recId, decision) {
    setError('');
    if (!reviewer.trim()) { setError('Enter reviewer name first.'); return; }
    try { await api.decide(incident.incident_id, recId, { decision, reviewer }); onChange(); } catch (e) { setError(e.message); }
  }

  if (!recs.length) return <Empty>No remediation recommendations.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Recommendations are proposals only. Approving records a human decision; it does not execute anything.</p>
      <input className="no-print rounded border border-slate-300 px-2 py-1 text-sm" placeholder="Reviewer name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
      <ErrorBox>{error}</ErrorBox>
      {recs.map((r) => {
        const decision = approvals.find((a) => a.recommendation_id === r.recommendation_id);
        const recChecks = checks.filter((c) => c.recommendation_id === r.recommendation_id);
        return (
          <div key={r.recommendation_id} className="rounded border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{r.recommendation_id}</span>
              <SeverityBadge severity={r.priority} />
              <span className="font-medium">{r.action}</span>
            </div>
            <p className="text-slate-600">{r.reason}</p>
            {recChecks.map((c, i) => (
              <p key={i} className="text-xs text-slate-600">Safety check ({c.risk_level} risk): {c.check} — {c.passed ? 'passed' : 'FAILED'}</p>
            ))}
            <div className="mt-1 text-xs">
              Approval: {!r.requires_approval ? 'not required (read-only)' : decision
                ? <b className={decision.decision === 'approved' ? 'text-green-700' : 'text-red-700'}>{decision.decision} by {decision.reviewer} at {formatTime(decision.decided_at)}</b>
                : <span className="text-amber-700">awaiting human approval</span>}
              {' · '}Execution: <b>not executed</b>
            </div>
            {r.requires_approval && !decision && (
              <div className="no-print mt-2 flex gap-2">
                <button onClick={() => decide(r.recommendation_id, 'approved')} className="rounded bg-green-600 px-2 py-1 text-xs text-white">Approve</button>
                <button onClick={() => decide(r.recommendation_id, 'rejected')} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Reject</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResolveForm({ incident, onChange }) {
  const [form, setForm] = useState({ resolved_by: '', notes: '', executed: '' });
  const [error, setError] = useState('');
  if (incident.resolution) {
    const r = incident.resolution;
    return <p className="text-sm">Resolved by <b>{r.resolved_by}</b> at {formatTime(r.resolved_at)}. Confirmed executed actions: {r.executed_actions.join('; ') || 'none'}. {r.notes}</p>;
  }
  if (['created', 'running'].includes(incident.workflow_status)) return <Empty>Incident unresolved — workflow still in progress.</Empty>;
  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.resolve(incident.incident_id, {
        resolved_by: form.resolved_by, notes: form.notes,
        executed_actions: form.executed.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      onChange();
    } catch (err) { setError(err.message); }
  }
  const input = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';
  return (
    <form onSubmit={submit} className="no-print space-y-2">
      <p className="text-sm text-slate-600">Incident is <b>unresolved</b>. Mark resolved only after recovery has been verified.</p>
      <input className={input} required placeholder="Resolved by" value={form.resolved_by} onChange={(e) => setForm({ ...form, resolved_by: e.target.value })} />
      <textarea className={input} rows={2} placeholder="Actions actually executed (one per line, confirmed by an engineer)" value={form.executed} onChange={(e) => setForm({ ...form, executed: e.target.value })} />
      <textarea className={input} rows={2} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <ErrorBox>{error}</ErrorBox>
      <button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Mark resolved</button>
    </form>
  );
}

export default function Report() {
  const { id } = useParams();
  const { report, error, reload } = useReport(id);
  if (!report) return error ? <ErrorBox>{error}</ErrorBox> : <Empty>Loading report…</Empty>;
  const { incident, status, audit_events: events } = report;
  const cs = status.component_status;
  const la = incident.log_analysis;
  const rca = incident.rca_security_analysis;
  const kr = incident.knowledge_retrieval;
  const comm = incident.communication;
  // Field names follow the rca_security_analysis module (backend/src/utils/agentResponse.js).
  const rcaData = rca?.data || {};
  const confidence = rcaData.root_cause_confidence;
  const security = rcaData.security_analysis;
  const rcaFindings = (rca?.findings || []).filter((f) => !f.finding_id.startsWith('FIND-SEC-'));
  const secFindings = (rca?.findings || []).filter((f) => f.finding_id.startsWith('FIND-SEC-'));

  return (
    <div className="space-y-4">
      <style>{'@media print { .no-print { display: none !important; } }'}</style>
      <div className="no-print flex justify-between">
        <Link to={`/incidents/${id}`} className="text-sm text-blue-600 underline">← War room</Link>
        <button onClick={() => window.print()} className="rounded border border-slate-300 px-3 py-1 text-sm">Print / Save as PDF</button>
      </div>
      <MockBanner show={status.execution_mode === 'mock'} />
      <ErrorBox>{error}</ErrorBox>

      <Card title={`Incident Report — ${incident.incident_id}`}>
        <h1 className="text-xl font-semibold">{incident.title}</h1>
        <p className="text-sm text-slate-700">{incident.description}</p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <span>Severity: <SeverityBadge severity={incident.severity} /></span>
          <span>Workflow: <StatusBadge status={status.workflow_status} /></span>
          <span>Progress: {status.progress}%</span>
          <span>Created: {formatTime(incident.created_at)}</span>
          <span>Report generated: {formatTime(incident.final_report?.generated_at)}</span>
        </div>
        <p className="mt-1 text-sm">Affected services: {(la?.data?.affected_services || incident.affected_services || []).join(', ') || 'Unavailable'}</p>
      </Card>

      <Section title="Log analysis" output={la} status={cs.log_analysis}>
        <p className="mb-2 text-sm">{la?.summary}</p>
        <h4 className="text-sm font-semibold">Error classification</h4>
        {la?.data?.error_classification ? (
          <table className="mb-2 text-sm"><tbody>
            {Object.entries(la.data.error_classification).map(([k, v]) => <tr key={k}><td className="pr-4 font-mono">{k}</td><td>{v}</td></tr>)}
          </tbody></table>
        ) : <Empty>Not provided.</Empty>}
        <h4 className="text-sm font-semibold">Correlated events</h4>
        {la?.data?.correlated_events?.length ? (
          <ul className="mb-2 text-sm">{la.data.correlated_events.map((e, i) => <li key={i}>{formatTime(e.time)} · <b>{e.service}</b> · {e.event}</li>)}</ul>
        ) : <Empty>Not provided.</Empty>}
        <FindingsList findings={la?.findings} evidence={la?.evidence} />
      </Section>

      <Section title="Root cause analysis" output={rca} status={cs.rca_security_analysis}>
        {rcaData.probable_root_cause ? (
          <p className="mb-2 text-sm">
            <b>Probable root cause (hypothesis, not confirmed):</b> {rcaData.probable_root_cause}
            {' — '}category: {rcaData.root_cause_category || 'unavailable'}
            {' — '}confidence: {Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : 'unavailable'}
          </p>
        ) : <Empty>Probable root cause not identified.</Empty>}
        {rcaData.reasoning && <p className="mb-2 text-sm text-slate-600">{rcaData.reasoning}</p>}
        <FindingsList findings={rcaFindings} />
        {rca?.recommendations?.length > 0 && (
          <div className="mt-2 text-sm">
            <h4 className="font-semibold text-slate-700">Validation steps</h4>
            <ul className="list-disc pl-5">{rca.recommendations.map((r) => <li key={r.recommendation_id}>{r.action}</li>)}</ul>
          </div>
        )}
        <div className="mt-2"><EvidenceList evidence={rca?.evidence} /></div>
      </Section>

      <Section title="Security analysis" output={rca} status={cs.rca_security_analysis}>
        {security ? (
          <div className="mb-2 text-sm">
            <p>Risk detected: <b>{security.risk_detected ? 'yes' : 'no'}</b> · Risk level: <b>{security.risk_level || 'unknown'}</b>
              {security.threats?.length > 0 && <> · Threats: {security.threats.join(', ')}</>}</p>
            {security.security_observations?.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-slate-600">{security.security_observations.map((o, i) => <li key={i}>{o}</li>)}</ul>
            )}
          </div>
        ) : <Empty>No security analysis provided.</Empty>}
        {secFindings.length > 0 ? <FindingsList findings={secFindings} /> : <Empty>No security findings reported.</Empty>}
      </Section>

      <Section title="Similar historical incidents" output={kr} status={cs.knowledge_retrieval}>
        {kr?.data?.similar_incidents?.length ? (
          <ul className="space-y-2 text-sm">
            {kr.data.similar_incidents.map((s) => (
              <li key={s.incident_id} className="rounded border border-slate-200 p-2">
                <b className="font-mono">{s.incident_id}</b> {s.title} — relevance {Math.round((s.relevance_score ?? 0) * 100)}%
                <div className="text-slate-600">Root cause: {s.root_cause || 'n/a'} · Resolution: {s.resolution || 'n/a'}</div>
              </li>
            ))}
          </ul>
        ) : <Empty>No similar incidents returned.</Empty>}
      </Section>

      <Section title="Remediation recommendations, safety checks & approvals" output={incident.remediation} status={cs.remediation}>
        <Recommendations incident={incident} onChange={reload} />
      </Section>

      {[['Developer communication', 'developer_update'], ['Management communication', 'management_update'], ['Customer communication', 'customer_update']].map(([title, key]) => (
        <Section key={key} title={title} output={comm} status={cs.communication}>
          <p className="whitespace-pre-wrap text-sm">{comm?.data?.[key]}</p>
          <p className="mt-1 text-xs text-slate-400">Generated {formatTime(comm?.timestamp)} via {comm?.data?.generation_method}</p>
        </Section>
      ))}

      <Card title="Resolution summary">
        {comm?.data?.resolution_summary
          ? <p className="mb-2 whitespace-pre-wrap text-sm">{comm.data.resolution_summary}</p>
          : <Empty>No resolution summary — incident is not resolved{comm?.status !== 'completed' ? ' or communication is unavailable' : ''}.</Empty>}
        <div className="mt-2"><ResolveForm incident={incident} onChange={reload} /></div>
      </Card>

      <Card title="Audit history"><Timeline events={events} /></Card>
    </div>
  );
}
