# Threat model

## Assets

- downstream availability and cost budget;
- correctness of each principal's quota balance;
- API keys and HMAC secret;
- Redis credentials and network location;
- operational metrics that reveal capacity or incident state.

## Trust boundaries

1. client to authentication gateway;
2. trusted gateway to this limiter;
3. limiter process to Redis;
4. limiter telemetry to the monitoring system.

This repository implements boundaries 2–4 only partially. It does not provide
authentication, TLS termination, secret storage, Redis ACL provisioning, or
network policy.

## Threats and controls

| Threat | Current control | Residual risk / production action |
|---|---|---|
| Raw key exposure in Redis or logs | HMAC-SHA256 partition; no raw headers in telemetry | Protect and rotate `PARTITION_HMAC_SECRET`; rotation changes every partition and needs a deliberate migration |
| Attacker creates unlimited identities | None beyond key syntax | Authenticate first; bind quotas to account / tenant; add coarse IP / global overload protection |
| High-cardinality path or identity metrics | fixed policy labels; unmatched paths collapse | Keep metrics endpoint private and audit every new label |
| Redis read-modify-write race | one atomic Lua script | Real correctness still depends on one authoritative key and Redis availability |
| Malicious client time | Redis backend uses server `TIME` | Redis host clock jumps can still affect refill; monitor NTP and clock anomalies |
| Slow script blocks Redis | constant-time one-key script | Track script latency; reject future loops, scans, or cross-key aggregation |
| Script cache flush / failover | one bounded single-flight reload | Repeated cache loss becomes store failure; alert instead of retrying forever |
| Redis outage | explicit per-policy fail mode | Fail-open risks overload; fail-closed risks availability. Owner must choose from business impact |
| State memory exhaustion | TTL; validated key and policy lengths | Sybil traffic can keep many keys hot; enforce upstream identity and Redis memory / eviction policy |
| Metrics reveal capacity | no quota values or identities in metrics | Restrict `/metrics`; consider separate listener before production |
| Dependency or action compromise | exact npm lock; pinned Action commits; minimal Actions permission | Review Dependabot updates and container-digest changes; generate SBOM if this becomes a shipped service |
| Limiter bypass | server-side placement assumption | Network policy must prevent direct access to protected services |

## Abuse boundary

Rate limiting reduces load after a request reaches the limiter. It does not stop
connection floods, TLS handshakes, large headers, or bandwidth exhaustion in
front of the process. CDN, load balancer, kernel, and gateway limits remain
separate controls.
