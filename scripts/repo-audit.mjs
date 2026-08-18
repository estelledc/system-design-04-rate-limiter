import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPolicyRegistry } from '../src/runtime-config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', '.tmp', 'coverage', 'node_modules']);
const textExtensions = new Set(['', '.js', '.json', '.lua', '.md', '.mjs', '.yml', '.yaml']);
const files = [];
const errors = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path);
  }
}

walk(root);

const secretPatterns = [
  { name: 'GitHub token', pattern: /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/g },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'credentialed Redis URL', pattern: /redis(?:s)?:\/\/[^\s/:]+:[^\s@]+@/g },
];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const relative = file.slice(root.length + 1);
  const macHome = `/${'Users'}/`;
  const runnerHome = `/${'home'}/runner/work/`;
  if (source.includes(macHome) || source.includes(runnerHome)) {
    errors.push(`${relative}: contains a machine-specific absolute path`);
  }
  for (const { name, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) errors.push(`${relative}: contains a possible ${name}`);
  }

  if (extname(file) === '.md') {
    const linkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
    for (const match of source.matchAll(linkPattern)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
      const target = decodeURIComponent(rawTarget.split('#')[0]);
      const resolved = resolve(dirname(file), target);
      if (!resolved.startsWith(root) || !existsSync(resolved) || lstatSync(resolved).isSymbolicLink()) {
        errors.push(`${relative}: broken or unsafe local link ${rawTarget}`);
      }
    }
  }
}

const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
  if (!/@[a-f0-9]{40}$/.test(match[1])) {
    errors.push(`ci.yml: action is not pinned to a full commit: ${match[1]}`);
  }
}
if (!/image:\s*redis:[^\s@]+@sha256:[a-f0-9]{64}/.test(workflow)) {
  errors.push('ci.yml: Redis service image is not pinned to a SHA-256 digest');
}

const required = [
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'package-lock.json',
  'docs/architecture.md',
  'docs/operations.md',
  'docs/threat-model.md',
  'docs/verification.md',
  'docs/adr/0001-token-bucket-and-redis-lua.md',
];
for (const path of required) {
  if (!existsSync(join(root, path))) errors.push(`missing required artifact: ${path}`);
}

const registry = await loadPolicyRegistry();
if (registry.all().length < 2) errors.push('config must demonstrate multiple policies');

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  audited_files: files.length,
  local_links: 'ok',
  portable_paths: 'ok',
  secret_scan: 'ok',
  pinned_ci_dependencies: 'ok',
  policies: registry.all().map((policy) => policy.id),
})}\n`);
