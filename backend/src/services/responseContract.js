const severityMap = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info', warning: 'medium' };

function plain(value) {
  if (!value) return null;
  return typeof value.toObject === 'function' ? value.toObject({ depopulate: true, flattenMaps: true }) : value;
}

function moduleData(planLike) {
  const plan = plain(planLike);
  const steps = plan?.steps || [];
  const warnings = plan?.safetyWarnings || [];
  const blocked = steps.some((step) => step.safetyStatus === 'BLOCKED');
  const approvalRequired = steps.some((step) => step.requiresApproval === true);
  const approvalPending = steps.some((step) => step.requiresApproval === true && step.review?.decision !== 'APPROVE');
  return {
    plan_id: plan?._id?.toString?.() || plan?._id || null,
    incident_title: plan?.incident?.title || null,
    severity: plan?.incident?.severity || null,
    root_cause: plan?.rootCause || null,
    remediation_steps: steps.map((step) => ({
      step_number: step.stepNumber,
      action: step.title,
      expected_outcome: step.expectedOutcome,
      risk_level: String(step.riskLevel || 'LOW').toLowerCase()
    })),
    safety_check: { status: blocked ? 'blocked' : warnings.length ? 'warning' : 'passed', warnings },
    approval_required: approvalRequired,
    execution_status: approvalPending ? 'pending_approval' : 'not_executed',
    runbook_validation: plan?.runbookValidation || null,
    engineer_review_status: plan?.overallStatus || null,
    generation: plan?.generation || null,
    approval_integration: plan?.approvalIntegration || null,
    plan: plan
  };
}

function evidenceItems(planLike) {
  const plan = plain(planLike);
  return (plan?.evidence || []).map((content, index) => ({
    source: 'RCA input', reference: `evidence[${index}]`, content,
    relevance: `Evidence supplied with incident ${plan.incidentId}.`
  }));
}

function findingsFor(planLike) {
  const plan = plain(planLike);
  if (!plan?.rootCause) return [];
  return [{
    finding_id: `FIND-${String(plan.incidentId || 'INC').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24)}`,
    title: 'Probable root cause from RCA input',
    description: `Suspected, not independently confirmed: ${plan.rootCause}`,
    severity: severityMap[String(plan.incident?.severity || 'info').toLowerCase()] || 'info',
    confidence: null
  }];
}

function recommendationsFor(planLike) {
  const plan = plain(planLike);
  return (plan?.steps || []).map((step) => ({
    recommendation_id: `REC-${String(step.stepNumber).padStart(3, '0')}`,
    action: step.title,
    reason: step.reason,
    priority: step.riskLevel === 'HIGH' ? 'high' : step.riskLevel === 'MEDIUM' ? 'medium' : 'low',
    requires_approval: Boolean(step.requiresApproval)
  }));
}

function successEnvelope({ incidentId = null, status = 'completed', summary, plan = null, data = {}, evidence, findings, recommendations }) {
  const p = plain(plan);
  return {
    incident_id: incidentId ?? p?.incidentId ?? null,
    component: 'remediation',
    status,
    timestamp: new Date().toISOString(),
    summary: summary || 'Remediation module processed the request.',
    findings: findings ?? findingsFor(p),
    evidence: evidence ?? evidenceItems(p),
    recommendations: recommendations ?? recommendationsFor(p),
    data: { ...moduleData(p), ...data },
    error: null
  };
}

function errorEnvelope({ incidentId = null, status = 500, message = 'The remediation request could not be completed.' }) {
  const codes = { 400: 'VALIDATION_ERROR', 404: 'NOT_FOUND', 409: 'SAFETY_POLICY_REJECTED', 503: 'SERVICE_UNAVAILABLE' };
  return {
    incident_id: incidentId ?? null,
    component: 'remediation',
    status: 'failed',
    timestamp: new Date().toISOString(),
    summary: message,
    findings: [], evidence: [], recommendations: [], data: moduleData(null),
    error: { code: codes[status] || 'INTERNAL_ERROR', message, details: null }
  };
}

module.exports = { successEnvelope, errorEnvelope };
