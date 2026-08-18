# ADR 0001: Token Bucket with integer units and one-key Redis Lua

- Status: Accepted
- Date: 2026-08-18

## Context

The exercise needs to permit short bursts, bound the long-run rate, work across
multiple service instances, and make boundary behavior deterministic enough to
test. A read followed by a client-side write can double-spend tokens under
concurrency. Floating token arithmetic and resetting refill time on every
request can also create hard-to-see drift or starvation.

## Decision

Use a Token Bucket whose balance is stored as integer interval units. For the
distributed backend, perform server time lookup, refill, decision, deduction,
state write, and TTL refresh in one short Lua script touching one Redis key.

Use `SCRIPT LOAD` + `EVALSHA` in the application and recover once from
`NOSCRIPT`. Keep a deterministic in-memory implementation with the same
contract for local reasoning and fast tests.

## Alternatives considered

### Fixed window counter

Simple and memory-efficient, but a client can spend nearly twice the nominal
quota across a window boundary. This does not match the chosen “bounded burst +
steady average” behavior.

### Sliding log

Strict over a rolling window, but retains one timestamp per accepted request.
That cost is unnecessary for the selected contract.

### Sliding window counter

Lower state than a log, but approximate. It is useful when a rolling-window
quota is the actual product contract, which it is not here.

### Client-side Redis transaction

`WATCH` / retry loops can be correct but add contention-sensitive retries and
more network round trips on the hot path. A one-key, constant-time script gives
a smaller atomic boundary.

### Distributed lock around read/write

A lock adds its own expiry, ownership, recovery, and fencing problems. Redis
already provides atomic script execution for this bounded operation.

## Consequences

- Bursts up to capacity are allowed by design.
- One Redis request is required for every distributed decision.
- The Lua script blocks Redis while executing, so it must stay bounded and
  free of scans, loops over user data, or network calls.
- Script cache volatility becomes an application responsibility.
- Strict global multi-region quotas remain unresolved.
- The memory backend is behaviorally useful but cannot prove distributed
  safety.
