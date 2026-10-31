import RemediationPlan from '../models/RemediationPlan.js';
import { generateRemediation } from '../agents/remediationAgent.js';
import { validateAgainstRunbooks } from './runbooks.js';
import { LocalReviewAdapter } from './approvalAdapter.js';

const reviewAdapter = new LocalReviewAdapter();
export const inputErrors = (body) => {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['Request body must be a JSON object.'];
  const incidentId = body.incident_id ?? body.incidentId;
  const rootCause = body.root_cause ?? body.rootCause;
  const evidence = body.evidence;
  if (typeof incidentId !== 'string' || !incidentId.trim()) errors.push('incident_id is required.');
  if (typeof rootCause !== 'string' || rootCause.trim().length < 4) errors.push('root_cause must contain at least 4 characters.');
  if (evidence !== undefined && (!Array.isArray(evidence) || evidence.some((x) => typeof x !== 'string'))) errors.push('evidence must be an array of strings.');
  if (Array.isArray(evidence) && evidence.length > 100) errors.push('evidence cannot contain more than 100 entries.');
  return errors;
};

export function normalizeRcaInput(body) {
  return {
    ...body,
    incidentId: body.incident_id ?? body.incidentId,
    rootCause: body.root_cause ?? body.rootCause,
    incidentTitle: body.incident_title ?? body.incidentTitle,
    rcaReference: body.rca_reference ?? body.rcaReference,
    securityFindings: body.security_findings ?? body.securityFindings ?? [],
    auditReferences: body.audit_references ?? body.auditReferences ?? []
  };
}

export async function createPlan(input) {
  const result = await generateRemediation(input);
  const runbookValidation = await validateAgainstRunbooks(result.steps, input.rootCause, input.evidence || []);
  const warnings = [...result.warnings];
  if (result.providerError) warnings.push(`AI unavailable or output rejected; deterministic fallback used. ${result.providerError}`);
  if (runbookValidation.status !== 'VALIDATED') warnings.push(`Runbook validation status: ${runbookValidation.status}. Unmatched recommendations are not approved procedures.`);
  const plan = await RemediationPlan.create({
    incidentId: input.incidentId.trim(), rcaReference: input.rcaReference, incident: { severity: input.severity || 'HIGH', title: input.incidentTitle || 'Payment Service Failure' },
    rootCause: input.rootCause.trim(), evidence: input.evidence || [], recommendations: result.steps.map((s) => s.title), steps: result.steps,
    safetyWarnings: warnings, runbookValidation, overallStatus: 'AWAITING_REVIEW', generation: result.generation,
    approvalIntegration: { mode: 'LOCAL_TEMPORARY' }, auditReferences: input.auditReferences || []
  });
  return plan;
}

export async function updateStep(planId, stepId, status) {
  if (!['REVIEWED', 'COMPLETED'].includes(status)) throw Object.assign(new Error('status must be REVIEWED or COMPLETED.'), { statusCode: 400 });
  const plan = await RemediationPlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Remediation plan not found.'), { statusCode: 404 });
  const step = plan.steps.id(stepId);
  if (!step) throw Object.assign(new Error('Remediation step not found.'), { statusCode: 404 });
  if (step.safetyStatus === 'BLOCKED') throw Object.assign(new Error('Blocked steps cannot be completed.'), { statusCode: 409 });
  if (status === 'COMPLETED' && step.requiresApproval && step.review?.decision !== 'APPROVE') throw Object.assign(new Error('This step requires an explicit engineer approval before completion.'), { statusCode: 409 });
  step.status = status;
  const allDone = plan.steps.length > 0 && plan.steps.every((s) => s.status === 'COMPLETED');
  plan.overallStatus = allDone ? 'COMPLETED' : 'IN_PROGRESS';
  await plan.save(); return plan;
}

export async function reviewStep(planId, body) {
  const { stepId, decision, reason, reviewer } = body || {};
  if (!stepId || !['APPROVE', 'REJECT', 'REQUEST_CHANGES'].includes(decision) || typeof reviewer !== 'string' || !reviewer.trim()) throw Object.assign(new Error('stepId, reviewer, and a valid decision are required.'), { statusCode: 400 });
  if (decision !== 'APPROVE' && (typeof reason !== 'string' || !reason.trim())) throw Object.assign(new Error('A rejection or change request requires a reason.'), { statusCode: 400 });
  const plan = await RemediationPlan.findById(planId);
  if (!plan) throw Object.assign(new Error('Remediation plan not found.'), { statusCode: 404 });
  const step = plan.steps.id(stepId);
  if (!step) throw Object.assign(new Error('Remediation step not found.'), { statusCode: 404 });
  if (step.safetyStatus === 'BLOCKED' && decision === 'APPROVE') throw Object.assign(new Error('Safety policy blocks approval of this recommendation.'), { statusCode: 409 });
  const integration = await reviewAdapter.submitReview({ plan, step, decision, reason: reason?.trim(), reviewer: reviewer.trim() });
  if (decision === 'REJECT') plan.overallStatus = 'REJECTED';
  else if (plan.overallStatus !== 'COMPLETED') plan.overallStatus = 'IN_PROGRESS';
  await plan.save();
  return { plan, integration };
}
