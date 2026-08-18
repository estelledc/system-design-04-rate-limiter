import { performance } from 'node:perf_hooks';

import { ManualClock } from '../src/clock.js';
import { normalizePolicy } from '../src/policy.js';
import { InMemoryTokenBucketStore } from '../src/stores/in-memory-token-bucket.js';

const iterations = 100_000;
const policy = normalizePolicy({
  id: 'benchmark',
  path: '/benchmark',
  capacity: iterations,
  refillTokens: 1,
  refillIntervalMs: 1000,
  cost: 1,
  failureMode: 'closed',
});
const store = new InMemoryTokenBucketStore({ clock: new ManualClock(1_000_000) });
const key = 'a'.repeat(64);

const startedAt = performance.now();
let allowed = 0;
for (let index = 0; index < iterations; index += 1) {
  if ((await store.consume({ key, policy })).allowed) allowed += 1;
}
const elapsedMs = performance.now() - startedAt;

if (allowed !== iterations) {
  throw new Error(`benchmark invariant failed: ${allowed}/${iterations} allowed`);
}

process.stdout.write(`${JSON.stringify({
  kind: 'local_in_memory_receipt',
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  iterations,
  elapsed_ms: Number(elapsedMs.toFixed(3)),
  decisions_per_second: Math.round(iterations / (elapsedMs / 1000)),
  claim_boundary: 'single-process hot-key loop; not a production throughput claim',
})}\n`);
