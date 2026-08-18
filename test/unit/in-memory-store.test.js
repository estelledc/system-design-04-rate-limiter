import assert from 'node:assert/strict';
import test from 'node:test';

import { ManualClock } from '../../src/clock.js';
import { normalizePolicy } from '../../src/policy.js';
import { InMemoryTokenBucketStore } from '../../src/stores/in-memory-token-bucket.js';

function policy(overrides = {}) {
  return normalizePolicy({
    id: 'test',
    path: '/test',
    capacity: 3,
    refillTokens: 1,
    refillIntervalMs: 1000,
    cost: 1,
    failureMode: 'closed',
    ...overrides,
  });
}

test('allows the initial burst, then returns an exact retry delay', async () => {
  const clock = new ManualClock(10_000);
  const store = new InMemoryTokenBucketStore({ clock });
  const rule = policy();

  assert.equal((await store.consume({ key: 'a', policy: rule })).remaining, 2);
  assert.equal((await store.consume({ key: 'a', policy: rule })).remaining, 1);
  assert.equal((await store.consume({ key: 'a', policy: rule })).remaining, 0);
  assert.deepEqual(await store.consume({ key: 'a', policy: rule }), {
    allowed: false,
    limit: 3,
    remaining: 0,
    retryAfterMs: 1000,
    resetAfterMs: 3000,
  });
});

test('preserves fractional refill credit across frequent denied requests', async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryTokenBucketStore({ clock });
  const rule = policy({ capacity: 1, refillTokens: 1, refillIntervalMs: 2000 });
  await store.consume({ key: 'a', policy: rule });

  for (let elapsed = 1; elapsed < 2000; elapsed += 1) {
    clock.advanceMs(1);
    assert.equal((await store.consume({ key: 'a', policy: rule })).allowed, false);
  }
  clock.advanceMs(1);
  assert.equal((await store.consume({ key: 'a', policy: rule })).allowed, true);
});

test('caps a long refill at capacity and does not mint tokens on clock rollback', async () => {
  const clock = new ManualClock(1000);
  const store = new InMemoryTokenBucketStore({ clock });
  const rule = policy({ capacity: 2 });
  await store.consume({ key: 'a', policy: rule });
  await store.consume({ key: 'a', policy: rule });

  clock.setMs(500);
  assert.equal((await store.consume({ key: 'a', policy: rule })).allowed, false);
  clock.setMs(1_000_000);
  const decision = await store.consume({ key: 'a', policy: rule });
  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 1);
});

test('isolates partitions and resets an expired bucket only after full-refill time', async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryTokenBucketStore({ clock });
  const rule = policy({ capacity: 1, idleTtlMs: 1000 });

  assert.equal((await store.consume({ key: 'a', policy: rule })).allowed, true);
  assert.equal((await store.consume({ key: 'a', policy: rule })).allowed, false);
  assert.equal((await store.consume({ key: 'b', policy: rule })).allowed, true);
  clock.advanceMs(1000);
  assert.equal((await store.consume({ key: 'a', policy: rule })).allowed, true);
});

test('serializes a concurrent hot-key burst without overspending', async () => {
  const store = new InMemoryTokenBucketStore({ clock: new ManualClock(0) });
  const rule = policy({ capacity: 10, refillTokens: 1, refillIntervalMs: 100_000 });
  const results = await Promise.all(
    Array.from({ length: 100 }, () => store.consume({ key: 'hot', policy: rule })),
  );
  assert.equal(results.filter((result) => result.allowed).length, 10);
  assert.equal(results.filter((result) => !result.allowed).length, 90);
});

test('sweeps expired partitions to bound idle memory', async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryTokenBucketStore({ clock });
  const rule = policy({ capacity: 1, idleTtlMs: 1000 });
  await store.consume({ key: 'a', policy: rule });
  await store.consume({ key: 'b', policy: rule });
  assert.equal(store.size(), 2);
  clock.advanceMs(1000);
  assert.equal(store.sweepExpired(), 2);
  assert.equal(store.size(), 0);
});
