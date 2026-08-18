import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { requirePartitionSecret } from './partition-key.js';
import { PolicyRegistry } from './policy.js';

const DEVELOPMENT_SECRET = 'local-development-only-secret-change-me';

function parsePort(value) {
  const port = Number(value ?? 8080);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('PORT must be an integer between 0 and 65535');
  }
  return port;
}

export async function loadPolicyRegistry(
  path = fileURLToPath(new URL('../config/policies.json', import.meta.url)),
) {
  const source = await readFile(path, 'utf8');
  const raw = JSON.parse(source);
  return new PolicyRegistry(raw);
}

export function loadRuntimeConfig(env = process.env) {
  const backend = env.STORE_BACKEND ?? 'memory';
  if (backend !== 'memory' && backend !== 'redis') {
    throw new TypeError('STORE_BACKEND must be "memory" or "redis"');
  }

  if (backend === 'redis' && !env.REDIS_URL) {
    throw new TypeError('REDIS_URL is required when STORE_BACKEND=redis');
  }
  if (backend === 'redis' && !env.PARTITION_HMAC_SECRET) {
    throw new TypeError('PARTITION_HMAC_SECRET is required when STORE_BACKEND=redis');
  }

  const partitionSecret = requirePartitionSecret(
    env.PARTITION_HMAC_SECRET ?? DEVELOPMENT_SECRET,
  );

  return Object.freeze({
    backend,
    redisUrl: env.REDIS_URL ?? null,
    partitionSecret,
    usesDevelopmentSecret: !env.PARTITION_HMAC_SECRET,
    host: env.HOST ?? '127.0.0.1',
    port: parsePort(env.PORT),
    policiesFile: env.POLICIES_FILE,
  });
}
