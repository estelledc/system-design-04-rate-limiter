import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePolicy, PolicyRegistry } from '../../src/policy.js';

const valid = {
  id: 'standard',
  method: 'GET',
  path: '/v1/resource',
  capacity: 10,
  refillTokens: 5,
  refillIntervalMs: 1000,
  cost: 1,
  failureMode: 'closed',
};

test('normalizes a policy and derives an idle TTL that cannot reset early', () => {
  const policy = normalizePolicy(valid);
  const timeToFullMs = Math.ceil(
    (policy.capacity * policy.refillIntervalMs) / policy.refillTokens,
  );
  assert.equal(policy.idleTtlMs, timeToFullMs * 2);
  assert.ok(Object.isFrozen(policy));
});

test('rejects an idle TTL that would refill a bucket early by expiration', () => {
  assert.throws(
    () => normalizePolicy({ ...valid, idleTtlMs: 1000 }),
    /idleTtlMs/,
  );
});

test('rejects unsafe identifiers, costs, methods, and failure modes', () => {
  assert.throws(() => normalizePolicy({ ...valid, id: '../raw-key' }), /policy.id/);
  assert.throws(() => normalizePolicy({ ...valid, cost: 11 }), /policy.cost/);
  assert.throws(() => normalizePolicy({ ...valid, method: 'POST' }), /only supports GET/);
  assert.throws(() => normalizePolicy({ ...valid, failureMode: 'maybe' }), /failureMode/);
});

test('registry matches exact method and path and rejects duplicate routes', () => {
  const registry = new PolicyRegistry([valid]);
  assert.equal(registry.match('GET', '/v1/resource')?.id, 'standard');
  assert.equal(registry.match('GET', '/v1/resource/'), null);
  assert.throws(() => new PolicyRegistry([valid, { ...valid, id: 'other' }]), /duplicate/);
});
