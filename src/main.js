import { createClient } from 'redis';

import { createJsonLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { RateLimiter } from './rate-limiter.js';
import { loadPolicyRegistry, loadRuntimeConfig } from './runtime-config.js';
import { closeServer, createAppServer, listen } from './server.js';
import { InMemoryTokenBucketStore } from './stores/in-memory-token-bucket.js';
import { RedisTokenBucketStore } from './stores/redis-token-bucket.js';

async function createStore(runtime, logger) {
  if (runtime.backend === 'memory') {
    return new InMemoryTokenBucketStore();
  }

  const client = createClient({
    url: runtime.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy(retries) {
        return Math.min(50 * 2 ** retries, 1000);
      },
    },
  });
  client.on('error', () => {
    logger.error('redis_client_error', { backend: 'redis' });
  });
  await client.connect();
  return new RedisTokenBucketStore({ client, closeClient: true });
}

async function main() {
  const runtime = loadRuntimeConfig();
  const logger = createJsonLogger();
  const metrics = new Metrics();
  const registry = await loadPolicyRegistry(runtime.policiesFile);
  const store = await createStore(runtime, logger);
  const limiter = new RateLimiter({
    store,
    partitionSecret: runtime.partitionSecret,
    metrics,
  });
  const server = createAppServer({ registry, limiter, store, metrics, logger });
  const address = await listen(server, runtime);

  logger.info('server_started', {
    backend: runtime.backend,
    host: typeof address === 'object' ? address.address : runtime.host,
    port: typeof address === 'object' ? address.port : runtime.port,
    policies: registry.all().map((policy) => policy.id),
    development_secret: runtime.usesDevelopmentSecret,
  });

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('server_stopping', { signal });
    await closeServer(server);
    await store.close();
    logger.info('server_stopped');
  };

  process.once('SIGINT', () => {
    stop('SIGINT').catch(() => {
      process.exitCode = 1;
    });
  });
  process.once('SIGTERM', () => {
    stop('SIGTERM').catch(() => {
      process.exitCode = 1;
    });
  });
}

main().catch(() => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'startup_failed' })}\n`);
  process.exitCode = 1;
});
