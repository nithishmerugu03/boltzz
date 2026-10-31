import mongoose from 'mongoose';

const timelineEventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    timestamp: { type: String, required: true },
    type: { type: String, default: 'event' },
    level: { type: String, default: 'info' },
    source: { type: String, default: 'monitoring' },
    message: { type: String, default: '' },
    service: { type: String, default: 'unknown' },
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    severity: { type: String, default: 'medium' },
    status: { type: String, default: 'open' },
    source: { type: String, default: 'monitoring' },
    service: { type: String, default: 'unknown' },
    owner: { type: String, default: 'oncall' },
    summary: { type: String, default: 'No summary provided.' },
    impact: { type: String, default: 'No impact reported.' },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },
    correlationKey: { type: String, default: 'unknown' },
    timeline: [timelineEventSchema],
  },
  { collection: 'incidents' }
);

const alertSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    incidentId: { type: String, required: true },
    ruleId: { type: String, default: 'monitoring-threshold' },
    severity: { type: String, default: 'medium' },
    status: { type: String, default: 'open' },
    source: { type: String, default: 'monitoring' },
    description: { type: String, default: '' },
    createdAt: { type: String, default: () => new Date().toISOString() },
    acknowledgedAt: { type: String, default: null },
    resolvedAt: { type: String, default: null },
  },
  { collection: 'alerts' }
);

const monitoringEventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    timestamp: { type: String, default: () => new Date().toISOString() },
    source: { type: String, default: 'monitoring' },
    service: { type: String, default: 'unknown' },
    type: { type: String, default: 'event' },
    level: { type: String, default: 'info' },
    message: { type: String, default: 'Monitoring event received.' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    incidentId: { type: String, default: null },
  },
  { collection: 'monitoring_events' }
);

export const Incident = mongoose.models.Incident || mongoose.model('Incident', incidentSchema);
export const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
export const MonitoringEvent = mongoose.models.MonitoringEvent || mongoose.model('MonitoringEvent', monitoringEventSchema);

export default { Incident, Alert, MonitoringEvent };
