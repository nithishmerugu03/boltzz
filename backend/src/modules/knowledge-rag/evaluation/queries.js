'use strict';

// Hand-written smoke-test relevance labels. Not a representative production benchmark.
module.exports = [
  ['Payment requests fail because database connections never get returned after errors', 'HIST-001'],
  ['Catalog category lookup scans every database document and is slow', 'HIST-002'],
  ['Database rejects billing credentials immediately after password rotation', 'HIST-005'],
  ['Redelivered messages cause duplicate event inserts in fulfilment', 'HIST-006'],
  ['Stock reads return an older value from a lagging replica', 'HIST-007'],
  ['Generating a report freezes other HTTP requests and health checks', 'HIST-009'],
  ['Checkout waits too long for the shipping provider and times out', 'HIST-010'],
  ['Bulk JSON imports fail with HTTP 413 but smaller requests work', 'HIST-013'],
  ['New pods cannot download a container image because the tag is absent', 'HIST-017'],
  ['Readiness probe returns 404 after the health route changed', 'HIST-018'],
  ['Large CSV imports kill the worker after exceeding its memory limit', 'HIST-022'],
  ['Gateway exhausts open file handles because sockets are not closed', 'HIST-025'],
  ['JWT tokens are not yet active on a server with the wrong time', 'HIST-027'],
  ['HTTPS requests fail because the remote certificate expired', 'HIST-030'],
  ['Browser preflight blocks the frontend origin from calling the API', 'HIST-033'],
  ['Many failed password attempts across different user accounts', 'HIST-035'],
  ['Changing an incident identifier exposes another tenant records', 'HIST-039'],
  ['User provided preview URLs can reach private internal network services', 'HIST-040'],
].map(([query, incidentId]) => ({ query, incidentId }));
