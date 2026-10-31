import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/incidents.js';
import { Card, Empty, ErrorBox, SeverityBadge, StatusBadge, formatTime } from '../components/ui.jsx';

const EMPTY_FORM = { incident_id: '', title: '', description: '', severity: 'high', affected_services: '', logs: '' };

// Demo input only (the user still submits it explicitly).
const SAMPLE = {
  incident_id: 'INC-001',
  title: 'E-commerce checkout failures',
  description: 'Users are experiencing failures when completing purchases through the checkout service.',
  severity: 'critical',
  affected_services: 'checkout-service, orders-db',
  logs: [
    '2026-10-31T10:01:12Z ERROR HikariPool-1 - Connection is not available, request timed out after 30000ms (total=50, active=50, idle=0, waiting=187)',
    '2026-10-31T10:01:30Z ERROR SQLTimeoutException: Database connection timeout after 30000ms',
    '2026-10-31T10:01:44Z ERROR POST /api/checkout 503 duration=29870ms',
    '2026-10-31T10:02:05Z WARN  POST /api/checkout p95 latency 29800ms',
  ].join('\n'),
};

export default function IncidentList() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState(null);
  const [health, setHealth] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listIncidents().then(setIncidents).catch((e) => { setIncidents([]); setError(e.message); });
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const inc = await api.createIncident({
        ...form,
        incident_id: form.incident_id.trim() || undefined,
        affected_services: form.affected_services.split(',').map((s) => s.trim()).filter(Boolean),
      });
      await api.startWorkflow(inc.incident_id);
      navigate(`/incidents/${inc.incident_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Report a new incident" actions={<button type="button" className="text-sm text-blue-600 underline" onClick={() => setForm(SAMPLE)}>Load sample incident</button>}>
        {health && (
          <p className="mb-2 text-xs text-slate-500">
            Module mode: <b className={health.module_mode === 'mock' ? 'text-amber-700' : ''}>{health.module_mode}</b> · DB: {health.database ? 'connected' : 'down'} · LLM: {health.llm_configured ? 'configured' : 'not configured'}
          </p>
        )}
        <form onSubmit={submit} className="space-y-2">
          <input className={input} placeholder="Incident ID (optional, e.g. INC-001)" value={form.incident_id} onChange={update('incident_id')} />
          <input className={input} placeholder="Title" required value={form.title} onChange={update('title')} />
          <textarea className={input} placeholder="Description" required rows={2} value={form.description} onChange={update('description')} />
          <div className="flex gap-2">
            <select className={input} value={form.severity} onChange={update('severity')}>
              {['critical', 'high', 'medium', 'low'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <input className={input} placeholder="Affected services (comma separated)" value={form.affected_services} onChange={update('affected_services')} />
          </div>
          <textarea className={`${input} font-mono`} placeholder="Paste logs" rows={5} value={form.logs} onChange={update('logs')} />
          <ErrorBox>{error}</ErrorBox>
          <button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Starting…' : 'Create incident & start war room'}
          </button>
        </form>
      </Card>

      <Card title="Incidents">
        {incidents === null ? <Empty>Loading…</Empty> : incidents.length === 0 ? <Empty>No incidents yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {incidents.map((i) => (
              <li key={i.incident_id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/incidents/${i.incident_id}`} className="text-sm">
                  <span className="font-mono font-medium text-blue-700">{i.incident_id}</span> {i.title}
                  <div className="text-xs text-slate-500">{formatTime(i.created_at)}</div>
                </Link>
                <div className="flex gap-1"><SeverityBadge severity={i.severity} /><StatusBadge status={i.workflow_status} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
