export const COMPONENTS = [
  { key: 'log_analysis', name: 'Log Analysis', description: 'Parse, classify and correlate log events' },
  { key: 'rca_security_analysis', name: 'RCA & Security Analysis', description: 'Probable root cause and security findings' },
  { key: 'knowledge_retrieval', name: 'Knowledge Retrieval', description: 'Similar historical incidents and runbooks' },
  { key: 'remediation', name: 'Remediation', description: 'Proposed steps, safety checks, approvals' },
  { key: 'communication', name: 'Communication', description: 'Stakeholder updates' },
];

const STATUS_STYLES = {
  pending: ['Pending', 'bg-slate-100 text-slate-600'],
  created: ['Created', 'bg-slate-100 text-slate-600'],
  running: ['Running', 'bg-blue-100 text-blue-700'],
  in_progress: ['In Progress', 'bg-blue-100 text-blue-700'],
  completed: ['Completed', 'bg-green-100 text-green-700'],
  mock_completed: ['Mock Completed', 'bg-amber-100 text-amber-800 ring-1 ring-amber-400'],
  completed_with_errors: ['Completed with errors', 'bg-orange-100 text-orange-700'],
  failed: ['Failed', 'bg-red-100 text-red-700'],
  unavailable: ['Unavailable', 'bg-zinc-200 text-zinc-700'],
  skipped: ['Skipped (missing dependency)', 'bg-zinc-100 text-zinc-500'],
};

const SEVERITY_STYLES = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white', medium: 'bg-yellow-400 text-black',
  low: 'bg-sky-200 text-sky-900', info: 'bg-slate-200 text-slate-700',
};

export function StatusBadge({ status }) {
  const [label, cls] = STATUS_STYLES[status] || [status || 'Unknown', 'bg-slate-100 text-slate-600'];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export function SeverityBadge({ severity }) {
  if (!severity) return null;
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.info}`}>{severity}</span>;
}

export function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

export function Card({ title, children, actions, className = '' }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold text-slate-800">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <p className="text-sm italic text-slate-500">{children}</p>;
}

export function ErrorBox({ children }) {
  if (!children) return null;
  return <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{children}</div>;
}

export function MockBanner({ show }) {
  if (!show) return null;
  return (
    <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-sm font-medium text-amber-900">
      MOCK MODE — teammate module results come from local test fixtures, not real incident analysis.
    </div>
  );
}

export function ProgressBar({ value }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm text-slate-600"><span>Workflow progress</span><span>{value}%</span></div>
      <div className="h-3 w-full rounded bg-slate-200">
        <div className="h-3 rounded bg-green-500 transition-all" style={{ width: `${value}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Share of the 5 components that succeeded. Failed, unavailable and skipped components count as 0.</p>
    </div>
  );
}

export function FindingsList({ findings, evidence }) {
  if (!findings?.length) return <Empty>No findings reported.</Empty>;
  return (
    <ul className="space-y-2">
      {findings.map((f) => (
        <li key={f.finding_id} className="rounded border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <span className="font-medium">{f.title}</span>
            <span className="text-xs text-slate-500">
              confidence: {f.confidence == null ? 'unavailable' : `${Math.round(f.confidence * 100)}%`}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700">{f.description}</p>
        </li>
      ))}
      {evidence !== undefined && <EvidenceList evidence={evidence} />}
    </ul>
  );
}

export function EvidenceList({ evidence }) {
  if (!evidence?.length) return <Empty>No supporting evidence provided.</Empty>;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-slate-700">Evidence</h4>
      {evidence.map((e, i) => (
        <div key={i} className="rounded bg-slate-50 p-2 text-xs">
          <div className="font-mono text-slate-600">{e.source} · {e.reference}</div>
          <div className="font-mono text-slate-900">{e.content}</div>
          <div className="text-slate-500">{e.relevance}</div>
        </div>
      ))}
    </div>
  );
}

export function Timeline({ events }) {
  if (!events?.length) return <Empty>No activity recorded yet.</Empty>;
  return (
    <ol className="relative space-y-3 border-l border-slate-300 pl-4">
      {events.map((e) => (
        <li key={e.event_id}>
          <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${e.status === 'failure' ? 'bg-red-500' : e.status === 'pending' ? 'bg-amber-400' : 'bg-green-500'}`} />
          <div className="text-xs text-slate-500">{formatTime(e.timestamp)} · {e.event_type}{e.component ? ` · ${e.component}` : ''}</div>
          <div className="text-sm text-slate-800">{e.message}</div>
        </li>
      ))}
    </ol>
  );
}
