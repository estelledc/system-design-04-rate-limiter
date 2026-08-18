import { derivePartitionKey } from './partition-key.js';

export class RateLimiter {
  #store;
  #partitionSecret;
  #metrics;

  constructor({ store, partitionSecret, metrics }) {
    if (!store || typeof store.consume !== 'function') {
      throw new TypeError('store.consume is required');
    }
    this.#store = store;
    this.#partitionSecret = partitionSecret;
    this.#metrics = metrics;
  }

  async check({ policy, principal }) {
    const partitionKey = derivePartitionKey({
      policyId: policy.id,
      principal,
      secret: this.#partitionSecret,
    });
    const partitionFingerprint = partitionKey.slice(0, 12);

    try {
      const decision = await this.#store.consume({ key: partitionKey, policy });
      this.#metrics?.recordDecision(
        policy.id,
        decision.allowed ? 'allowed' : 'limited',
      );
      return {
        ...decision,
        degraded: false,
        unavailable: false,
        reason: decision.allowed ? 'allowed' : 'quota_exceeded',
        partitionFingerprint,
      };
    } catch {
      this.#metrics?.recordStoreError(policy.id);
      if (policy.failureMode === 'open') {
        this.#metrics?.recordDecision(policy.id, 'degraded_open');
        return {
          allowed: true,
          degraded: true,
          unavailable: false,
          reason: 'store_unavailable_fail_open',
          limit: policy.capacity,
          remaining: null,
          retryAfterMs: 0,
          resetAfterMs: null,
          partitionFingerprint,
        };
      }

      this.#metrics?.recordDecision(policy.id, 'degraded_closed');
      return {
        allowed: false,
        degraded: true,
        unavailable: true,
        reason: 'store_unavailable_fail_closed',
        limit: policy.capacity,
        remaining: null,
        retryAfterMs: 1000,
        resetAfterMs: null,
        partitionFingerprint,
      };
    }
  }
}
