const highPatterns = [/rollback/i, /restart (?:the )?production/i, /production database/i, /delete|drop|truncate/i, /modify.*database/i, /failover/i];
const mediumPatterns = [/change|increase|decrease|modify|update|reconfigure|tune/i];
const blockedPatterns = [/drop database|truncate table|delete all|disable authentication|disable.*security|wipe/i];

export function classifyRisk(step) {
  const text = `${step.title || ''} ${step.description || ''} ${step.actionType || ''}`;
  if (blockedPatterns.some((p) => p.test(text))) return { riskLevel: 'HIGH', safetyStatus: 'BLOCKED', requiresApproval: true, warning: 'Potentially destructive or security disabling action blocked by policy.' };
  if (step.actionType === 'ROLLBACK' || highPatterns.some((p) => p.test(text))) return { riskLevel: 'HIGH', safetyStatus: 'FLAGGED', requiresApproval: true, warning: 'High risk: requires explicit engineer approval. No production action will be executed.' };
  if (['CONFIGURATION', 'OPERATIONAL', 'DATABASE_CHANGE'].includes(step.actionType) || mediumPatterns.some((p) => p.test(text))) return { riskLevel: 'MEDIUM', safetyStatus: 'FLAGGED', requiresApproval: true, warning: 'Review required before operational or configuration changes.' };
  return { riskLevel: 'LOW', safetyStatus: 'ALLOWED', requiresApproval: false };
}

export function validateSteps(input) {
  const warnings = [];
  const steps = input.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Step ${i + 1} must be an object.`);
    for (const key of ['title', 'description', 'reason', 'expectedOutcome']) if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new Error(`Step ${i + 1} is missing ${key}.`);
    const allowedActions = ['DIAGNOSTIC', 'CONFIGURATION', 'OPERATIONAL', 'ROLLBACK', 'DATABASE_CHANGE'];
    const actionType = allowedActions.includes(raw.actionType) ? raw.actionType : 'OPERATIONAL';
    const policy = classifyRisk({ ...raw, actionType });
    if (policy.warning) warnings.push(`Step ${i + 1}: ${policy.warning}`);
    return { ...raw, stepNumber: i + 1, actionType, ...policy, prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.map(String) : [], status: 'PENDING' };
  });
  return { steps, warnings };
}
