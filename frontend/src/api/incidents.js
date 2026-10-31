// All backend calls for incidents/workflow/audit. UI components never call fetch directly.
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = data?.error?.message
      || (Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : detail)
      || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  listIncidents: () => request('/incidents'),
  createIncident: (body) => request('/incidents', { method: 'POST', body }),
  startWorkflow: (id) => request(`/incidents/${id}/start`, { method: 'POST' }),
  getIncident: (id) => request(`/incidents/${id}`),
  getStatus: (id) => request(`/incidents/${id}/status`),
  getAudit: (id) => request(`/incidents/${id}/audit`),
  getReport: (id) => request(`/incidents/${id}/report`),
  decide: (id, recId, body) => request(`/incidents/${id}/remediation/${recId}/decision`, { method: 'POST', body }),
  resolve: (id, body) => request(`/incidents/${id}/resolve`, { method: 'POST', body }),
};
