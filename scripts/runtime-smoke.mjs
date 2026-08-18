import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const rawKey = 'runtime-smoke-key';
const child = spawn(process.execPath, [join(root, 'src', 'main.js')], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    STORE_BACKEND: 'memory',
    PARTITION_HMAC_SECRET: 'runtime-smoke-secret-at-least-32-bytes',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

function waitForStarted(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('server start timed out')), timeoutMs);
    const poll = () => {
      for (const line of stdout.split('\n')) {
        if (!line.includes('"event":"server_started"')) continue;
        clearTimeout(deadline);
        resolve(JSON.parse(line));
        return;
      }
      if (child.exitCode !== null) {
        clearTimeout(deadline);
        reject(new Error(`server exited before startup: ${child.exitCode}`));
        return;
      }
      setTimeout(poll, 10).unref();
    };
    poll();
  });
}

function waitForExit(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('server shutdown timed out')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal });
    });
  });
}

try {
  const started = await waitForStarted();
  const baseUrl = `http://127.0.0.1:${started.port}`;
  assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);

  const headers = { 'x-api-key': rawKey };
  assert.equal((await fetch(`${baseUrl}/v1/expensive`, { headers })).status, 200);
  assert.equal((await fetch(`${baseUrl}/v1/expensive`, { headers })).status, 200);
  assert.equal((await fetch(`${baseUrl}/v1/expensive`, { headers })).status, 429);

  const exitPromise = waitForExit();
  child.kill('SIGTERM');
  const exit = await exitPromise;
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.match(stdout, /"event":"server_stopped"/);
  assert.ok(!stdout.includes(rawKey));
  assert.equal(stderr, '');
  process.stdout.write(`${JSON.stringify({
    startup: 'ok',
    health: 200,
    burst: [200, 200, 429],
    graceful_shutdown: 'ok',
    raw_identity_logged: false,
  })}\n`);
} catch (error) {
  child.kill('SIGKILL');
  throw error;
}
