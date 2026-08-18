# Operations runbook

## Startup

Memory mode is for local use:

```bash
npm start
```

Redis mode requires `STORE_BACKEND=redis`, `REDIS_URL`, and a secret-manager
value in `PARTITION_HMAC_SECRET`. The process fails startup if it cannot make
the initial Redis connection. Do not put credentials in command history in a
real environment; inject them through the runtime secret mechanism.

## Health

| Endpoint | Meaning | Does not prove |
|---|---|---|
| `/health/live` | event loop can serve the handler | Redis or protected downstream is usable |
| `/health/ready` | active store answered within one second | quota correctness across regions or production SLA |
| `/metrics` | in-process counters can be rendered | monitoring scraped or alerted successfully |

Protect health and metrics with network policy. They share the demo listener
only to keep the vertical slice runnable.

## Candidate alerts

- `rate_limiter_store_errors_total` increases for any policy;
- `degraded_open` is non-zero: protected traffic is bypassing quota checks;
- `degraded_closed` is non-zero: legitimate traffic may receive `503`;
- `limited / (allowed + limited)` changes sharply from its normal baseline;
- readiness fails on multiple instances;
- Redis command or Lua latency approaches the request-path budget;
- active partition count or Redis memory grows without traffic growth.

No numeric threshold is hard-coded here because the repository has no real
traffic baseline.

## Incident steps

### Redis errors

1. Separate startup connectivity, command timeout, `NOSCRIPT`, malformed reply,
   and Redis resource saturation.
2. Confirm whether affected routes are fail-open or fail-closed before changing
   policy; the user impact is opposite.
3. Check Redis health, latency, memory, evictions, replication, cluster slots,
   and recent script / configuration changes.
4. Do not add an unbounded retry loop on the synchronous request path.
5. After recovery, reconcile degraded intervals from metrics and upstream logs;
   this limiter has no billing ledger to reconstruct exact bypassed requests.

### Unexpected `429` spike

1. Verify the policy version and trusted identity input.
2. Check whether one tenant or route is hot, rather than raising every quota.
3. Confirm server clock health and Redis key TTL.
4. Reproduce with a fixed policy and known principal before changing capacity.

### Memory growth

1. Measure active partition count and key TTL distribution.
2. Look for rotating / unauthenticated identities.
3. Confirm TTL is not shorter than full-refill time and is actually present.
4. Add upstream identity controls before relying on eviction to hide abuse.

## Shutdown and rollback

`SIGINT` and `SIGTERM` stop accepting new connections, wait for active HTTP
handlers, then close the store. A rollback is an application-version rollback;
the persisted Redis hash schema (`balance_units`, `last_refill_ms`) must remain
compatible or use a new key prefix. Deleting keys resets buckets full and is a
product behavior change, not harmless cache cleanup.
