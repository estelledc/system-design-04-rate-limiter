# Rate Limiter contributor guide

- Treat the policy file and token-bucket invariants as contracts, not suggestions.
- Keep the core deterministic: time and external stores must stay injectable.
- Never log raw API keys, Redis credentials, or partition identities.
- A fake store can prove orchestration only; distributed claims require the real Redis integration test.
- Benchmarks are environment-specific receipts, not production capacity promises.
- Add or update tests for policy, arithmetic, concurrency, failure-mode, HTTP, or Redis-script changes.
- Run `npm run check` before handoff. Run with `REDIS_URL` to include real Redis evidence.
