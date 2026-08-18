const POLICY_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_CAPACITY = 1_000_000;
const MAX_INTERVAL_MS = 86_400_000;
const MAX_IDLE_TTL_MS = 7 * 86_400_000;

function requirePlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function requireSafeInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

export function normalizePolicy(raw) {
  requirePlainObject(raw, 'policy');

  if (typeof raw.id !== 'string' || !POLICY_ID.test(raw.id)) {
    throw new TypeError('policy.id must match /^[a-z][a-z0-9-]{0,63}$/');
  }

  const method = raw.method ?? 'GET';
  if (method !== 'GET') {
    throw new TypeError('this vertical slice only supports GET policies');
  }

  if (typeof raw.path !== 'string' || !raw.path.startsWith('/') || raw.path.includes('?')) {
    throw new TypeError('policy.path must be an absolute path without a query string');
  }

  const capacity = requireSafeInteger(raw.capacity, 'policy.capacity', 1, MAX_CAPACITY);
  const refillTokens = requireSafeInteger(
    raw.refillTokens,
    'policy.refillTokens',
    1,
    MAX_CAPACITY,
  );
  const refillIntervalMs = requireSafeInteger(
    raw.refillIntervalMs,
    'policy.refillIntervalMs',
    1,
    MAX_INTERVAL_MS,
  );
  const cost = requireSafeInteger(raw.cost ?? 1, 'policy.cost', 1, capacity);
  const failureMode = raw.failureMode ?? 'closed';
  if (failureMode !== 'open' && failureMode !== 'closed') {
    throw new TypeError('policy.failureMode must be "open" or "closed"');
  }

  const capacityUnits = capacity * refillIntervalMs;
  if (!Number.isSafeInteger(capacityUnits)) {
    throw new TypeError('capacity * refillIntervalMs must stay within safe integer range');
  }

  const timeToFullMs = Math.ceil(capacityUnits / refillTokens);
  const defaultIdleTtlMs = Math.min(
    MAX_IDLE_TTL_MS,
    Math.max(1000, timeToFullMs * 2),
  );
  const idleTtlMs = requireSafeInteger(
    raw.idleTtlMs ?? defaultIdleTtlMs,
    'policy.idleTtlMs',
    timeToFullMs,
    MAX_IDLE_TTL_MS,
  );

  return Object.freeze({
    id: raw.id,
    method,
    path: raw.path,
    capacity,
    refillTokens,
    refillIntervalMs,
    cost,
    failureMode,
    idleTtlMs,
  });
}

export class PolicyRegistry {
  #byRoute = new Map();
  #all;

  constructor(rawPolicies) {
    if (!Array.isArray(rawPolicies) || rawPolicies.length === 0) {
      throw new TypeError('at least one policy is required');
    }

    this.#all = rawPolicies.map(normalizePolicy);
    for (const policy of this.#all) {
      const route = `${policy.method} ${policy.path}`;
      if (this.#byRoute.has(route)) {
        throw new TypeError(`duplicate policy route: ${route}`);
      }
      this.#byRoute.set(route, policy);
    }
    Object.freeze(this.#all);
  }

  match(method, path) {
    return this.#byRoute.get(`${method} ${path}`) ?? null;
  }

  all() {
    return [...this.#all];
  }
}
