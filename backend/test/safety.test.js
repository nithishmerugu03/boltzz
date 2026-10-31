import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk, validateSteps } from '../src/services/safety.js';
import { deterministicSteps, generateRemediation } from '../src/agents/remediationAgent.js';
import { validateAgainstRunbooks } from '../src/services/runbooks.js';
import { errorEnvelope, successEnvelope } from '../src/services/responseContract.js';

test('risk is independently assigned for diagnostic, config, and rollback actions', () => {
  assert.equal(classifyRisk({ title: 'Inspect active connections', actionType: 'DIAGNOSTIC' }).riskLevel, 'LOW');
  assert.equal(classifyRisk({ title: 'Review pool settings', actionType: 'CONFIGURATION' }).riskLevel, 'MEDIUM');
  const rollback = classifyRisk({ title: 'Consider rollback', actionType: 'ROLLBACK' });
  assert.equal(rollback.riskLevel, 'HIGH');
  assert.equal(rollback.requiresApproval, true);
});

test('destructive suggestions are blocked regardless of claimed model risk', () => {
  const checked = validateSteps([{ title: 'Drop database', description: 'Drop production database', reason: 'Test', expectedOutcome: 'Lost', riskLevel: 'LOW', requiresApproval: false, actionType: 'DATABASE_CHANGE' }]);
  assert.equal(checked.steps[0].safetyStatus, 'BLOCKED');
  assert.equal(checked.steps[0].riskLevel, 'HIGH');
});

test('payment incident receives specific steps and sample runbook validation', async () => {
  const steps = validateSteps(deterministicSteps({ rootCause: 'Database connection pool exhaustion after deployment', evidence: ['Payment API failures'] })).steps;
  assert.ok(steps.length >= 5);
  assert.equal(steps.at(-1).riskLevel, 'HIGH');
  const validation = await validateAgainstRunbooks(steps, 'Database connection pool exhaustion', ['Payment service failures']);
  assert.ok(['VALIDATED', 'PARTIALLY_VALIDATED'].includes(validation.status));
  assert.equal(validation.references[0].source, 'SIMULATED_SAMPLE_RUNBOOK');
});

test('unknown diagnosis does not claim runbook approval', async () => {
  const steps = validateSteps(deterministicSteps({ rootCause: 'Unknown subsystem anomaly', evidence: [] })).steps;
  const result = await validateAgainstRunbooks(steps, 'Unknown subsystem anomaly', []);
  assert.equal(result.status, 'NOT_VALIDATED');
});

test('runbook validation requires multiple meaningful matches and ignores unapproved sources', async () => {
  const step = {
    stepNumber: 1,
    title: 'Review database connection behavior',
    description: 'Inspect the current connection timeout symptoms.',
    safetyStatus: 'ALLOWED'
  };
  const noStrongMatch = await validateAgainstRunbooks([step], 'Database issue', [], {
    async findRelevant() {
      return [{
        id: 'weak-match',
        title: 'Database operations',
        approved: true,
        instructions: ['Monitor database health and verify backups.']
      }];
    }
  });
  assert.equal(noStrongMatch.stepResults[0].status, 'NOT_VALIDATED');

  const unapproved = await validateAgainstRunbooks([step], 'Database issue', [], {
    async findRelevant() {
      return [{
        id: 'unapproved',
        title: 'Unapproved instructions',
        approved: false,
        instructions: ['Review database connection behavior and inspect timeout symptoms.']
      }];
    }
  });
  assert.equal(unapproved.status, 'NOT_VALIDATED');
  assert.deepEqual(unapproved.references, []);
});

test('missing Groq configuration uses deterministic fallback and labels it', async () => {
  const priorKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const result = await generateRemediation({ incidentId: 'INC-101', rootCause: 'Database connection pool exhaustion', evidence: [] });
    assert.equal(result.generation.provider, 'DETERMINISTIC');
    assert.equal(result.generation.fallbackUsed, true);
    assert.ok(result.steps.length >= 5);
  } finally { if (priorKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = priorKey; }
});

test('malformed Groq output is rejected and falls back without claiming AI success', async () => {
  const priorKey = process.env.GROQ_API_KEY;
  const priorFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-placeholder';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"steps":[{"title":"Only a title"}]}' } }] }) });
  try {
    const result = await generateRemediation({ incidentId: 'INC-101', rootCause: 'Database connection pool exhaustion', evidence: [] });
    assert.equal(result.generation.provider, 'DETERMINISTIC');
    assert.equal(result.generation.fallbackUsed, true);
    assert.match(result.providerError, /schema validation/i);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = priorKey;
  }
});

test('workflow response uses the exact common envelope and required module data fields', () => {
  const result = successEnvelope({ incidentId: 'INC-101', plan: {
    incidentId: 'INC-101', rootCause: 'Database connection pool exhaustion', incident: { severity: 'CRITICAL', title: 'Payment Service Failure' },
    evidence: ['Database connection timeout'], safetyWarnings: [], steps: [{ stepNumber: 1, title: 'Inspect active connections', reason: 'Pool saturation', expectedOutcome: 'Confirm pool use', riskLevel: 'LOW', requiresApproval: false, status: 'PENDING' }]
  } });
  assert.deepEqual(Object.keys(result), ['incident_id', 'component', 'status', 'timestamp', 'summary', 'findings', 'evidence', 'recommendations', 'data', 'error']);
  assert.equal(result.incident_id, 'INC-101');
  assert.equal(result.component, 'remediation');
  assert.match(result.timestamp, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(result.findings[0].confidence, null);
  assert.match(result.findings[0].description, /^Suspected, not independently confirmed:/);
  assert.equal(result.evidence[0].content, 'Database connection timeout');
  assert.deepEqual(result.data.remediation_steps[0], { step_number: 1, action: 'Inspect active connections', expected_outcome: 'Confirm pool use', risk_level: 'low' });
  assert.equal(result.data.safety_check.status, 'passed');
  assert.equal(result.error, null);
});

test('workflow error response retains all common fields and structured error', () => {
  const result = errorEnvelope({ incidentId: 'INC-101', status: 400, message: 'Invalid input.' });
  assert.deepEqual(Object.keys(result), ['incident_id', 'component', 'status', 'timestamp', 'summary', 'findings', 'evidence', 'recommendations', 'data', 'error']);
  assert.equal(result.incident_id, 'INC-101');
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.error, { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: null });
  assert.ok(Array.isArray(result.findings) && Array.isArray(result.evidence) && Array.isArray(result.recommendations));
  assert.equal(typeof result.data, 'object');
});
