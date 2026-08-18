import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const directories = ['src', 'scripts', 'test'];
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    if (entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
}

for (const directory of directories) collect(join(root, directory));
files.sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
JSON.parse(readFileSync(join(root, 'config', 'policies.json'), 'utf8'));
process.stdout.write(`${JSON.stringify({ checked_files: files.length, json_files: 2 })}\n`);
