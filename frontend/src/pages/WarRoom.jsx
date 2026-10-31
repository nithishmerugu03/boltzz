import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/incidents.js';
import {
  COMPONENTS, Card, Empty, ErrorBox, FindingsList, MockBanner, ProgressBar, SeverityBadge, StatusBadge, Timeline, formatTime,
} from '../components/ui.jsx';

const POLL_MS = 2000;

export function useReport(id) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => api.getReport(id).then((r) => { setReport(r); setError(''); return r; })
    .catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    let timer;
    let cancelled = false;
    const tick = async () => {
      const r = await load();
      const status = r?.status?.workflow_status;
      if (!cancelled && (status === 'running' || status === 'created')) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load, nonce]);
  // reload() re-fetches and restarts polling (e.g. after starting a workflow).
  return { report, error, reload: () => setNonce((n) => n + 1) };
}

function ComponentCard({ meta, status, output }) {
  return (
    <div className={`rounded-lg border p-3 ${status === 'mock_completed' ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-slate-800">{meta.name}</h3>
        <StatusBadge status={status} />
      </div>
      <p className="text-xs text-slate-500">{meta.description}</p>
      {output?.summary && <p className="mt-2 text-sm text-slate-700">{output.summary}</p>}
      {output?.error && <p className="mt-2 text-xs text-red-700">{output.error.code}: {output.error.message}</p>}
      {output?.timestamp && <p className="mt-1 text-xs text-slate-400">{formatTime(output.timestamp)}</p>}
      {output?.findings?.length > 0 && <p className="mt-1 text-xs text-slate-600">{output.findings.length} finding(s)</p>}
    </div>
  );
}

export default function WarRoom() {
  const { id } = useParams();
  const { report, error, reload } = useReport(id);
  const [startError, setStartError] = useState('');

  if (!report) return error ? <ErrorBox>{error}</ErrorBox> : <Empty>Loading war room…</Empty>;
  const { incident, status, audit_events: events } = report;
  const isMock = status.execution_mode === 'mock';
  const findings = COMPONENTS.flatMap((c) => (incident[c.key]?.findings || []).map((f) => ({ ...f, component: c.name })));
  const evidence = COMPONENTS.flatMap((c) => incident[c.key]?.evidence || []);
  const canStart = status.workflow_status !== 'running';

  async function start() {
    setStartError('');
    try { await api.startWorkflow(id); reload(); } catch (e) { setStartError(e.message); }
  }

  return (
    <div className="space-y-4">
      <MockBanner show={isMock} />
      <ErrorBox>{error}</ErrorBox>
      <Card
        title={<span><span className="font-mono">{incident.incident_id}</span> · {incident.title}</span>}
        actions={(
          <div className="flex gap-2">
            {canStart && <button onClick={start} className="rounded border border-slate-300 px-3 py-1 text-sm">{status.workflow_status === 'created' ? 'Start workflow' : 'Re-run workflow'}</button>}
            <Link to={`/incidents/${id}/rca`} className="rounded border border-slate-300 px-3 py-1 text-sm">RCA &amp; Security</Link>
            <Link to={`/incidents/${id}/report`} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Final report</Link>
          </div>
        )}
      >
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-slate-500">Severity</div><SeverityBadge severity={incident.severity} /></div>
          <div><div className="text-xs text-slate-500">Overall status</div><StatusBadge status={status.workflow_status} /></div>
          <div><div className="text-xs text-slate-500">Created</div>{formatTime(incident.created_at)}</div>
          <div><div className="text-xs text-slate-500">Affected services</div>
            {(incident.log_analysis?.data?.affected_services || incident.affected_services || []).join(', ') || 'Unavailable'}</div>
        </div>
        <p className="mt-2 text-sm text-slate-700">{incident.description}</p>
        <div className="mt-3"><ProgressBar value={status.progress} /></div>
        <ErrorBox>{startError}</ErrorBox>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {COMPONENTS.map((c) => <ComponentCard key={c.key} meta={c} status={status.component_status[c.key]} output={incident[c.key]} />)}
      </div>

      {status.errors.length > 0 && (
        <Card title="Workflow errors">
          <ul className="space-y-1 text-sm text-red-800">
            {status.errors.map((e, i) => <li key={i}><b>{e.component || 'workflow'}</b> — {e.code}: {e.message}</li>)}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Findings"><FindingsList findings={findings} evidence={evidence} /></Card>
        <Card title="Activity timeline"><Timeline events={events} /></Card>
      </div>
    </div>
  );
}
