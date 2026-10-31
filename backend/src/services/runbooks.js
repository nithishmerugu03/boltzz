export const sampleRunbooks = [
  { id: 'sample-db-pool-001', title: 'Database Connection Pool Exhaustion', source: 'SIMULATED_SAMPLE_RUNBOOK', approved: true, matches: ['connection pool', 'database connection', 'payment service'], instructions: ['Inspect active database connections.', 'Check connection pool utilization.', 'Review recent deployment changes.', 'Check database health.', 'Obtain approval before modifying production settings.'] }
];

export class SampleRunbookAdapter {
  async findRelevant(rootCause, evidence = []) {
    const corpus = `${rootCause} ${evidence.join(' ')}`.toLowerCase();
    return sampleRunbooks.filter((book) => book.matches.some((term) => corpus.includes(term))).map(({ instructions, ...book }) => ({ ...book, instructions }));
  }
}

export async function validateAgainstRunbooks(steps, rootCause, evidence, adapter = new SampleRunbookAdapter()) {
  const references = await adapter.findRelevant(rootCause, evidence);
  if (!references.length) return { status: 'NOT_VALIDATED', source: 'SAMPLE_ADAPTER', references: [], stepResults: steps.map((s) => ({ stepNumber: s.stepNumber, status: 'NOT_VALIDATED', reason: 'No relevant approved runbook was found.' })) };
  const instructions = references.flatMap((r) => r.instructions.map((x) => x.toLowerCase()));
  let supported = 0;
  const stepResults = steps.map((step) => {
    const haystack = `${step.title} ${step.description}`.toLowerCase();
    const match = instructions.find((instruction) => instruction.split(/\W+/).filter((w) => w.length > 4).some((word) => haystack.includes(word)));
    const dangerous = step.safetyStatus === 'BLOCKED';
    if (dangerous) return { stepNumber: step.stepNumber, status: 'REJECTED', reason: 'Blocked by independent safety policy.' };
    if (match) { supported++; return { stepNumber: step.stepNumber, status: 'VALIDATED', reason: 'Matches an instruction in the approved sample runbook.' }; }
    return { stepNumber: step.stepNumber, status: 'NOT_VALIDATED', reason: 'No matching runbook instruction; this recommendation is not represented as approved procedure.' };
  });
  if (stepResults.some((r) => r.status === 'REJECTED')) return { status: 'REJECTED', source: 'SIMULATED_SAMPLE_RUNBOOK', references, stepResults };
  const status = supported === steps.length ? 'VALIDATED' : supported ? 'PARTIALLY_VALIDATED' : 'NOT_VALIDATED';
  return { status, source: 'SIMULATED_SAMPLE_RUNBOOK', references, stepResults };
}
