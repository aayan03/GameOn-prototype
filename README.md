# GameOn — Find. Book. Play.

A sports venue booking platform built from the GameOn investor deck. Players
discover turfs and courts near them, book slots the way they book movie
tickets, and use **TeamUp** to fill out a short-handed team.

Built as a web app that converts to a native Android/iOS app without a rewrite.

```
gameon/
├── backend/     Node + Express + MongoDB REST API
├── frontend/    React + Vite web app (Capacitor-ready)
├── DEPLOY.md    Going live, plus the full security checklist
├── ROADMAP.md   What each development phase delivers
└── MOBILE.md    Turning this into an Android/iOS app
```

> **Before you launch publicly**, read the first section of
> [DEPLOY.md](./DEPLOY.md). The Lucknow venues are real business names with
> unverified prices, and payments are simulated.

---

**Hosting it free as a prototype:** [FREE-HOSTING.md](./FREE-HOSTING.md) — Atlas + Render + Vercel, step by step, with the free-tier limits that actually bite.

## Quick start

You need **Node 18+**. MongoDB is optional — the backend starts an in-memory
database automatically in development and seeds it with demo venues.

**Terminal 1 — backend**

```bash
cd backend
npm install
cp .env.example .env      # already has working dev defaults
npm run dev
```

The API comes up on <http://localhost:5000>. On first boot with no `MONGO_URI`
it seeds 13 venues across Bengaluru, Mumbai, Delhi and Pune.

**Terminal 2 — frontend**

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### Demo logins

The login page offers these as one-tap buttons **in development only**. A
deployed build hides them unless `VITE_SHOW_DEMO_LOGINS=true` is set, because
the passwords below are public and the owner account can see that venue's
customer names, phone numbers and revenue. Delete or re-password the seeded
accounts before taking real traffic.

| Role | Email | Password |
| --- | --- | --- |
| Player (Elite tier) | `aayan@gameon.app` | `player123` |
| Player (Legend tier) | `vaishnavi@gameon.app` | `player123` |
| Venue owner | `shivanshu@gameon.app` | `owner123` |

---

## Tests

```bash
cd backend
npm run lint             # ESLint, both packages have a config
npm run test:unit        # pure functions: slot maths, pricing, refunds, loyalty
npm run test:integration # boots the API against an in-memory MongoDB
npm test                 # everything
```

The integration suite is the one that matters. It starts the real Express app
against a real database and drives it over HTTP — middleware, validators,
Mongoose indexes and controllers together. It covers auth and password reset,
the booking and refund flow, wallet and loyalty arithmetic, promo limits,
TeamUp, and every authorization boundary between players, owners and admins.

Several cases fire requests concurrently on purpose: two players racing for
the same slot, four redemptions of the same loyalty points, five joins for two
TeamUp spots. Those are the failures that never reproduce by hand.

---

## Using a real database

The in-memory database resets every time you stop the server. To keep your
data, create a free cluster at [MongoDB Atlas](https://www.mongodb.com/atlas)
and put the connection string in `backend/.env`:

```
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/gameon
```

Then seed it once:

```bash
cd backend
npm run seed            # demo venues + real Lucknow listings
npm run seed:demo       # demo venues only (recommended before launch)
npm run seed:lucknow    # Lucknow listings only
```

---

## What is built (Phases 1–4)

- **Auth** — register and log in as a player or a venue owner, JWT access
  tokens with silent refresh, role-protected routes
- **Venue discovery** — search, filter by sport, city, price, rating, booking
  type and amenities, sort by distance, price, rating or popularity
- **Geo search** — "near me" using the browser's GPS and a MongoDB `2dsphere`
  index, with an adjustable radius
- **Map** — Leaflet + OpenStreetMap, free and key-free, with custom pins per
  sport and a venue preview sheet
- **Venue detail** — gallery, courts and pricing, amenities, opening hours,
  cancellation policy, reviews, map and directions
- **Profile** — editable player profile, favourite sports, skill level,
  saved venues, wallet and loyalty balances
- **Owner view** — list of your venues with courts, bookings and ratings

**Phase 2 — booking**

- **Slot grid** — pick a date, pick a court, tap the hours you want. Available,
  selected, peak-priced, taken and past slots are all visually distinct
- **Multi-slot booking** — stack back-to-back hours in one booking
- **Live pricing** — peak rates on weekday evenings and weekends, promo codes,
  platform fee, all priced by the server so the total never lies
- **Instant vs assisted** — automated venues confirm and charge immediately;
  manual venues create a request and charge nothing until the owner confirms
- **No double bookings** — enforced by a unique database index, not by hope
- **Cancellations** — refund calculated from the venue's published policy and
  shown *before* you confirm, then credited to your wallet instantly
- **Wallet** — balance, top-ups and a full transaction ledger
- **Owner queue** — confirm or decline assisted bookings in one tap

**Phase 3 — TeamUp & loyalty**

- **TeamUp feed** — post an open game as "need players", "need an opponent" or
  "looking to join". Filter by sport, distance, skill level and date
- **Join requests** — ask to join with a message; the host accepts or declines,
  or turns on instant join
- **Cost splitting** — the slot total divides across everyone who joins, and the
  host collects it through the wallet in one tap
- **Teams** — create a squad, invite with single-use codes, and get nudged to
  post on TeamUp when you drop below a full side
- **Loyalty** — four tiers (Rookie → Pro → Elite → Legend) earned by playing.
  Higher tiers cut the platform fee, earn points faster and book further ahead.
  Points convert to wallet credit
- **Real Lucknow venues** — 22 listings from public directories, clearly marked
  unverified until claimed

**Phase 4 — owner dashboard, analytics, payments & moderation**

- **Analytics** — revenue trend, occupancy against real sellable hours, peak-hour
  demand, breakdown by court and sport, customer ranking, rating distribution
- **Calendar** — a day view across every court showing who booked what, plus
  blackouts for maintenance that refuse to strand a live booking
- **Promo codes** — owners run their own offers with caps, limits and expiry
- **Real payments** — Razorpay behind a feature flag. Keys present, gateway
  live; keys absent, wallet simulation. Timing-safe signature checks, webhook
  verified on raw bytes, and a payment id can settle exactly one booking
- **Payouts** — weekly settlement per owner, gross minus per-venue commission
- **Admin console** — venue moderation, owner verification, account suspension,
  platform stats and the ledger

Phase 5 (the Capacitor mobile app) is laid out in [ROADMAP.md](./ROADMAP.md).

---

## Security

The API is written defensively. The short version:

- Zod validation with `.strict()` on every write, so unknown fields are rejected
  rather than assigned
- MongoDB operators and dotted paths stripped from every request — the
  `{"$ne": null}` auth bypass does not work here
- All user input escaped before entering a regex, which closes both a ReDoS and
  a filter bypass in venue search
- Wallet and loyalty balances change through atomic conditional updates, so
  concurrent requests cannot overdraw
- Per-account lockout on top of per-IP rate limiting
- Token revocation via `tokenVersion` — changing a password really does sign
  other devices out
- The server refuses to boot in production with default secrets or open CORS

The complete checklist, including what is still your responsibility, is in
[DEPLOY.md](./DEPLOY.md#security-checklist).

Run the test suites:

```bash
cd backend && npm test
```

That runs four suites, 117 assertions:

| Suite | Covers |
| --- | --- |
| `load.test.mjs` | Every backend module actually evaluates |
| `booking.test.mjs` | Time maths, peak hours, slot pricing, every refund tier |
| `loyalty.test.mjs` | Tier thresholds, multipliers, regex escaping, operator stripping |
| `phase4.test.mjs` | Local-date handling, payment signatures, schema shapes |

`load.test.mjs` exists because of a real bug: `schema.refine().partial()` throws
at import time and takes the whole API down, while passing every syntax check.
A parser cannot catch that — only actually loading the module can.

---

## Design

The interface is deliberately chunky and playful: thick ink outlines, hard
offset shadows with no blur, oversized display type, and buttons that sink into
their own shadow when pressed. Colours come straight from the investor deck —
ink `#16162B`, volt lime `#D6FF3F`, magenta `#FF3E7F`, violet `#6C3CE9`.

Motion is used where it carries meaning rather than for decoration: content
reveals as you scroll, stat counters run up when they come into view, selected
slots pop with a spring curve, and a confirmed booking gets confetti. Every
animation is disabled automatically under `prefers-reduced-motion`.

---

## Why it's split into two folders

`backend/` and `frontend/` are completely independent applications. They share
nothing but the HTTP contract, which means:

- You can deploy them separately (Render + Vercel, for example)
- The frontend can be replaced by the mobile app with no backend change
- Two people can work on the two halves without stepping on each other

The only line connecting them is `VITE_API_URL` in `frontend/.env`.

---

## Tech

| | |
| --- | --- |
| Frontend | React 18, Vite, React Router 6, Leaflet |
| Backend | Node, Express 4, Mongoose 8, JWT, Zod |
| Payments | Razorpay REST (no SDK), or a wallet simulation |
| Charts | Inline SVG, no charting library |
| Fonts | Outfit (display) + Inter (body), via Google Fonts |
| Database | MongoDB (in-memory in dev, Atlas in production) |
| Maps | OpenStreetMap tiles via Leaflet — no API key, no billing |
| Mobile | Capacitor (config already included) |
