import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

/**
 * Loads every backend module.
 *
 * `node --check` only parses — it cannot see an error thrown while a module
 * evaluates. A real one shipped here: `schema.refine().partial()` throws a
 * TypeError at import time and took the entire API down, while passing every
 * syntax check. This test is the guard against that class of bug.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
function walk(d, o = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, o);
    else if (p.endsWith('.js') && !p.includes('/seed/')) o.push(p);
  }
  return o;
}
let fail = 0, n = 0;
for (const f of walk(root)) {
  if (f.endsWith('server.js')) continue;      // would start listening
  n++;
  try { await import(f); console.log('  ✓', f.replace(root + '/', '')); }
  catch (e) { fail++; console.log('  ✗', f.replace(root + '/', ''), '\n     ', e.message); }
}
console.log(`\n${n} modules loaded, ${fail} failed`);
process.exit(fail ? 1 : 0);
