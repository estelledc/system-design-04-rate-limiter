import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from 'redis';

import { normalizePolicy } from '../../src/policy.js';
import { RedisTokenBucketStore } from '../../src/stores/redis-token-bucket.js';

const redisUrl = process.env.REDIS_URL;
const enabled = Boolean(redisUrl);

test('real Redis serializes a hot-key burst, expires state, and reloads a flushed script', {
  skip: !enabled,
  timeout: 15_000,
}, async (t) => {
  const client = createClient({ url: redisUrl, disableOfflineQueue: true });
  client.on('error', () => {});
  await client.connect();
  t.after(async () => {
    if (client.isOpen) await client.quit();
  });
  await client.flushDb();

  const policy = normalizePolicy({
    id: 'integration',
    path: '/integration',
    capacity: 10,
    refillTokens: 10,
    refillIntervalMs: 86_400_000,
    cost: 1,
    failureMode: 'closed',
  });
  const store = new RedisTokenBucketStore({ client });
  const key = 'b'.repeat(64);
  const decisions = await Promise.all(
    Array.from({ length: 100 }, () => store.consume({ key, policy })),
  );
  assert.equal(decisions.filter((decision) => decision.allowed).length, 10);
  assert.equal(decisions.filter((decision) => !decision.allowed).length, 90);

  const redisKey = `rate-limiter:{${key}}:integration`;
  const ttlMs = await client.pTTL(redisKey);
  assert.ok(ttlMs > 0 && ttlMs <= policy.idleTtlMs);

  await client.sendCommand(['SCRIPT', 'FLUSH', 'SYNC']);
  const reloaded = await store.consume({ key: 'c'.repeat(64), policy });
  assert.equal(reloaded.allowed, true);
  assert.equal(reloaded.remaining, 9);
});
