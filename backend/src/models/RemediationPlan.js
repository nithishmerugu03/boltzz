const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  stepNumber: { type: Number, required: true }, title: { type: String, required: true },
  description: { type: String, required: true }, reason: { type: String, required: true },
  expectedOutcome: { type: String, required: true }, prerequisites: { type: [String], default: [] },
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], required: true },
  requiresApproval: { type: Boolean, required: true }, actionType: { type: String, enum: ['DIAGNOSTIC', 'CONFIGURATION', 'OPERATIONAL', 'ROLLBACK', 'DATABASE_CHANGE'], required: true },
  status: { type: String, enum: ['PENDING', 'REVIEWED', 'COMPLETED'], default: 'PENDING' },
  safetyStatus: { type: String, enum: ['ALLOWED', 'FLAGGED', 'BLOCKED'], default: 'ALLOWED' },
  review: { decision: String, reason: String, reviewer: String, reviewedAt: Date }
}, { _id: true });

const planSchema = new mongoose.Schema({
  incidentId: { type: String, required: true, index: true }, rcaReference: String,
  incident: { severity: String, title: String }, rootCause: { type: String, required: true }, evidence: [String],
  recommendations: [String], steps: { type: [stepSchema], default: [] },
  safetyWarnings: [String], runbookValidation: mongoose.Schema.Types.Mixed,
  overallStatus: { type: String, enum: ['AWAITING_REVIEW', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'], default: 'AWAITING_REVIEW' },
  generation: { provider: String, model: String, fallbackUsed: Boolean },
  approvalIntegration: { mode: { type: String, default: 'LOCAL_TEMPORARY' }, externalReference: String },
  auditReferences: [String]
}, { timestamps: true, minimize: false });

module.exports = mongoose.models.RemediationPlan || mongoose.model('RemediationPlan', planSchema);
