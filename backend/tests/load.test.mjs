import { readdirSync, statSync } from 'fs';
import { join, sep, dirname, resolve, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Loads every backend module.
 *
 * `node --check` only parses — it cannot see an error thrown while a module
 * evaluates. A real one shipped here: `schema.refine().partial()` throws a
 * TypeError at import time and took the entire API down, while passing every
 * syntax check. This test is the guard against that class of bug.
 *
 * Everything below is path-separator agnostic on purpose. The first version
 * hardcoded '/', so on Windows it skipped nothing (seed modules connect to a
 * database and were being imported for real) and then failed outright: Node's
 * ESM loader rejects a bare 'C:\...' path with "protocol 'c:' is not
 * supported" and every single module was reported as broken.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

// Directories whose modules have side effects on import — a seed script opens
// a database connection, so loading it is not a safe smoke test.
const SKIP_DIRS = new Set(['seed']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (full.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const label = (f) => relative(root, f).split(sep).join('/');

let fail = 0;
let n = 0;

for (const file of walk(root)) {
  if (file.endsWith('server.js')) continue;      // would start listening
  n++;
  try {
    // pathToFileURL, not the raw path: an absolute Windows path is not a
    // valid ESM specifier.
    await import(pathToFileURL(file).href);
    console.log('  ✓', label(file));
  } catch (e) {
    fail++;
    console.log('  ✗', label(file), '\n     ', e.message);
  }
}

console.log(`\n${n} modules loaded, ${fail} failed`);
process.exit(fail ? 1 : 0);
