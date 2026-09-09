# Deploying GameOn

Backend and frontend deploy separately. The whole connection between them is
one environment variable on each side.

Reference stack (all have usable free tiers): **MongoDB Atlas** for the
database, **Render** for the API, **Vercel** for the site.

> **Just want it online for free, as a prototype?** Follow
> [FREE-HOSTING.md](./FREE-HOSTING.md) instead — same stack, every click
> spelled out, plus the free-tier limits that will bite you. Come back here
> when you are taking real money.

---

## Before you deploy — read this

Two things in this repository are deliberately not production-ready, and both
will cause you real problems if you ship them as-is.

**1. The Lucknow venue listings are unverified.**
`backend/src/seed/lucknow.js` contains 22 real Lucknow business names taken from
public directory listings. Their prices, opening hours, court configurations and
coordinates are plausible placeholders, not quoted facts. No reviews were
invented for them and every entry is marked `isClaimed: false`, which makes the
UI show an "Unclaimed listing" badge and a warning on the venue page.

Before you launch publicly you must either contact each venue and confirm the
details, or seed without them:

```bash
npm run seed:demo      # demo venues only, no real business names
```

Publishing invented prices under a real business's name is how you end up with
angry venue owners and players who turn up to a rate that does not exist.

**1b. Pay-at-venue needs someone to press the button.**
A pay-at-venue booking takes no money online, so nothing knows the cash arrived
until the owner records it — *Booking requests → Confirmed → Mark ₹N collected*.
Until they do, that revenue is missing from the owner's charts and the player
cannot leave a review. Tell your venue owners this exists, or they will wonder
where their numbers went.

**2. Payments need keys before they are real.**
Razorpay is fully implemented, behind a feature flag. Set `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` and the gateway goes live —
no code change. Leave them empty and the wallet simulation runs, and the
card/UPI endpoints return 501 rather than pretending to verify signatures they
have no secret for.

What still needs your attention even with keys set:
- `/api/bookings/wallet/topup` still mints balance with no settlement behind
  it. It is capped at ₹25,000/day per account and rate-limited, but it is a
  faucet. Delete it, or wire it to a real Razorpay order, before launch.
- Register the webhook at `https://your-api/api/payments/webhook` for the
  `payment.captured` and `payment.failed` events.
- Refunds currently return to the GameOn wallet. If you want money to go back
  to the original card, call `refundPayment()` from `services/payment.service.js`
  in the cancellation path — the function is written and waiting.

---

## 1. Database — MongoDB Atlas

1. Create a free M0 cluster at <https://www.mongodb.com/atlas>
2. **Database Access** → add a user with a strong generated password
3. **Network Access** → add your API host's IP. `0.0.0.0/0` works but means
   anyone with the credentials can connect from anywhere — prefer the real range
4. Copy the connection string and append the database name:

```
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/gameon?retryWrites=true&w=majority
```

The indexes (geo, unique slot, text search) are created automatically by
Mongoose on first connection.

---

## 2. Generate secrets

Run this twice and keep the two values separate:

```bash
openssl rand -base64 48
```

The server will refuse to boot in production if either secret is missing, under
32 characters, still the example value, or identical to the other one. That is
intentional — a default JWT secret means anyone who has read this repo can mint
an admin token.

---

## 3. Backend — Render

**New → Web Service**, point it at your repository.

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |

Environment variables:

```
NODE_ENV=production
MONGO_URI=<your Atlas string>
JWT_SECRET=<first generated secret>
JWT_REFRESH_SECRET=<second generated secret>
JWT_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=30d
CORS_ORIGINS=https://your-site.vercel.app,capacitor://localhost
TRUST_PROXY=true
LOG_LEVEL=combined
```

`TRUST_PROXY=true` matters on Render: without it every request appears to come
from the load balancer, and per-IP rate limiting becomes one shared bucket for
the entire internet.

Seed the production database once, from your machine, with `MONGO_URI` pointing
at Atlas:

```bash
cd backend
MONGO_URI="<atlas string>" npm run seed:demo
```

---

## 4. Frontend — Vercel

**Add New → Project**, import the same repository.

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |

Environment variables:

```
VITE_API_URL=https://your-api.onrender.com
VITE_SHOW_DEMO_LOGINS=false
```

No trailing slash on `VITE_API_URL` — the API client appends `/api` itself.

`VITE_SHOW_DEMO_LOGINS` must stay `false` (or unset) on anything public. The
demo credentials are published in this repository, and one of them is a venue
owner with access to that venue's customer names, phone numbers and revenue.

SPA routing: Vercel handles this for Vite automatically. On any host that does
not, add a rewrite sending all paths to `/index.html`, or a deep link like
`/teamup/abc123` will 404 on refresh.

### Why the build uses an absolute base path

`vite.config.js` sets `base: '/'` for the web. Do not change it to `'./'`.

A relative base makes `index.html` reference `./assets/index-<hash>.js`. An
SPA serves that same `index.html` for every route, so a visitor landing on
`/venues/some-turf` resolves the bundle against `/venues/` and requests
`/venues/assets/index-<hash>.js`. The rewrite above answers that with
`index.html` — HTML, with `Content-Type: text/html` — and the browser refuses
to execute it as a module. The page is blank, with nothing but a MIME error in
the console. It affects every deep link, every refresh and every shared URL,
while the home page keeps working, which is what makes it easy to miss.

The native shell is the one case that genuinely needs relative paths, because
Capacitor loads the bundle off the filesystem with no server in front of it.
Build that with `npm run cap:build` (or `npm run cap:sync`), which sets
`VITE_BUILD_TARGET=capacitor`.

---

## 4b. Email — required before launch

The API **refuses to boot in production without SMTP**. That is deliberate:
password reset is the only route back into a locked-out account, so a
deployment that cannot send email is one where a forgotten password means a
lost account, wallet balance and booking history.

### Do not use SMTP on a free tier

Render's free plan — and Railway's, and Fly's — **blocks outbound SMTP ports**
(25, 465, 587) to stop the platform being used for spam. The failure is
distinctive and misleading: a connection `ETIMEDOUT`, not a `535` auth
rejection, because the packets never leave the network. The same credentials
authenticate perfectly from a laptop, so it reads as a code problem when it is
a firewall.


## Timezone — set this before you take a single booking

The whole booking layer is expressed in the **venue's** wall-clock time: a slot
is a `YYYY-MM-DD` key plus minutes-from-midnight, and opening hours, the
free-cancellation window, the day-before reminder and the "this slot has
passed" greying all key off it.

Render, Railway, Fly and every `node:*-alpine` image run the process in **UTC**.
If the venues are in India that is 5½ hours away from the clock the product is
written for, and the symptom is not an error — it is a grid that quietly lets
someone book a slot that started five hours ago.

```
APP_TIMEZONE=Asia/Kolkata
TZ=Asia/Kolkata
```

`APP_TIMEZONE` is the one that matters: `utils/time.js` converts through it
explicitly, so the app is correct even on a host whose own clock is wrong.
There is deliberately **no fallback to the server's timezone** — an implicit
fallback is how the bug survived this long. `TZ` is set alongside it only so
log timestamps read the same way.

Running somewhere else? Any IANA name works. On Alpine the image must also
carry `tzdata` (the Dockerfile installs it) or Node cannot resolve a named
zone at all — the app refuses to start rather than silently reverting to UTC.

Use an HTTP provider instead. Both post over 443, which nothing blocks.

**Brevo** (recommended — free 300/day, and you verify a single sender address
rather than a whole domain):

```
BREVO_API_KEY=xkeysib-...
SMTP_FROM=GameOn <the-address-you-verified@example.com>
APP_URL=https://your-site.vercel.app
```

Get the key from Brevo → **SMTP & API** → **API Keys**. Verify your sender
address under **Senders** first, or sends are refused.

**Resend** is the alternative, but it needs a verified *domain* before it will
send to anyone but your own account address:

```
RESEND_API_KEY=re_...
```

**SMTP** still works wherever the ports are open — a paid Render plan, your own
VPS, most managed hosts:

```
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=GameOn <no-reply@yourdomain.com>
```

Whichever you pick, check it before deploying:

```bash
cd backend
npm run check:email                              # is it configured correctly?
node scripts/check-email.mjs you@example.com     # ...and does a message arrive?
```

`APP_URL` is the base of the links inside those emails. It is deliberately not
derived from the request's `Host` header — a reset link built from an
attacker-supplied header is a working account takeover.

Credentials are checked once at boot, so a wrong password shows up in the
deploy log rather than in a support ticket.

### Push notifications (optional)

```bash
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` together, or leave both empty.
With them empty the app never asks for notification permission at all, which
is the right behaviour — a permission the browser grants once and the server
cannot act on is a permission wasted.

### Error tracking (optional, strongly recommended)

Set `SENTRY_DSN` and unexpected 500s are reported with the request id that
also appears in the logs and in the error response. Handled failures — a
validation error, a declined payment — are not reported; they would be noise.

---

## 5. Close the loop

Once the frontend has a real URL, set `CORS_ORIGINS` on the backend to exactly
that origin and redeploy. Then verify:

```bash
curl https://your-api.onrender.com/api/health
# → {"success":true,"data":{"status":"up",...}}
```

Then in a browser: sign up, book a slot, cancel it, check the refund landed in
the wallet, and confirm the loyalty points moved. Finally, run the reset flow
end to end — "forgot password", open the email, set a new one — because that
is the path nobody tests until a real customer needs it.

### Before you take real money

- [ ] `ALLOW_SIMULATED_TOPUP` is `false` or unset. The simulated top-up mints
      spendable balance with nothing behind it; on a live site that is a money
      printer, and the server refuses to boot with it on while Razorpay is
      configured.
- [ ] Razorpay keys are live (`rzp_live_`), not test, and the webhook secret is set.
- [ ] `VITE_SHOW_DEMO_LOGINS` is `false` on the frontend.
- [ ] The seeded demo accounts are deleted or re-passworded — their passwords
      are published in this repository, and one is a venue owner.
- [ ] Terms and Privacy pages exist and are linked. You are storing names,
      phone numbers and payment records; India's DPDP Act applies.
- [ ] `gameon.app` in `sitemap.xml`, `robots.txt` and the Open Graph tags is
      replaced with your real domain.

---

## Upgrading a database that already has data

If you are deploying over a database seeded before venue moderation existed,
run this once. Venue documents written earlier have no `moderationStatus`
field, and while the read queries are written to tolerate that
(`$nin: ['pending','rejected']` matches missing fields), backfilling makes the
state explicit rather than implied:

```js
// mongosh, against your database
db.venues.updateMany(
  { moderationStatus: { $exists: false } },
  { $set: { moderationStatus: 'approved' } }
);
```

Approving a venue that is awaiting review:

```js
db.venues.updateOne(
  { _id: ObjectId('...') },
  { $set: { moderationStatus: 'approved', isActive: true } }
);
```

Marking a venue owner as verified, so their future listings publish immediately:

```js
db.users.updateOne({ email: 'owner@example.com' }, { $set: { isVerified: true } });
```

**There is now an admin UI for all of this** at `/admin` — moderation queue,
owner verification, account suspension, platform stats, ledger and the payout
runner. The commands above are the fallback for bootstrapping your first admin,
because the `admin` role is deliberately not assignable through any API:

```js
db.users.updateOne({ email: 'you@example.com' }, { $set: { role: 'admin' } });
```

Run that once, log out and back in, and `/admin` appears in the nav.

---

## Security checklist

Everything below is already implemented. It is listed so you can verify it
rather than take it on faith.

### Authentication
- [x] Passwords hashed with bcrypt (cost 10), never returned by any query
- [x] Minimum 8 characters with a letter and a number
- [x] Access tokens short-lived (2h); refresh tokens separate secret and type
- [x] `tokenVersion` on the user — changing a password retires every existing
      token, so "signed out everywhere" is true rather than cosmetic
- [x] JWT verification pins the algorithm (`HS256`), issuer and audience, so a
      token cannot be re-signed with `alg: none`
- [x] A refresh token presented as a bearer token is rejected
- [x] Per-account lockout after 8 failed logins (15 minutes)
- [x] Login timing and message are identical for unknown and wrong-password
      accounts, so the endpoint cannot enumerate registered emails
- [x] `admin` is not an assignable role at registration

### Input handling
- [x] Every endpoint validated with Zod; `.strict()` on all write schemas, so
      unknown keys are rejected rather than silently assigned
- [x] Mongo operators (`$ne`, `$gt`, `$where`) and dotted paths stripped from
      every body, param and query — the classic NoSQL auth bypass is dead
- [x] `__proto__` / `constructor` / `prototype` keys stripped (prototype pollution)
- [x] All user input escaped before entering a `RegExp` (ReDoS and filter bypass)
- [x] Repeated query parameters collapsed (HTTP parameter pollution)
- [x] Request bodies capped at 256 KB

### Authorisation
- [x] Ownership checked on every venue, booking, team and TeamUp mutation
- [x] Object ids validated before use, so a crafted id cannot become a query
- [x] Teams are readable only by their members
- [x] Join-request lists are visible only to the host
- [x] Team invite codes are `crypto.randomBytes`, not sequential or derivable
- [x] An invite addressed to an email can only be redeemed by that email

### Money and integrity

Phase 5 added five more to this list, all found by auditing the Phase 5 fixes
themselves rather than the code they were fixing:

- [x] Cash taken at the gate is never refunded as wallet credit. Once the owner
      marks a pay-at-venue booking settled, `refundFor` returns `at_venue` and
      pays nothing — the venue has the notes, so refunding from the platform
      would have minted the money a second time
- [x] `pointsAwarded` is written to one row of a booking group, not copied onto
      every row. Cancelling a 3-slot booking used to claw back 3× what it gave
- [x] The review bonus is claimed once per venue for good (`reviewBonusVenues`
      on the user). Awarding on create and revoking on delete looked fairer but
      was a faucet: revoke can only take back *unspent* points, so
      post → redeem → delete → repost paid out on every cycle
- [x] `loyalty.revoke` clamps inside the database. Read-then-write let two
      overlapping revokes each subtract the full balance and leave it negative
- [x] The expiry job credits the wallet before recording the refund, and reads
      the whole booking group after claiming it rather than the partial slice
      the time-window query returned

Every one of these was a real bug found during an adversarial review of this
codebase, not a hypothetical. They are listed because knowing *which* mistakes
were made is more useful than a claim that none were.

- [x] Wallet debits are a single atomic `findOneAndUpdate` whose filter carries
      the sufficiency check — no read-modify-write race, no negative balances
- [x] Point redemption and the daily top-up cap are atomic the same way
- [x] Every payment method except pay-at-venue actually debits the wallet.
      Marking a booking paid without taking money, then refunding it as wallet
      credit, was a money printer
- [x] `payment.amountPaid` records what was really taken; a refund can never
      exceed it, and it is written in the same operation that marks rows paid
- [x] Cancellation flips every row in one conditional update and refunds only
      if that update modified something — parallel cancels used to each pay out
- [x] Confirming an assisted booking is equally conditional, so a confirm racing
      a cancel cannot re-lock a released slot after the refund went out
- [x] Points already spent are deducted from the refund, so redeem-then-cancel
      cannot convert a free booking into free credit
- [x] Double booking prevented by a unique partial index, not application logic
- [x] A failed multi-slot write deletes the whole group, so no orphaned locks
- [x] TeamUp spot claims use `$expr` filters and `$elemMatch`, so a game cannot
      be over-filled and one request cannot be accepted twice
- [x] Cost settlement claims the right atomically, refuses cancelled games, and
      charges each player the share they agreed to when they joined
- [x] Cost shares are capped, and bounded by the linked booking's real total
- [x] Host loyalty bonus is granted once per post, only when a player actually
      joins, capped per day, and revoked if the game is cancelled or emptied
- [x] Promo codes count cancelled bookings, so book-and-cancel cannot reset a
      first-booking offer that refunds in full
- [x] Manual venues take no payment until the owner confirms
- [x] Failed transfers are reversed rather than silently losing money

### Abuse and moderation
- [x] Anyone can sign up as an "owner", so listings from unverified accounts are
      held at `moderationStatus: 'pending'` and hidden from discovery,
      availability and city counts until reviewed
- [x] Owners cannot activate their own unapproved venue, or set
      `moderationStatus`, `isVerified` or `isFeatured` on it
- [x] Venue owners' registration email and phone are never served publicly
- [x] Team invites do not reveal whether an email is registered, or whose it is
- [x] `?mine=` views require a session rather than silently returning everything
- [x] Demo seeding refuses to run against production

### Transport and headers
- [x] Helmet with a real CSP: `frame-ancestors 'none'`, `object-src 'none'`
- [x] HSTS with preload in production
- [x] CORS allow-list enforced in production; never allow-all
- [x] `x-powered-by` removed
- [x] Rate limits: global, auth, registration, writes, content creation
- [x] Stack traces never returned in production

### Configuration
- [x] Server refuses to boot in production with default or weak secrets
- [x] Signup is verify-by-email. The account is created when the emailed link
      is opened, not when the form is submitted — so `POST /auth/register`
      answers identically for a taken address and a fresh one, and no password
      the caller invents ever works on an address they do not own
- [x] `.env` is gitignored; `.env.example` carries no real values
- [x] `TRUST_PROXY` is opt-in, so `X-Forwarded-For` cannot be spoofed off-proxy

### Done in code — but they need a value from you

- [ ] **Fill in `frontend/src/config/business.js`** (or the matching `VITE_*`
      variables). Your registered name, address, support email and phone appear
      verbatim on `/terms`, `/privacy`, `/refunds` and `/contact`. Until they
      are filled in, every policy page carries a visible "not ready to publish"
      banner — deliberately, because a policy page naming the wrong company is
      worse than one that obviously needs finishing. **Razorpay will not
      activate a live account without these four pages on your own domain**,
      and it checks them against your merchant entity.
- [ ] **Set `VITE_SITE_URL`** to your real origin at build time. Otherwise the
      canonical tag, `og:image`, `robots.txt` and `sitemap.xml` all point at
      `http://localhost:5173`. Getting this wrong tells Google your content
      belongs to another domain.
- [ ] **Set `APP_TIMEZONE`** if your venues are not on IST. It defaults to
      `Asia/Kolkata` and does NOT fall back to the server clock.
- [ ] **Promote your first admin:** `npm run make:admin -- you@example.com --apply`.
      Register through the app first; the script promotes, it never creates.
      The `admin` role is not assignable through any API, by design.
- [ ] **Clear the demo data from any database that has been seeded:**
      `npm run purge:demo` for a dry run, then `-- --apply`. It refuses to
      delete anything a real user has booked.
- [ ] **Set `SEED_PASSWORD`** if you ever seed a non-local database. The old
      `player123` / `owner123` defaults are published in this repository; the
      seeder now refuses to run in production without one.

### Still on you

- [ ] **Razorpay live keys and `RAZORPAY_WEBHOOK_SECRET`.** Without the webhook
      secret every webhook is rejected, so a customer who closes the tab after
      paying is charged with no booking — `/payments/verify` from the browser is
      then the only path to "paid".
- [ ] **Run the lifecycle job from outside the process.** It ticks every 15
      minutes in-process, which does nothing while a free-tier dyno is asleep —
      no completions, no expiries, no reminders. Point a scheduler
      (cron-job.org is free) at `POST /api/cron/lifecycle` with the
      `x-cron-secret` header. `CRON_SECRET` is already generated by
      `render.yaml`.
- [ ] **Set up backups on Atlas.** The free tier has none.
- [ ] **Add `SENTRY_DSN`.** A 500 currently reaches an ephemeral log stream and
      nowhere else. The API already returns a `requestId` to correlate against.
- [ ] **Restrict the Atlas IP allow-list** to your API host.
- [ ] **Drop the wildcard from `CORS_ORIGINS`** once you no longer need preview
      deploys reaching the API. `https://your-app-*.vercel.app` is satisfied by
      any hostname someone else can register under that prefix. It does not
      expose sessions — auth is a bearer token, not a cookie — but list the
      exact production origin when you can.
- [ ] **Move off the free Render tier**, or accept a 30–50 second cold start on
      the first request after 15 minutes idle.
- [ ] Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET` if they are ever exposed.
- [ ] Decide how long a manual venue gets to answer. The lifecycle job expires
      an unanswered request 2 hours before kickoff, and never sooner than 45
      minutes after it was made (`MIN_REQUEST_AGE_MS` in
      `services/lifecycle.service.js`). Both numbers are guesses about your
      venues, not laws.
- [ ] Rate limiting is in-process. Buckets reset on restart and are not shared
      between instances, so move to a shared store (Redis) before running more
      than one dyno. The per-account defences — login throttle, reset cooldown,
      promo claims, every wallet check — are all in MongoDB and unaffected.
- [ ] Cash at the gate is OFF for every venue by default
      (`acceptsPayAtVenue`). Turn it on per venue, from the owner's settings
      screen, only for venues that genuinely collect cash — a pay-at-venue
      booking reserves a slot with no money moving, so it is the one method
      that can hold inventory for free. Unsettled cash bookings give the slot
      back an hour before kickoff (`GATE_CASH_GRACE_MS` in
      `services/lifecycle.service.js`).
- [ ] One account may hold at most 12 unpaid slots at a time
      (`MAX_UNSETTLED_SLOTS` in `controllers/booking.controller.js`). Raise it
      if you take group bookings that legitimately sit unpaid; lowering it
      tightens the ceiling on how much inventory one person can tie up.
- [ ] Payouts only ever count money the platform actually received —
      `payment.status: 'paid'`, excluding cash collected at the gate. If you
      settle gate cash with owners, that is a separate arrangement and this
      job deliberately does not model it.

---

## Cost at launch

| | Free tier | When you outgrow it |
| --- | --- | --- |
| Atlas M0 | 512 MB storage | ~$9/mo for M2 |
| Render | Sleeps after 15 min idle | $7/mo to stay warm |
| Vercel | 100 GB bandwidth | $20/mo Pro |
| OpenStreetMap tiles | Free | Consider a paid tile host above heavy usage |

Render's free tier sleeping is worth knowing about: the first request after idle
takes 30–50 seconds. Fine for a demo, not for a launch.
