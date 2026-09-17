/**
 * How the error handler maps a thrown thing to a status code.
 *
 * The mapping matters twice over. A status of 500 does not just tell the
 * customer the wrong thing — it reports the request to the error tracker and
 * pages somebody. So anything that is really the caller's problem, or a lost
 * race, has to be mapped, or normal Saturday-evening traffic sets off alarms.
 *
 * Pure function, no database: build an error, call the handler with a fake
 * res, read back what it wrote.
 */
import { errorHandler } from '../src/middleware/errorHandler.js';
import ApiError from '../src/utils/ApiError.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

/** Runs the handler and returns what it would have sent. */
function handle(err) {
  let status = 0;
  let body = null;
  const res = {
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
  };
  const req = { method: 'PATCH', originalUrl: '/api/teamup/abc/join', id: 'req-test' };
  errorHandler(err, req, res, () => {});
  return { status, message: body?.error?.message };
}

/** Mongoose throws this shape when a versioned save loses the race. */
function versionError() {
  const err = new Error('No matching document found for id "65f" version 3 modifiedPaths "joinRequests"');
  err.name = 'VersionError';
  return err;
}

console.log('\n── lost races are conflicts, not server errors ──');
{
  const r = handle(versionError());
  // 409, so the client can retry — and so this never reaches the branch that
  // reports to the error tracker and pages someone.
  eq('a VersionError is a 409', r.status, 409);
  eq('and is worded as something to retry', /try again/i.test(r.message), true);
  eq('and does not leak the internal text', /modifiedPaths|version 3/.test(r.message), false);
}

console.log('\n── the mappings either side of it still hold ──');
{
  const cast = new Error('Cast to ObjectId failed');
  cast.name = 'CastError';
  cast.path = 'id';
  eq('a CastError is a 400', handle(cast).status, 400);

  const dup = new Error('E11000 duplicate key');
  dup.code = 11000;
  dup.keyPattern = { court: 1, date: 1, startMinutes: 1 };
  const d = handle(dup);
  eq('a duplicate booking is a 409', d.status, 409);
  eq('and says the slot was taken', /just been taken/i.test(d.message), true);

  const expired = new Error('jwt expired');
  expired.name = 'TokenExpiredError';
  eq('an expired token is a 401', handle(expired).status, 401);

  eq('an ApiError keeps its own status', handle(ApiError.badRequest('nope')).status, 400);
  eq('and its own message', handle(ApiError.badRequest('nope')).message, 'nope');
}

console.log('\n── a genuine server error is still a server error ──');
{
  const boom = new Error('connect ECONNREFUSED 10.0.0.1:27017');
  const r = handle(boom);
  eq('an unmapped error is a 500', r.status, 500);
  // The message is replaced: a driver error carries hosts, and a Mongoose one
  // can carry a connection string with credentials in it.
  eq('and its text is not handed to the client', /ECONNREFUSED|10\.0\.0\.1/.test(r.message), false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
