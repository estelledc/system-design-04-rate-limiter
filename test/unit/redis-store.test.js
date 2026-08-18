import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePolicy } from '../../src/policy.js';
import { RedisTokenBucketStore } from '../../src/stores/redis-token-bucket.js';

const rule = normalizePolicy({
  id: 'redis-test',
  path: '/redis-test',
  capacity: 10,
  refillTokens: 5,
  refillIntervalMs: 1000,
  failureMode: 'closed',
});
const key = 'a'.repeat(64);

class FakeRedisClient {
  loads = 0;
  evaluations = [];
  failNextWithNoScript = false;
  isOpen = true;
  quitCalls = 0;

  async scriptLoad() {
    this.loads += 1;
    return `sha-${this.loads}`;
  }

  async evalSha(sha, options) {
    this.evaluations.push({ sha, options });
    if (this.failNextWithNoScript) {
      this.failNextWithNoScript = false;
      throw new Error('NOSCRIPT No matching script. Please use EVAL.');
    }
    return [1, 9, 0, 200];
  }

  async ping() {
    return 'PONG';
  }

  async quit() {
    this.quitCalls += 1;
    this.isOpen = false;
  }
}

test('loads once, evaluates one cluster-slot key, and parses the decision', async () => {
  const client = new FakeRedisClient();
  const store = new RedisTokenBucketStore({ client });
  const decision = await store.consume({ key, policy: rule });
  await store.consume({ key, policy: rule });

  assert.deepEqual(decision, {
    allowed: true,
    limit: 10,
    remaining: 9,
    retryAfterMs: 0,
    resetAfterMs: 200,
  });
  assert.equal(client.loads, 1);
  assert.equal(client.evaluations.length, 2);
  assert.deepEqual(client.evaluations[0].options.keys, [`rate-limiter:{${key}}:redis-test`]);
});

test('reloads the volatile script cache exactly once after NOSCRIPT', async () => {
  const client = new FakeRedisClient();
  const store = new RedisTokenBucketStore({ client });
  await store.consume({ key, policy: rule });
  client.failNextWithNoScript = true;
  await store.consume({ key, policy: rule });
  assert.equal(client.loads, 2);
  assert.deepEqual(client.evaluations.map((item) => item.sha), ['sha-1', 'sha-1', 'sha-2']);
});

test('coalesces concurrent NOSCRIPT recovery onto one replacement SHA', async () => {
  let releaseFailures;
  const failuresReleased = new Promise((resolve) => {
    releaseFailures = resolve;
  });
  let failedCalls = 0;
  const client = new FakeRedisClient();
  const originalEval = client.evalSha.bind(client);
  client.evalSha = async (sha, options) => {
    if (sha === 'sha-1' && failedCalls < 2) {
      failedCalls += 1;
      if (failedCalls === 2) releaseFailures();
      await failuresReleased;
      throw new Error('NOSCRIPT cache flushed');
    }
    return originalEval(sha, options);
  };
  const store = new RedisTokenBucketStore({ client });
  await Promise.all([
    store.consume({ key, policy: rule }),
    store.consume({ key: 'b'.repeat(64), policy: rule }),
  ]);
  assert.equal(client.loads, 2);
});

test('fails closed on malformed Redis replies and owns the client only when configured', async () => {
  const client = new FakeRedisClient();
  client.evalSha = async () => ['bad'];
  const store = new RedisTokenBucketStore({ client, closeClient: true });
  await assert.rejects(store.consume({ key, policy: rule }), /invalid reply/);
  await store.close();
  assert.equal(client.quitCalls, 1);
});
