import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

import { validatePrincipal } from './partition-key.js';

function sendJson(response, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

function getSingleHeader(request, name) {
  const distinct = request.headersDistinct?.[name];
  if (distinct) return distinct.length === 1 ? distinct[0] : null;
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}

async function withTimeout(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('operation timed out')), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createAppServer({ registry, limiter, store, metrics, logger }) {
  if (!registry || !limiter || !store || !metrics || !logger) {
    throw new TypeError('registry, limiter, store, metrics, and logger are required');
  }

  const server = createServer(async (request, response) => {
    const startedAt = performance.now();
    const requestId = randomUUID();
    response.setHeader('x-request-id', requestId);
    let routeLabel = 'unmatched';
    let statusCode = 500;
    let policyId;
    let outcome = 'internal_error';
    let partitionFingerprint;

    try {
      const url = new URL(request.url ?? '/', 'http://rate-limiter.local');
      const method = request.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/health/live') {
        routeLabel = 'health_live';
        statusCode = 200;
        outcome = 'live';
        sendJson(response, statusCode, { status: 'ok' });
        return;
      }

      if (method === 'GET' && url.pathname === '/health/ready') {
        routeLabel = 'health_ready';
        const ready = await withTimeout(store.ping(), 1000).catch(() => false);
        statusCode = ready ? 200 : 503;
        outcome = ready ? 'ready' : 'not_ready';
        sendJson(response, statusCode, { status: outcome });
        return;
      }

      if (method === 'GET' && url.pathname === '/metrics') {
        routeLabel = 'metrics';
        statusCode = 200;
        outcome = 'metrics';
        const payload = metrics.render();
        response.writeHead(statusCode, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
        });
        response.end(payload);
        return;
      }

      const policy = registry.match(method, url.pathname);
      if (!policy) {
        statusCode = 404;
        outcome = 'not_found';
        sendJson(response, statusCode, { error: 'not_found' });
        return;
      }

      policyId = policy.id;
      routeLabel = policy.id;
      const principal = getSingleHeader(request, 'x-api-key');
      try {
        validatePrincipal(principal);
      } catch {
        statusCode = 401;
        outcome = 'invalid_identity';
        sendJson(response, statusCode, { error: 'valid_x_api_key_required' });
        return;
      }

      const decision = await limiter.check({ policy, principal });
      partitionFingerprint = decision.partitionFingerprint;
      outcome = decision.reason;

      if (decision.unavailable) {
        statusCode = 503;
        sendJson(
          response,
          statusCode,
          { error: 'rate_limiter_unavailable', policy: policy.id },
          { 'retry-after': String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))) },
        );
        return;
      }

      if (!decision.allowed) {
        statusCode = 429;
        const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
        sendJson(
          response,
          statusCode,
          {
            error: 'rate_limited',
            policy: policy.id,
            retry_after_seconds: retryAfterSeconds,
          },
          { 'retry-after': String(retryAfterSeconds) },
        );
        return;
      }

      statusCode = 200;
      sendJson(response, statusCode, {
        ok: true,
        policy: policy.id,
        degraded: decision.degraded,
      });
    } catch {
      statusCode = 500;
      outcome = 'internal_error';
      if (!response.headersSent) {
        sendJson(response, statusCode, { error: 'internal_error' });
      } else {
        response.destroy();
      }
    } finally {
      const durationMs = performance.now() - startedAt;
      metrics.recordHttp(routeLabel, statusCode, durationMs);
      logger.info('http_request', {
        request_id: requestId,
        route: routeLabel,
        policy: policyId,
        status: statusCode,
        outcome,
        partition: partitionFingerprint,
        duration_ms: Number(durationMs.toFixed(3)),
      });
    }
  });

  server.requestTimeout = 5000;
  server.headersTimeout = 6000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  return server;
}

export function listen(server, { host, port }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
