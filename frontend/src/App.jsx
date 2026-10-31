import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

function App() {
  const [incidents, setIncidents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [incidentsRes, alertsRes, metricsRes] = await Promise.all([
          fetch(`${API_BASE}/api/incidents`),
          fetch(`${API_BASE}/api/alerts`),
          fetch(`${API_BASE}/api/metrics`),
        ]);

        const incidentsData = await incidentsRes.json();
        const alertsData = await alertsRes.json();
        const metricsData = await metricsRes.json();

        const list = incidentsData.incidents || [];
        setIncidents(list);
        setAlerts(alertsData.alerts || []);
        setMetrics(metricsData.metrics || {});

        if (list[0]) {
          setSelectedIncidentId(list[0].id);
        }
      } catch (error) {
        console.error("Failed to load dashboard", error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  useEffect(() => {
    if (!selectedIncidentId) {
      setTimeline([]);
      return;
    }

    const loadTimeline = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/incidents/${selectedIncidentId}/timeline`);
        const data = await response.json();
        setTimeline(data.timeline || []);
      } catch (error) {
        console.error("Failed to load timeline", error);
      }
    };

    loadTimeline();
  }, [selectedIncidentId]);

  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || incidents[0];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-indigo-600">IncidentIQ</p>
              <h1 className="text-2xl font-bold">Monitoring Dashboard</h1>
            </div>
            <div className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
              {metrics.activeIncidents ?? 0} active incidents
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total incidents" value={metrics.totalIncidents ?? 0} tone="indigo" />
          <StatCard label="Critical" value={metrics.criticalIncidents ?? 0} tone="rose" />
          <StatCard label="Open alerts" value={metrics.openAlerts ?? 0} tone="amber" />
          <StatCard label="Events" value={metrics.totalEvents ?? 0} tone="emerald" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_2fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Incident feed</h2>
              <span className="text-sm text-slate-500">{incidents.length} records</span>
            </div>

            {loading ? (
              <p className="text-slate-500">Loading incidents...</p>
            ) : (
              <div className="space-y-3">
                {incidents.map((incident) => (
                  <button
                    key={incident.id}
                    onClick={() => setSelectedIncidentId(incident.id)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      selectedIncidentId === incident.id
                        ? "border-indigo-200 bg-indigo-50"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{incident.id}</div>
                        <div className="mt-1 font-semibold text-slate-900">{incident.title}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityClass(incident.severity)}`}>
                        {incident.severity}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                      <span>{incident.service}</span>
                      <span>{incident.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {selectedIncident ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedIncident.id}</p>
                    <h2 className="text-2xl font-bold">{selectedIncident.title}</h2>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityClass(selectedIncident.severity)}`}>
                    {selectedIncident.severity}
                  </span>
                </div>

                <div className="mb-5 grid gap-3 md:grid-cols-2">
                  <InfoRow label="Status" value={selectedIncident.status} />
                  <InfoRow label="Owner" value={selectedIncident.owner} />
                  <InfoRow label="Service" value={selectedIncident.service} />
                  <InfoRow label="Source" value={selectedIncident.source} />
                </div>

                <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                  <p><span className="font-semibold">Summary:</span> {selectedIncident.summary}</p>
                  <p><span className="font-semibold">Impact:</span> {selectedIncident.impact}</p>
                </div>

                <div className="mt-6">
                  <h3 className="mb-3 text-lg font-semibold">Event timeline</h3>
                  <div className="space-y-3">
                    {timeline.length === 0 ? (
                      <p className="text-sm text-slate-500">No timeline events for this incident yet.</p>
                    ) : (
                      timeline.map((event) => (
                        <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-800">{event.type}</span>
                            <span className="text-xs uppercase text-slate-500">{event.level}</span>
                          </div>
                          <p className="mt-1 text-sm text-slate-700">{event.message}</p>
                          <p className="mt-2 text-xs text-slate-500">{new Date(event.timestamp).toLocaleString()} • {event.source}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-slate-500">Select an incident to inspect the timeline.</p>
            )}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Alert viewer</h2>
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <p className="text-slate-500">No active alerts.</p>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className="flex items-start justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <div className="font-medium text-slate-800">{alert.description}</div>
                      <div className="mt-1 text-xs text-slate-500">{alert.incidentId} • {alert.source}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Analytics</h2>
            <div className="space-y-4">
              <MetricRow label="Avg severity" value={metrics.avgSeverity ?? 0} />
              <MetricRow label="Open incidents" value={metrics.activeIncidents ?? 0} />
              <MetricRow label="Critical" value={metrics.criticalIncidents ?? 0} />
              <MetricRow label="Events ingested" value={metrics.totalEvents ?? 0} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const tones = {
    indigo: "bg-indigo-100 text-indigo-700",
    rose: "bg-rose-100 text-rose-700",
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tones[tone]}`}>{label}</div>
      <div className="mt-3 text-3xl font-bold">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-800">{value}</div>
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-lg font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function severityClass(level = "medium") {
  const styles = {
    critical: "bg-rose-100 text-rose-700",
    high: "bg-orange-100 text-orange-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-sky-100 text-sky-700",
    info: "bg-slate-200 text-slate-700",
  };

  return styles[level] || styles.medium;
}

export default App;
