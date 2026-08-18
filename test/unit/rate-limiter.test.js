import assert from 'node:assert/strict';
import test from 'node:test';

import { Metrics } from '../../src/metrics.js';
import { normalizePolicy } from '../../src/policy.js';
import { RateLimiter } from '../../src/rate-limiter.js';

const secret = 'a-secret-with-at-least-thirty-two-bytes';

function policy(failureMode) {
  return normalizePolicy({
    id: `failure-${failureMode}`,
    path: `/${failureMode}`,
    capacity: 2,
    refillTokens: 1,
    refillIntervalMs: 1000,
    failureMode,
  });
}

test('hashes the principal before sending it to the store', async () => {
  let observedKey;
  const store = {
    async consume({ key, policy: rule }) {
      observedKey = key;
      return {
        allowed: true,
        limit: rule.capacity,
        remaining: 1,
        retryAfterMs: 0,
        resetAfterMs: 1000,
      };
    },
  };
  const limiter = new RateLimiter({ store, partitionSecret: secret, metrics: new Metrics() });
  const decision = await limiter.check({ policy: policy('closed'), principal: 'secret-api-key' });

  assert.match(observedKey, /^[a-f0-9]{64}$/);
  assert.ok(!observedKey.includes('secret-api-key'));
  assert.equal(decision.partitionFingerprint, observedKey.slice(0, 12));
});

test('fail-open allows traffic but labels the decision degraded', async () => {
  const store = { async consume() { throw new Error('offline'); } };
  const limiter = new RateLimiter({ store, partitionSecret: secret, metrics: new Metrics() });
  const decision = await limiter.check({ policy: policy('open'), principal: 'valid-api-key' });
  assert.equal(decision.allowed, true);
  assert.equal(decision.degraded, true);
  assert.equal(decision.reason, 'store_unavailable_fail_open');
});

test('fail-closed returns unavailable instead of mislabeling dependency failure as quota rejection', async () => {
  const metrics = new Metrics();
  const store = { async consume() { throw new Error('offline'); } };
  const limiter = new RateLimiter({ store, partitionSecret: secret, metrics });
  const decision = await limiter.check({ policy: policy('closed'), principal: 'valid-api-key' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.unavailable, true);
  assert.equal(decision.reason, 'store_unavailable_fail_closed');
  assert.match(metrics.render(), /rate_limiter_store_errors_total\{policy="failure-closed"\} 1/);
});
