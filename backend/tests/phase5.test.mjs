/**
 * Phase 5 unit tests.
 *
 * Each block below is a bug that was in the code before this phase. They are
 * kept as tests rather than notes because every one of them was reachable
 * from the UI, and several of them moved money.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, '..', p), 'utf8');
const web = (p) => readFileSync(path.join(here, '..', '..', 'frontend', p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

console.log('\n── expired requests must not strand money ──');
{
  const s = src('src/services/lifecycle.service.js');
  ok('refunds what was actually paid', /amountPaid/.test(s) && /wallet\.credit/.test(s));
  ok('only expires requests that had a fair chance', /MIN_REQUEST_AGE_MS/.test(s) && /createdAt: \{ \$lte: oldEnough \}/.test(s));
  ok('refund is conditional on winning the flip', /if \(!flip\.modifiedCount\) continue;/.test(s));
  ok('records the refund on the booking', /cancellation\.refundAmount/.test(s));
  ok('queries are bounded', /\.limit\(500\)/.test(s));
}

console.log('\n── lifecycle steps claim before acting ──');
{
  const s = src('src/services/lifecycle.service.js');
  ok('completion stamps a run id inside the update', /lifecycleRun: runId/.test(s));
  ok('completion reads back only its own claim', /find\(\{ lifecycleRun: runId \}\)/.test(s));
  ok('reminders stamp before sending', /reminderSentAt: now, lifecycleRun/.test(s));
  ok('reliability claims each post atomically', /findOneAndUpdate\(\s*\{ _id, reliabilitySettled/.test(s));
  ok('review prompts are windowed', /REVIEW_PROMPT_WINDOW_MS/.test(s));
  ok('only one pass runs at a time', /if \(inFlight\) return inFlight;/.test(s));
  ok('shutdown clears the boot timer', /clearTimeout\(bootTimer\)/.test(s));
  ok('shutdown waits for a running pass', /await inFlight/.test(s));
  ok('expired posts still settle reliability', /'open', 'filled', 'expired'/.test(s));
  ok('only accepted players lose reliability', /r\.wasAccepted/.test(s));
}

console.log('\n── reviews are earned, once ──');
{
  const s = src('src/controllers/review.controller.js');
  ok('requires money to have moved', /hasSettledVisit/.test(s) && /'payment\.amountPaid': \{ \$gt: 0 \}/.test(s));
  ok('records the points the review earned', /pointsAwarded: LOYALTY\.REVIEW_BONUS/.test(s));
  ok('the bonus is claimed once per venue, forever', /reviewBonusVenues: \{ \$ne: venue\._id \}/.test(s));
  ok('deleting does not hand points back (that was the faucet)', !/loyalty\.revoke\(review\.user/.test(s));
  ok('the claim marker is on the user model', /reviewBonusVenues/.test(src('src/models/User.js')));
  ok('a deleted venue does not 500 the reply', /if \(!review\.venue\) throw/.test(s));
  ok('delete is rate limited', /writeLimiter, ctrl\.remove/.test(src('src/routes/review.routes.js')));
}

console.log('\n── pay-at-venue can be settled ──');
{
  const s = src('src/controllers/booking.controller.js');
  ok('settleCash exists', /export const settleCash/.test(s));
  ok('is conditional on still being unpaid', /'payment\.status': \{ \$ne: 'paid' \}/.test(s));
  ok('writes the real per-row amount', /'payment\.amountPaid': '\$totalAmount'/.test(s));
  ok('rejects an online-paid booking', /already paid online/.test(s));
  ok('is owner-only', /restrictTo\(ROLES\.OWNER, ROLES\.ADMIN\), ctrl\.settleCash/.test(src('src/routes/booking.routes.js')));
  ok('a pending request is not typed as a reminder', /'booking_requested'/.test(s));
}

console.log('\n── teamup cancellation reaches the players ──');
{
  const s = src('src/controllers/teamup.controller.js');
  const audienceAt = s.indexOf('const audience = [');
  const clearAt = s.indexOf('post.confirmedPlayers = [];');
  ok('the audience is captured before the list is emptied', audienceAt > 0 && audienceAt < clearAt);
  ok('accepted players are marked as such', /wasAccepted/.test(s));
}

console.log('\n── the device never serves one user data to the next ──');
{
  const s = web('public/sw.js');
  ok('authenticated responses are never cached', /function isAuthenticated/.test(s) && /if \(isAuthenticated\(request\)\) return fetch\(request\)/.test(s));
  ok('the worker can be told to drop cached data', /CLEAR_DATA/.test(s));
  ok('no skipWaiting on install', !/\.then\(\(\) => self\.skipWaiting\(\)\)/.test(s));
  ok('the offline static path returns a Response', /status: 504/.test(s));

  const auth = web('src/context/AuthContext.jsx');
  ok('logout waits for storage nowhere, but restore does', /await storageReady/.test(auth));
  ok('logout unregisters the push token', /removePushToken/.test(auth));
  ok('logout clears cached data', /CLEAR_DATA/.test(auth));
  ok('a dead session clears cached data too', /CLEAR_DATA/.test(web('src/api/client.js')));
  ok('DELETE can carry a body', /method: 'DELETE', body: opts\?\.body/.test(web('src/api/client.js')));

  const plat = web('src/utils/platform.js');
  ok('storage readiness is awaitable', /export const storageReady/.test(plat));
  ok('push registers only once', /if \(pushRegistered\) return true;/.test(plat));
}

console.log('\n── money that never entered the platform is never refunded ──');
{
  const s = src('src/services/booking.service.js');
  ok('gate cash is not refunded to the wallet', /method === 'pay_at_venue'/.test(s) && /tier: 'at_venue'/.test(s));

  const b = src('src/controllers/booking.controller.js');
  ok('points are stamped on one row, not every row', !/updateMany\(\{ groupRef \}, \{ \$set: \{ pointsAwarded/.test(b));
  ok('settleCash totals only what this call settled', /'payment\.paidAt': now/.test(b));
  ok('a review is only promised once the game has ended', /const played = new Date\(rows\[0\]\.endsAt\) <= now/.test(b));

  const l = src('src/services/loyalty.service.js');
  ok('revoke clamps inside the database', /\$max: \[0, \{ \$subtract: \['\$lifetimePoints', amount\] \}\]/.test(l));

  const lc = src('src/services/lifecycle.service.js');
  ok('the refund moves before it is recorded', lc.indexOf('await wallet.credit') < lc.indexOf("'cancellation.refundStatus': 'processed'"));
  ok('the refund is computed from the whole group', /status: BOOKING_STATUS\.EXPIRED \}\)\s*\n\s*\.select/.test(lc));
  ok('completion is batched', /COMPLETE_BATCH/.test(lc));
  ok('a re-request cannot erase a late withdrawal', /wasAccepted: existing\.wasAccepted \|\| entry\.wasAccepted/.test(src('src/controllers/teamup.controller.js')));
  ok('push registration never pulls first', !/\$pull: \{ pushTokens: \{ token \} \}\s*\n\s*\);\s*\n\s*await User\.updateOne/.test(src('src/services/notification.service.js')));
  ok('teamup reads carry the session', !/api\.get\('\/teamup', filters, \{ auth: false \}\)/.test(web('src/api/endpoints.js')));
  ok('a late prefill cannot stomp typing', /touched\.current/.test(web('src/components/ReviewModal.jsx')));
}

console.log('\n── the stack actually deploys ──');
{
  const nginx = web('nginx.conf');
  ok('nginx proxies /api', /location \/api\/ \{/.test(nginx) && /proxy_pass \$api_origin/.test(nginx));
  ok('forwards the real client IP', /X-Forwarded-For/.test(nginx));
  ok('security headers are re-included per location', (nginx.match(/security-headers\.conf/g) || []).length >= 4);
  ok('render does not require a lockfile', /npm ci --omit=dev \|\| npm install/.test(readFileSync(path.join(here, '..', '..', 'render.yaml'), 'utf8')));
  ok('CI does not cache on a missing lockfile', !/cache-dependency-path/.test(readFileSync(path.join(here, '..', '..', '.github/workflows/ci.yml'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
