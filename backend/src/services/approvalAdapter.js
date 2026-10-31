/** Replace this adapter with Shaanvi's orchestration API when its contract is available. */
export class LocalReviewAdapter {
  mode = 'LOCAL_TEMPORARY';
  async submitReview({ plan, step, decision, reason, reviewer }) {
    // This records a local module review decision only. It is not an orchestration approval.
    step.review = { decision, reason, reviewer, reviewedAt: new Date() };
    if (decision === 'REJECT') step.status = 'PENDING';
    else if (decision === 'REQUEST_CHANGES') step.status = 'PENDING';
    else step.status = 'REVIEWED';
    plan.approvalIntegration = { mode: this.mode };
    return { mode: this.mode, integrated: false, message: 'Temporary local review recorded; Shaanvi workflow is not connected.' };
  }
}
