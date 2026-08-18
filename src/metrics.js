function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function labelValue(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"');
}

export class Metrics {
  #decisions = new Map();
  #storeErrors = new Map();
  #httpRequests = new Map();
  #durationCount = 0;
  #durationSumMs = 0;

  recordDecision(policyId, outcome) {
    increment(this.#decisions, `${policyId}\0${outcome}`);
  }

  recordStoreError(policyId) {
    increment(this.#storeErrors, policyId);
  }

  recordHttp(route, statusCode, durationMs) {
    increment(this.#httpRequests, `${route}\0${statusCode}`);
    this.#durationCount += 1;
    this.#durationSumMs += durationMs;
  }

  render() {
    const lines = [
      '# HELP rate_limiter_decisions_total Token bucket decisions by policy and outcome.',
      '# TYPE rate_limiter_decisions_total counter',
    ];

    for (const [key, value] of [...this.#decisions].sort()) {
      const [policy, outcome] = key.split('\0');
      lines.push(
        `rate_limiter_decisions_total{policy="${labelValue(policy)}",outcome="${labelValue(outcome)}"} ${value}`,
      );
    }

    lines.push(
      '# HELP rate_limiter_store_errors_total Store operations that failed.',
      '# TYPE rate_limiter_store_errors_total counter',
    );
    for (const [policy, value] of [...this.#storeErrors].sort()) {
      lines.push(`rate_limiter_store_errors_total{policy="${labelValue(policy)}"} ${value}`);
    }

    lines.push(
      '# HELP rate_limiter_http_requests_total HTTP responses by route and status.',
      '# TYPE rate_limiter_http_requests_total counter',
    );
    for (const [key, value] of [...this.#httpRequests].sort()) {
      const [route, status] = key.split('\0');
      lines.push(
        `rate_limiter_http_requests_total{route="${labelValue(route)}",status="${labelValue(status)}"} ${value}`,
      );
    }

    lines.push(
      '# HELP rate_limiter_http_request_duration_ms HTTP request duration in milliseconds.',
      '# TYPE rate_limiter_http_request_duration_ms summary',
      `rate_limiter_http_request_duration_ms_count ${this.#durationCount}`,
      `rate_limiter_http_request_duration_ms_sum ${this.#durationSumMs.toFixed(3)}`,
      '',
    );
    return lines.join('\n');
  }
}
