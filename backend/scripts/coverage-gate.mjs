/**
 * Runs the integration suite under coverage and fails if it drops.
 *
 * 623 tests is a lot, and until now nothing said which lines they touch — so
 * nobody knew where the holes were. A percentage on its own is a vanity
 * number; a percentage with a floor under it is a ratchet, which is the only
 * version of this worth having.
 *
 * The floors below are set to roughly where the suite already sits, rounded
 * down. That is deliberate: a threshold you have to meet tomorrow gets
 * lowered, and a threshold you already meet gets defended. Raise them when a
 * run comes in comfortably above.
 *
 *   npm run coverage         report and enforce
 *   npm run coverage -- --report-only    print the table, never fail
 *
 * Node's own reporter, so there is no new dependency and nothing to keep in
 * step with the test runner.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * Percentages the suite must not fall below.
 *
 * Measured, not aspirational: the integration suite came in at 85.05 line,
 * 71.62 branch and 74.73 function, and these sit a couple of points under each
 * of those. The gap absorbs the ordinary drift of a run — a branch that only
 * executes when a timer happens to fire — without leaving room for a real
 * regression to hide.
 */
const FLOORS = {
  line: 82,
  branch: 70,
  func: 72,
};

const reportOnly = process.argv.includes('--report-only');

const child = spawn(
  process.execPath,
  [resolve(root, 'tests/run-integration.mjs'), '--coverage'],
  { cwd: root, stdio: ['inherit', 'pipe', 'inherit'] },
);

let out = '';
child.stdout.on('data', (chunk) => {
  const text = String(chunk);
  out += text;
  process.stdout.write(text);
});

child.on('exit', (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }

  // A failing suite is a failing suite; coverage is not the headline then.
  if (code !== 0) {
    console.error('\nTests failed — not evaluating coverage.');
    process.exit(code ?? 1);
    return;
  }

  /**
   * The summary row, which the reporter prints as:
   *   ℹ all files |  72.41 |    81.03 |   68.92 |
   *
   * Matched loosely on purpose. The table's column widths shift with the
   * longest filename in the run, so anything anchored to a fixed layout
   * breaks the first time somebody adds a deeply nested file.
   */
  const row = out.split('\n').find((l) => l.includes('all files'));
  const nums = row?.match(/\d+\.\d+/g);

  if (!nums || nums.length < 3) {
    console.error(
      '\nCould not read the coverage summary. Node prints it as an "all files" row;\n'
      + 'if the reporter format changed, this script needs updating rather than skipping.',
    );
    process.exit(1);
    return;
  }

  const [line, branch, func] = nums.map(Number);
  const results = [
    ['line', line, FLOORS.line],
    ['branch', branch, FLOORS.branch],
    ['function', func, FLOORS.func],
  ];

  console.log('\nCoverage against the floor');
  let failed = false;
  for (const [name, actual, floor] of results) {
    const ok = actual >= floor;
    if (!ok) failed = true;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${actual.toFixed(2)}%  (floor ${floor}%)`,
    );
  }

  if (failed && !reportOnly) {
    console.error(
      '\nCoverage fell below the floor. Either the new code needs tests, or the\n'
      + 'floor in scripts/coverage-gate.mjs is genuinely wrong — say which in the\n'
      + 'commit message rather than quietly lowering it.',
    );
    process.exit(1);
    return;
  }

  console.log(failed ? '\nBelow floor, reporting only.' : '\nCoverage holds.');
  process.exit(0);
});
