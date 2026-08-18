import { readFileSync } from 'node:fs';

const DEFAULT_SCRIPT = readFileSync(
  new URL('./token-bucket.lua', import.meta.url),
  'utf8',
);

function isNoScriptError(error) {
  return error instanceof Error && /^NOSCRIPT\b/.test(error.message);
}

function parseDecision(reply) {
  if (!Array.isArray(reply) || reply.length !== 4) {
    throw new TypeError('Redis token bucket returned an invalid reply');
  }

  const values = reply.map(Number);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError('Redis token bucket returned non-integer values');
  }

  return {
    allowed: values[0] === 1,
    remaining: values[1],
    retryAfterMs: values[2],
    resetAfterMs: values[3],
  };
}

export class RedisTokenBucketStore {
  #client;
  #prefix;
  #script;
  #sha = null;
  #loading = null;
  #closeClient;

  constructor({
    client,
    prefix = 'rate-limiter:',
    script = DEFAULT_SCRIPT,
    closeClient = false,
  }) {
    if (!client || typeof client.scriptLoad !== 'function' || typeof client.evalSha !== 'function') {
      throw new TypeError('a connected node-redis compatible client is required');
    }
    if (typeof prefix !== 'string' || prefix.length === 0 || prefix.length > 64) {
      throw new TypeError('prefix must contain 1-64 characters');
    }
    if (typeof script !== 'string' || script.trim().length === 0) {
      throw new TypeError('script must be non-empty');
    }

    this.#client = client;
    this.#prefix = prefix;
    this.#script = script;
    this.#closeClient = closeClient;
  }

  async #loadScript() {
    if (this.#sha) return this.#sha;
    if (!this.#loading) {
      this.#loading = this.#client.scriptLoad(this.#script)
        .then((sha) => {
          if (typeof sha !== 'string' || sha.length === 0) {
            throw new TypeError('Redis SCRIPT LOAD returned an invalid SHA');
          }
          this.#sha = sha;
          return sha;
        })
        .finally(() => {
          this.#loading = null;
        });
    }
    return this.#loading;
  }

  async #evaluate(sha, redisKey, policy) {
    return this.#client.evalSha(sha, {
      keys: [redisKey],
      arguments: [
        String(policy.capacity),
        String(policy.refillTokens),
        String(policy.refillIntervalMs),
        String(policy.cost),
        String(policy.idleTtlMs),
      ],
    });
  }

  async consume({ key, policy }) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) {
      throw new TypeError('key must be a SHA-256 hex partition key');
    }

    // Braces make the HMAC partition the explicit Redis Cluster hash tag.
    const redisKey = `${this.#prefix}{${key}}:${policy.id}`;
    let sha = await this.#loadScript();
    let reply;
    try {
      reply = await this.#evaluate(sha, redisKey, policy);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      // Another request may already have reloaded after the same failed SHA.
      if (this.#sha === sha) this.#sha = null;
      sha = await this.#loadScript();
      reply = await this.#evaluate(sha, redisKey, policy);
    }

    return {
      limit: policy.capacity,
      ...parseDecision(reply),
    };
  }

  async ping() {
    return (await this.#client.ping()) === 'PONG';
  }

  async close() {
    if (this.#closeClient && this.#client.isOpen) {
      await this.#client.quit();
    }
  }
}
