import { systemClock } from '../clock.js';

export class InMemoryTokenBucketStore {
  #clock;
  #states = new Map();
  #operations = 0;

  constructor({ clock = systemClock } = {}) {
    if (!clock || typeof clock.nowMs !== 'function') {
      throw new TypeError('clock.nowMs is required');
    }
    this.#clock = clock;
  }

  async consume({ key, policy }) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }

    const observedNowMs = this.#clock.nowMs();
    if (!Number.isSafeInteger(observedNowMs) || observedNowMs < 0) {
      throw new TypeError('clock returned an invalid millisecond timestamp');
    }

    const capacityUnits = policy.capacity * policy.refillIntervalMs;
    const costUnits = policy.cost * policy.refillIntervalMs;
    let state = this.#states.get(key);

    if (!state || state.expiresAtMs <= observedNowMs) {
      state = {
        balanceUnits: capacityUnits,
        lastRefillMs: observedNowMs,
        expiresAtMs: observedNowMs + policy.idleTtlMs,
      };
    }

    // A wall clock moving backwards must not mint tokens.
    const nowMs = Math.max(observedNowMs, state.lastRefillMs);
    const maxUsefulElapsedMs = Math.ceil(capacityUnits / policy.refillTokens);
    const elapsedMs = Math.min(nowMs - state.lastRefillMs, maxUsefulElapsedMs);
    const refilledUnits = elapsedMs * policy.refillTokens;
    state.balanceUnits = Math.min(capacityUnits, state.balanceUnits + refilledUnits);
    state.lastRefillMs = nowMs;

    const allowed = state.balanceUnits >= costUnits;
    if (allowed) {
      state.balanceUnits -= costUnits;
    }

    state.expiresAtMs = nowMs + policy.idleTtlMs;
    this.#states.set(key, state);
    this.#operations += 1;
    if (this.#operations % 256 === 0) {
      this.sweepExpired(observedNowMs, 128);
    }

    const missingUnits = Math.max(0, costUnits - state.balanceUnits);
    return {
      allowed,
      limit: policy.capacity,
      remaining: Math.floor(state.balanceUnits / policy.refillIntervalMs),
      retryAfterMs: allowed ? 0 : Math.ceil(missingUnits / policy.refillTokens),
      resetAfterMs: Math.ceil(
        (capacityUnits - state.balanceUnits) / policy.refillTokens,
      ),
    };
  }

  sweepExpired(nowMs = this.#clock.nowMs(), limit = Number.POSITIVE_INFINITY) {
    let removed = 0;
    for (const [key, state] of this.#states) {
      if (removed >= limit) break;
      if (state.expiresAtMs <= nowMs) {
        this.#states.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size() {
    return this.#states.size;
  }

  async ping() {
    return true;
  }

  async close() {}
}
