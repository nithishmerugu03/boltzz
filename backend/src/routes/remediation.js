import { Router } from 'express';
import RemediationPlan from '../models/RemediationPlan.js';
import { createPlan, inputErrors, normalizeRcaInput, reviewStep, updateStep } from '../services/remediationService.js';
import { validateAgainstRunbooks } from '../services/runbooks.js';
import { errorEnvelope, successEnvelope } from '../services/responseContract.js';

const router = Router();
const requireDatabase = (req, res, next) => {
  if (RemediationPlan.db.readyState !== 1) return res.status(503).json(errorEnvelope({
    incidentId: req.body?.incident_id ?? req.body?.incidentId ?? req.params?.incidentId ?? req.query?.incident_id ?? req.query?.incidentId ?? null,
    status: 503,
    message: 'MongoDB is not connected. Configure MONGODB_URI and make Atlas available before using persistence APIs.'
  }));
  next();
};

router.get('/', requireDatabase, async (req, res, next) => {
  const incidentId = req.query.incident_id ?? req.query.incidentId;
  if (!incidentId) return res.status(400).json(errorEnvelope({ status: 400, message: 'Query parameter incident_id is required.' }));
  try {
    const plans = await RemediationPlan.find({ incidentId }).sort({ createdAt: -1 });
    res.json(successEnvelope({ incidentId, plan: plans[0] || null, data: { plans } }));
  } catch (e) { next(e); }
});

router.post('/generate', requireDatabase, async (req, res, next) => {
  const errors = inputErrors(req.body);
  if (errors.length) return res.status(400).json(errorEnvelope({ incidentId: req.body?.incident_id ?? req.body?.incidentId ?? null, status: 400, message: `Invalid remediation request: ${errors.join(' ')}` }));
  const input = normalizeRcaInput(req.body);
  try {
    const plan = await createPlan(input);
    res.status(201).json(successEnvelope({ incidentId: input.incidentId, status: 'completed', summary: 'Remediation recommendations generated and saved for engineer review.', plan }));
  } catch (e) { next(e); }
});

router.get('/:incidentId', requireDatabase, async (req, res, next) => {
  try {
    const plans = await RemediationPlan.find({ incidentId: req.params.incidentId }).sort({ createdAt: -1 });
    res.json(successEnvelope({ incidentId: req.params.incidentId, plan: plans[0] || null, data: { plans } }));
  } catch (e) { next(e); }
});

router.patch('/:planId/steps/:stepId', requireDatabase, async (req, res, next) => {
  try {
    const plan = await updateStep(req.params.planId, req.params.stepId, req.body?.status);
    res.json(successEnvelope({ incidentId: plan.incidentId, status: plan.overallStatus === 'COMPLETED' ? 'completed' : 'in_progress', summary: 'Engineer progress was recorded; no operational action was executed.', plan }));
  } catch (e) { next(e); }
});

router.post('/:planId/validate', requireDatabase, async (req, res, next) => {
  try {
    const plan = await RemediationPlan.findById(req.params.planId);
    if (!plan) return res.status(404).json(errorEnvelope({ status: 404, message: 'Remediation plan not found.' }));
    plan.runbookValidation = await validateAgainstRunbooks(plan.steps, plan.rootCause, plan.evidence);
    plan.safetyWarnings = plan.safetyWarnings.filter((w) => !w.startsWith('Runbook validation status:'));
    if (plan.runbookValidation.status !== 'VALIDATED') plan.safetyWarnings.push(`Runbook validation status: ${plan.runbookValidation.status}. Unmatched recommendations are not approved procedures.`);
    await plan.save(); res.json(successEnvelope({ incidentId: plan.incidentId, status: 'in_progress', summary: 'Runbook validation completed against the configured adapter.', plan }));
  } catch (e) { next(e); }
});

router.post('/:planId/review', requireDatabase, async (req, res, next) => {
  try {
    const result = await reviewStep(req.params.planId, req.body);
    res.json(successEnvelope({ incidentId: result.plan.incidentId, status: 'in_progress', summary: 'Engineer review decision recorded.', plan: result.plan, data: { approval_integration: result.integration } }));
  } catch (e) { next(e); }
});

export default router;
