import assert from 'node:assert/strict';
import test from 'node:test';

import { createJsonLogger } from '../../src/logger.js';
import { Metrics } from '../../src/metrics.js';
import { PolicyRegistry } from '../../src/policy.js';
import { RateLimiter } from '../../src/rate-limiter.js';
import { closeServer, createAppServer, listen } from '../../src/server.js';
import { InMemoryTokenBucketStore } from '../../src/stores/in-memory-token-bucket.js';

const secret = 'http-test-secret-with-at-least-32-bytes';

function rawPolicy(overrides = {}) {
  return {
    id: 'standard',
    method: 'GET',
    path: '/v1/resource',
    capacity: 2,
    refillTokens: 1,
    refillIntervalMs: 10_000,
    cost: 1,
    failureMode: 'closed',
    ...overrides,
  };
}

async function fixture(t, { rawPolicies = [rawPolicy()], store } = {}) {
  const registry = new PolicyRegistry(rawPolicies);
  const metrics = new Metrics();
  const lines = [];
  const logger = createJsonLogger({ sink: (line) => lines.push(line) });
  const effectiveStore = store ?? new InMemoryTokenBucketStore();
  const limiter = new RateLimiter({
    store: effectiveStore,
    partitionSecret: secret,
    metrics,
  });
  const server = createAppServer({
    registry,
    limiter,
    store: effectiveStore,
    metrics,
    logger,
  });
  const address = await listen(server, { host: '127.0.0.1', port: 0 });
  t.after(() => closeServer(server));
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    lines,
  };
}

test('requires a trusted API key without echoing it to logs', async (t) => {
  const app = await fixture(t);
  const missing = await fetch(`${app.baseUrl}/v1/resource`);
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: 'valid_x_api_key_required' });

  const rawKey = 'top-secret-api-key';
  const accepted = await fetch(`${app.baseUrl}/v1/resource`, {
    headers: { 'x-api-key': rawKey },
  });
  assert.equal(accepted.status, 200);
  assert.ok(app.lines.every((line) => !line.includes(rawKey)));
  assert.match(app.lines.at(-1), /"partition":"[a-f0-9]{12}"/);
});

test('allows the configured burst then returns RFC 6585 429 and Retry-After', async (t) => {
  const app = await fixture(t);
  const headers = { 'x-api-key': 'burst-client-key' };
  assert.equal((await fetch(`${app.baseUrl}/v1/resource`, { headers })).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/v1/resource`, { headers })).status, 200);

  const limited = await fetch(`${app.baseUrl}/v1/resource`, { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '10');
  assert.equal(limited.headers.get('cache-control'), 'no-store');
  assert.equal(limited.headers.get('ratelimit'), null);
  assert.deepEqual(await limited.json(), {
    error: 'rate_limited',
    policy: 'standard',
    retry_after_seconds: 10,
  });
});

test('exposes liveness, readiness, and aggregate metrics without identities', async (t) => {
  const app = await fixture(t);
  assert.equal((await fetch(`${app.baseUrl}/health/live`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/health/ready`)).status, 200);
  await fetch(`${app.baseUrl}/v1/resource`, {
    headers: { 'x-api-key': 'metrics-client-key' },
  });
  const metrics = await (await fetch(`${app.baseUrl}/metrics`)).text();
  assert.match(metrics, /rate_limiter_decisions_total\{policy="standard",outcome="allowed"\} 1/);
  assert.ok(!metrics.includes('metrics-client-key'));
});

test('maps fail-closed store errors to 503, not 429', async (t) => {
  const store = {
    async consume() { throw new Error('offline'); },
    async ping() { return false; },
  };
  const app = await fixture(t, { store });
  const response = await fetch(`${app.baseUrl}/v1/resource`, {
    headers: { 'x-api-key': 'closed-client-key' },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '1');
  assert.deepEqual(await response.json(), {
    error: 'rate_limiter_unavailable',
    policy: 'standard',
  });
  assert.equal((await fetch(`${app.baseUrl}/health/ready`)).status, 503);
});

test('makes fail-open degradation visible in a successful response', async (t) => {
  const store = {
    async consume() { throw new Error('offline'); },
    async ping() { return false; },
  };
  const app = await fixture(t, {
    store,
    rawPolicies: [rawPolicy({ failureMode: 'open' })],
  });
  const response = await fetch(`${app.baseUrl}/v1/resource`, {
    headers: { 'x-api-key': 'open-client-key' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    policy: 'standard',
    degraded: true,
  });
});

test('uses a bounded unmatched metric label for arbitrary paths', async (t) => {
  const app = await fixture(t);
  assert.equal((await fetch(`${app.baseUrl}/attacker-controlled-value`)).status, 404);
  const metrics = await (await fetch(`${app.baseUrl}/metrics`)).text();
  assert.match(metrics, /route="unmatched",status="404"/);
  assert.ok(!metrics.includes('attacker-controlled-value'));
});
