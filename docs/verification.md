# Verification evidence and boundaries

## Executable matrix

| Claim | Evidence | Local | GitHub Actions |
|---|---|---|---|
| burst cannot spend more than capacity | deterministic hot-key concurrency test | yes | yes |
| fractional refill credit is preserved | 2,000 one-millisecond denied checks | yes | yes |
| clock rollback does not mint tokens | manual-clock boundary test | yes | yes |
| idle state is removed without early refill | TTL validation + memory expiry test | yes | yes |
| raw key does not reach store / logs / metrics | HMAC and HTTP assertions | yes | yes |
| script cache loss reloads once | fake client sequential + concurrent `NOSCRIPT` tests | yes | yes |
| Redis serializes 100 concurrent decisions | real Redis Lua integration test | skipped without Redis | required |
| Redis state receives TTL | real `PTTL` assertion | skipped without Redis | required |
| 429 / Retry-After / no-store semantics | HTTP end-to-end test | yes | yes |
| store failure stays distinct from quota | fail-open / fail-closed unit and HTTP tests | yes | yes |
| production entrypoint starts, limits, hides identity, and exits cleanly | child-process runtime smoke | yes | yes |
| dependency graph has no known high vulnerability | `npm audit --audit-level=high` | network required | required |

## Commands

```bash
npm ci --ignore-scripts
npm run lint
npm test
npm run benchmark
npm audit --audit-level=high
```

With a disposable Redis instance:

```bash
REDIS_URL=redis://127.0.0.1:6379 npm run test:integration
```

## Current local receipt

On 2026-08-18, macOS arm64 with Node v26.7.0 produced:

- syntax and JSON parsing passed;
- 23 tests passed and 1 real-Redis test skipped because no local Redis server
  was installed;
- 100,000 in-memory hot-key decisions preserved the acceptance invariant;
- `npm audit` reported 0 known vulnerabilities.

The benchmark prints its own elapsed time and environment on every run. This
page intentionally does not freeze the observed decisions/second as a product
claim.

## First remote Redis receipt

The implementation commit
[`2b99ca2089c4fce99ed14f11d716ac9cfb027513`](https://github.com/estelledc/system-design-04-rate-limiter/commit/2b99ca2089c4fce99ed14f11d716ac9cfb027513)
was verified by [GitHub Actions run 32145401570](https://github.com/estelledc/system-design-04-rate-limiter/actions/runs/32145401570)
on 2026-08-18:

- Node 22 + Redis 7.4: 24 passed, 0 skipped;
- Node 24 + Redis 7.4: 24 passed, 0 skipped;
- Node 26 + Redis 7.4: 24 passed, 0 skipped;
- runtime smoke and dependency audit passed in all three jobs.

This is evidence for the pinned Linux runner workflow and Redis container
digest in that commit. It is not a Redis Cluster, failover, multi-region, load,
deployment, or external-user receipt.

## Not proven

- no production traffic, cross-host latency, Redis cluster, failover, replica,
  multi-region, TLS, ACL, or secret-manager test has run;
- GitHub Actions proves an ephemeral Linux runner plus one Redis container, not
  deployment or external acceptance;
- the test suite samples many important boundaries but is not a formal proof of
  all JavaScript, Redis, network, or configuration behavior;
- no real DDoS, cost, fairness, tenant-isolation, or user-experience outcome has
  been measured;
- implementation by an agent and green tests are not evidence that the user can
  independently reproduce the design in an interview or production review.
