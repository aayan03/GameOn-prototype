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
  // Refunds now go through the shared service, which sends a card payment
  // back to the card instead of always crediting the wallet.
  ok('refunds what was actually paid', /amountPaid/.test(s) && /refunds\.issueRefund/.test(s));
  ok('only expires requests that had a fair chance', /MIN_REQUEST_AGE_MS/.test(s) && /createdAt: \{ \$lte: oldEnough \}/.test(s));
  ok('refund is conditional on winning the flip', /if \(!flip\.modifiedCount\) continue;/.test(s));
  ok('records the refund on the booking', /issued\.refunded/.test(s));
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
  // The guards live in the service now; the controller only routes to it.
  // See services/bookingFlow.service.js — the behaviour is unchanged, so these
  // assertions follow the code rather than being relaxed.
  const s = src('src/services/bookingFlow.service.js');
  ok('settleCash exists', /export async function settleCash/.test(s));
  ok('the controller still exposes it', /export const settleCash/.test(src('src/controllers/booking.controller.js')));
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
  ok('cross-origin requests are never intercepted', /if \(url\.origin !== self\.location\.origin\) return;/.test(s));
  ok('it does not intercept a cross-origin API', !/&& !isApi\(url\)\) return;/.test(s));
  ok('"offline" is only claimed when the browser agrees', /navigator\?\.onLine === false/.test(s));

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

  const b = src('src/services/bookingFlow.service.js');
  /**
   * Awarding writes ONE row; revoking writes every row.
   *
   * A 3-slot booking that earned 90 points had 270 clawed back when the award
   * was stamped group-wide, because cancellation sums the field across rows.
   * So an award must be updateOne. Setting the field to 0 across the group is
   * the revoke, and that one is correct — this used to be a blanket "no
   * updateMany touches pointsAwarded", which only passed because the calls
   * happened to be written with req.params.groupRef rather than the shorthand.
   */
  const pointsUpdateMany = [...b.matchAll(/updateMany\([^;]*?pointsAwarded:\s*([^\s,}]+)/gs)]
    .map((m) => m[1]);
  ok('points are awarded on one row, never across the group',
    pointsUpdateMany.every((v) => v === '0'));
  ok('and the award itself uses updateOne', /updateOne\(\{ _id: [^}]+\}, \{ \$set: \{ pointsAwarded: /.test(b));
  ok('settleCash totals only what this call settled', /'payment\.paidAt': now/.test(b));
  ok('a review is only promised once the game has ended', /const played = new Date\(rows\[0\]\.endsAt\) <= now/.test(b));

  const l = src('src/services/loyalty.service.js');
  ok('revoke clamps inside the database', /\$max: \[0, \{ \$subtract: \['\$lifetimePoints', amount\] \}\]/.test(l));

  const lc = src('src/services/lifecycle.service.js');
  // The claim-then-pay ordering moved into services/refund.service.js, which
  // stamps 'pending' before touching money and 'processed' only after it has
  // moved — so a crash in between is visible rather than silently lost.
  ok('the expiry refund is delegated, not hand-rolled', /refunds\.issueRefund/.test(lc) && !/wallet\.credit/.test(lc));
  ok('the refund is computed from the whole group', /status: BOOKING_STATUS\.EXPIRED \}\)\s*\n\s*\.select/.test(lc));
  ok('completion is batched', /COMPLETE_BATCH/.test(lc));
  ok('a re-request cannot erase a late withdrawal', /wasAccepted: existing\.wasAccepted \|\| entry\.wasAccepted/.test(src('src/controllers/teamup.controller.js')));
  ok('push registration never pulls first', !/\$pull: \{ pushTokens: \{ token \} \}\s*\n\s*\);\s*\n\s*await User\.updateOne/.test(src('src/services/notification.service.js')));
  ok('teamup reads carry the session', !/api\.get\('\/teamup', filters, \{ auth: false \}\)/.test(web('src/api/endpoints.js')));
  ok('a late prefill cannot stomp typing', /touched\.current/.test(web('src/components/ReviewModal.jsx')));
}

console.log('\n── scroll reveal actually reveals ──');
{
  const css = web('src/styles/app.css');
  // The observer puts .reveal on the CONTAINER while will-reveal sits on the
  // children, so without a descendant rule every grid stays at opacity 0.
  ok('a revealed container reveals its children', /\.reveal \.will-reveal/.test(css));
  ok('the single-element case still works', /\.will-reveal\.reveal,/.test(css));
  ok('reduced motion shows everything', /prefers-reduced-motion: reduce\)\s*\{\s*\n\s*\.will-reveal \{ opacity: 1/.test(css));
  ok('content survives with no scripting', /@media \(scripting: none\)/.test(css));

  // Home.jsx must keep the pattern the CSS now supports.
  const home = web('src/pages/Home.jsx');
  ok('grids carry the ref, children carry will-reveal', /className="steps" ref=\{stepRef\}/.test(home));
}

console.log('\n── env vars pasted into a dashboard ──');
{
  const e = src('src/config/env.js');
  ok('values are trimmed and unquoted', /const clean = \(v\)/.test(e));
  ok('MONGO_URI is applied through clean()', /MONGO_URI: clean\(process\.env\.MONGO_URI\)/.test(e));
  ok('secrets are too', /JWT_SECRET: clean\(process\.env\.JWT_SECRET\)/.test(e));
  ok('a bad scheme is named at boot, not by mongoose', /must start with "mongodb\+srv:\/\/"/.test(e));
  ok('the password is masked in that message', /replace\(\/:\[\^:@\/\]\*@\/, ':\*\*\*\*@'\)/.test(e));
  ok('a left-in <placeholder> is caught', /still contains a <placeholder>/.test(e));
  ok('a placeholder hostname is caught', /placeholder hostname \(xxxxx/.test(e));
  ok('placeholder text in a secret is caught', /looks like placeholder text, not a value/.test(e));
  ok('CRON_SECRET is cleaned too', /CRON_SECRET: clean\(process\.env\.CRON_SECRET\)/.test(e));
}

console.log('\n── free-tier realities: cold starts and preview URLs ──');
{
  const a = src('src/app.js');
  ok('CORS supports a wildcard entry', /function originAllowed/.test(a));
  ok('the wildcard cannot cross a dot', /replace\(\/\\\*\/g, '\[\^\.\]\*'\)/.test(a));
  ok('a whole-domain wildcard is refused at boot', /wildcards an entire domain/.test(src('src/config/env.js')));

  const c = web('src/api/client.js');
  ok('requests time out instead of hanging', /REQUEST_TIMEOUT_MS/.test(c) && /controller\.abort\(\)/.test(c));
  ok('a timeout explains the cold start', /wake the server/.test(c));
  ok('an unreachable API names CORS and the URL', /check CORS_ORIGINS on the API includes/.test(c));
  // Only the thrown string matters; the phrase still appears in the comment
  // explaining why it was removed.
  ok('the dev-only "port 5000" message is gone', !/'Cannot reach the server\. Is the backend/.test(c));
  ok('a slow request tells the UI', /gameon:slow-request/.test(c));
  ok('a good response clears the banner', /gameon:request-ok/.test(c));
  ok('a non-JSON body is explained, not parsed', /looksLikePage/.test(c));
  ok('the waking banner exists and is mounted', /WakingBanner/.test(web('src/App.jsx')));
}

console.log('\n── the free-tier scheduler hook ──');
{
  const c = src('src/routes/cron.routes.js');
  ok('the route 404s with no secret configured', /if \(!expected\) throw ApiError\.notFound/.test(c));
  ok('the secret is compared in constant time', /timingSafeEqual/.test(c));
  ok('both sides are hashed first, so length does not leak', (c.match(/createHash\('sha256'\)/g) || []).length === 2);
  ok('GET is accepted too (free schedulers only send GETs)', /router\.get\('\/lifecycle', handler\)/.test(c));
  // clean() returns '' for an unset value, so the default still holds.
  ok('CRON_SECRET defaults to empty', /CRON_SECRET: clean\(process\.env\.CRON_SECRET\)/.test(src('src/config/env.js')));
  ok('the route is mounted', /router\.use\('\/cron', cronRoutes\)/.test(src('src/routes/index.js')));

  const r = readFileSync(path.join(here, '..', '..', 'render.yaml'), 'utf8');
  ok('render uses the free plan', /plan: free/.test(r));

  ok('the seed is importable, not CLI-only', /export async function seedDatabase/.test(src('src/seed/seed.js')));
  ok('the CLI only runs when invoked directly', /endsWith\('seed\.js'\)/.test(src('src/seed/seed.js')));
  ok('the seed endpoint needs the cron secret', /router\.post\('\/seed', asyncHandler\(async \(req, res\) => \{\s*\n\s*authorise\(req\);/.test(c));
  ok('it refuses a non-empty database', /Refusing to seed: the database is not empty/.test(c));
  ok('it never seeds real business listings', /seedDatabase\(\{ noLucknow: true/.test(c));
  ok('it does not hand back working credentials', !/player123|owner123/.test(c) && /demo accounts/i.test(c));
}

console.log('\n── the stack actually deploys ──');
{
  const nginx = web('nginx.conf');
  ok('nginx proxies /api', /location \/api\/ \{/.test(nginx) && /proxy_pass \$api_origin/.test(nginx));
  ok('forwards the real client IP', /X-Forwarded-For/.test(nginx));
  ok('security headers are re-included per location', (nginx.match(/security-headers\.conf/g) || []).length >= 4);

  /**
   * The CSP has to allow the payment sheet, on BOTH deploy paths.
   *
   * nginx shipped `script-src 'self'`, which blocked checkout.razorpay.com
   * outright — card and UPI failed with "could not load the payment window"
   * and nothing said why. Vercel shipped no CSP at all, which is the opposite
   * failure: an injected script had free rein over tokens kept in
   * localStorage. Both are checked here so neither can drift back.
   */
  const headers = web('security-headers.conf');
  ok('nginx sends a CSP', /Content-Security-Policy/.test(headers));
  ok('nginx CSP allows Razorpay checkout', /script-src[^;]*checkout\.razorpay\.com/.test(headers));
  ok('nginx CSP allows the Razorpay iframe', /frame-src[^;]*api\.razorpay\.com/.test(headers));
  ok('nginx CSP allows the 3-D Secure form POST', /form-action[^;]*api\.razorpay\.com/.test(headers));
  ok('nginx CSP allows map tiles', /openstreetmap|cartocdn/.test(headers));
  ok('nginx CSP still blocks plugins and framing', /object-src 'none'/.test(headers) && /frame-ancestors 'none'/.test(headers));

  const vercel = JSON.parse(web('vercel.json'));
  const catchAll = vercel.headers.find((h) => h.source === '/(.*)');
  const byKey = Object.fromEntries(catchAll.headers.map((h) => [h.key, h.value]));
  ok('vercel sends a CSP at all', Boolean(byKey['Content-Security-Policy']));
  ok('vercel CSP pins script-src', /script-src 'self'/.test(byKey['Content-Security-Policy'] || ''));
  ok('vercel CSP allows Razorpay checkout', /checkout\.razorpay\.com/.test(byKey['Content-Security-Policy'] || ''));
  ok('vercel CSP blocks plugins', /object-src 'none'/.test(byKey['Content-Security-Policy'] || ''));
  ok('vercel still sends nosniff and DENY', byKey['X-Content-Type-Options'] === 'nosniff' && byKey['X-Frame-Options'] === 'DENY');

  // Neither policy may fall back to allowing arbitrary inline script, which
  // would make the whole thing decorative.
  for (const [name, policy] of [['nginx', headers], ['vercel', byKey['Content-Security-Policy'] || '']]) {
    const scriptSrc = (policy.match(/script-src([^;"]*)/) || [])[1] || '';
    ok(`${name} CSP has no unsafe-inline script`, !/unsafe-inline/.test(scriptSrc));
    ok(`${name} CSP has no unsafe-eval`, !/unsafe-eval/.test(scriptSrc));
  }
  ok('render does not require a lockfile', /npm ci --omit=dev \|\| npm install/.test(readFileSync(path.join(here, '..', '..', 'render.yaml'), 'utf8')));
  ok('CI does not cache on a missing lockfile', !/cache-dependency-path/.test(readFileSync(path.join(here, '..', '..', '.github/workflows/ci.yml'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
