const { validateSteps } = require('../services/safety.js');

function paymentPoolSteps() {
  return [
    { title: 'Inspect active database connections', description: 'Query the database activity view and compare active, idle, and waiting connections with the configured pool limit.', reason: 'Pool exhaustion can leave payment requests waiting until they time out.', expectedOutcome: 'Confirm whether active or waiting connections are at or near the pool limit.', prerequisites: ['Read-only database monitoring access'], actionType: 'DIAGNOSTIC' },
    { title: 'Check database resource utilization', description: 'Review database CPU, memory, connection count, and saturation metrics for the incident window.', reason: 'Resource saturation can prevent connections from being released or served promptly.', expectedOutcome: 'Identify whether database capacity or connection count is the limiting resource.', prerequisites: ['Monitoring dashboard access'], actionType: 'DIAGNOSTIC' },
    { title: 'Review connection pool configuration', description: 'Compare the deployed pool size, acquisition timeout, idle timeout, and maximum lifetime with the last known working settings.', reason: 'A deployment may have changed pool settings or connection lifecycle behavior.', expectedOutcome: 'Find configuration changes that correlate with the onset of connection timeouts.', prerequisites: ['Deployment configuration access', 'Change review'], actionType: 'CONFIGURATION' },
    { title: 'Compare the latest deployment with the previous working version', description: 'Inspect the payment service release diff, database client changes, and connection lifecycle changes introduced at 10:00 AM.', reason: 'The connection failures began shortly after deployment, so the release is a candidate trigger that needs evidence-based confirmation.', expectedOutcome: 'Identify or rule out release changes affecting connection acquisition and release.', prerequisites: ['Release metadata', 'Previous working version'], actionType: 'DIAGNOSTIC' },
    { title: 'Request approval before considering rollback', description: 'If evidence ties the regression to the 10:00 AM release and safer mitigations are insufficient, prepare a rollback proposal for an authorized engineer to review.', reason: 'Rollback changes production behavior and may affect in-flight payments or schema compatibility.', expectedOutcome: 'An authorized reviewer records an explicit approve or reject decision; no rollback is executed by this agent.', prerequisites: ['Confirmed target version', 'Compatibility check', 'Authorized engineer approval'], actionType: 'ROLLBACK' }
  ];
}

function deterministicSteps(input) {
  const source = `${input.rootCause} ${(input.evidence || []).join(' ')}`.toLowerCase();
  if (/connection|pool|database|payment/.test(source)) return paymentPoolSteps();
  return [
    { title: 'Review incident evidence and service health', description: 'Compare the supplied error events, affected service metrics, and incident timeline to establish when symptoms began.', reason: 'A bounded evidence review helps distinguish the observed failure from an unverified cause.', expectedOutcome: 'A concise timeline of confirmed symptoms and the first failing dependency.', prerequisites: ['Incident dashboard access'], actionType: 'DIAGNOSTIC' },
    { title: 'Inspect the suspected dependency using read-only checks', description: `Check health, logs, and resource indicators for the dependency implicated by: ${input.rootCause}.`, reason: 'The suspected component should be verified before any operational change is proposed.', expectedOutcome: 'Evidence confirming or weakening the current root cause hypothesis.', prerequisites: ['Read-only monitoring access'], actionType: 'DIAGNOSTIC' },
    { title: 'Review recent changes associated with the incident window', description: 'Compare deployments and configuration changes immediately before the symptoms began.', reason: 'Recent changes can provide a testable lead, but timing alone does not establish causation.', expectedOutcome: 'A list of changes to validate with service owners.', prerequisites: ['Change history access'], actionType: 'DIAGNOSTIC' }
  ];
}

async function groqSteps(input) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { steps: deterministicSteps(input), provider: 'DETERMINISTIC', model: null, fallbackUsed: true };
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'Generate a safe remediation proposal only. Never execute actions. Return JSON with a steps array, each step containing title, description, reason, expectedOutcome, prerequisites array, actionType (DIAGNOSTIC, CONFIGURATION, OPERATIONAL, ROLLBACK, DATABASE_CHANGE). Keep steps actionable, grounded in given RCA, and avoid destructive operations.' },
      { role: 'user', content: JSON.stringify({ incidentId: input.incidentId, rootCause: input.rootCause, evidence: input.evidence, securityFindings: input.securityFindings || [] }) }
    ] })
  });
  if (!response.ok) throw new Error(`Groq returned HTTP ${response.status}.`);
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.steps) || parsed.steps.length < 1 || parsed.steps.length > 12) throw new Error('Groq returned an invalid steps array.');
  return { steps: parsed.steps, provider: 'GROQ', model, fallbackUsed: false };
}

async function generateRemediation(input) {
  let generated;
  try { generated = await groqSteps(input); }
  catch (error) { generated = { steps: deterministicSteps(input), provider: 'DETERMINISTIC', model: null, fallbackUsed: true, providerError: error.message }; }
  try {
    const checked = validateSteps(generated.steps);
    return { ...checked, generation: { provider: generated.provider, model: generated.model, fallbackUsed: generated.fallbackUsed }, providerError: generated.providerError };
  } catch (error) {
    if (generated.fallbackUsed) throw error;
    const checked = validateSteps(deterministicSteps(input));
    return { ...checked, generation: { provider: 'DETERMINISTIC', model: null, fallbackUsed: true }, providerError: `AI output rejected by schema validation: ${error.message}` };
  }
}

module.exports = { deterministicSteps, generateRemediation };
