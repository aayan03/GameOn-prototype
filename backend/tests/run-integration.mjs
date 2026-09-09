/**
 * Runs the integration suite on any supported Node version.
 *
 * `node --test` changed how it takes arguments, and the two forms are
 * mutually exclusive:
 *
 *   node --test tests/integration/          works on 18-21, throws on 22+
 *   node --test "tests/integration/*.mjs"   works on 22+, throws on 18-21
 *
 * package.json engines allows >=18 and CI pins 20, so either form is broken
 * for somebody — which is exactly what happened: the suite passed locally on
 * 24 and failed in CI on 20 before any test had run.
 *
 * Discovering the files here and passing explicit paths works on every
 * version, and needs no maintenance when a file is added.
 */

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'integration');

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => resolve(dir, f));

if (!files.length) {
  console.error('No integration tests found in tests/integration/');
  process.exit(1);
}

/**
 * `--coverage` turns on Node's own coverage reporter.
 *
 * Passed through here rather than baked into the npm script so the plain run
 * stays fast: coverage instrumentation roughly doubles the wall time of this
 * suite, and the common case is somebody running it to see whether they broke
 * something.
 */
const wantCoverage = process.argv.includes('--coverage');
const nodeFlags = wantCoverage ? ['--experimental-test-coverage'] : [];

const child = spawn(process.execPath, [...nodeFlags, '--test', ...files], {
  stdio: 'inherit',
  cwd: resolve(here, '..'),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
