import test from 'node:test';
import assert from 'node:assert/strict';

import MonitoringService from '../src/services/monitoringService.js';

test('MonitoringService exposes persistence status for the monitoring module', () => {
  const service = new MonitoringService();
  const status = service.getPersistenceStatus();

  assert.equal(status.databaseEnabled, false);
  assert.equal(status.collectionCount, 3);
  assert.equal(status.totalIncidents, 2);
  assert.equal(status.totalAlerts, 1);
});

test('MonitoringService normalizes and stores ingested incidents in memory', () => {
  const service = new MonitoringService();
  const { incident, alert } = service.ingestIncident({
    title: 'Checkout timeout burst',
    severity: 'critical',
    service: 'checkout-api',
    owner: 'payments-team',
    summary: 'Timeouts detected during product purchase flow.',
    impact: 'Customers cannot complete orders.'
  });

  assert.equal(incident.service, 'checkout-api');
  assert.equal(incident.severity, 'critical');
  assert.equal(alert.incidentId, incident.id);
  assert.equal(service.getIncidentsById(incident.id)?.title, 'Checkout timeout burst');
});
