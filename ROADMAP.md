# Development roadmap

Each phase ships something usable on its own. The database models for all five
phases were written up front, so later phases add routes and screens instead of
rewriting the schema.

---

## Phase 1 — Foundation, auth & discovery ✅ **built**

The skeleton everything else hangs off.

- Project split into `backend/` and `frontend/`
- Mongoose models for users, venues, courts, bookings, teams, TeamUp posts,
  reviews and wallet transactions
- JWT auth with refresh tokens, player / owner / admin roles
- Venue CRUD for owners
- Discovery API: text search, sport, city, price, rating, amenity and booking-type
  filters, four sort modes, pagination
- Geo search with a `2dsphere` index and adjustable radius
- Leaflet + OpenStreetMap map with custom pins
- Frontend: home, discovery, venue detail, map, login, register, profile,
  saved venues, owner venue list
- Mobile-ready shell: bottom tab bar, safe-area handling, Capacitor config

---

## Phase 2 — Slot booking & cancellations ✅ **built**

The movie-ticket booking experience.

**Backend — done**
- `GET /api/venues/:venueId/availability?date=&courtId=` builds the slot grid
  from operating hours and slot duration, and marks what's taken
- `POST /api/bookings/quote` prices a selection before the user commits
- `POST /api/bookings` creates the booking; automated venues confirm and charge
  instantly, manual venues create a `pending` request and charge nothing
- A multi-hour booking is stored as **one document per slot**, sharing a
  `groupRef` — that is what lets the unique partial index protect every hour,
  not just the first
- `PATCH /api/bookings/:groupRef/cancel` refunds per the venue's policy
  (full / partial / none) and credits the wallet
- `PATCH /api/bookings/:groupRef/decision` for owners to confirm or decline
- Wallet ledger — every credit and debit is a `Transaction` row
- Peak pricing applied automatically on weekday evenings and weekends
- Promo codes: `GAMEON50`, `FIRST20`, `WEEKEND15`, `SQUAD100`
- 38 unit tests over the pricing, peak and refund logic (`npm test`)

**Frontend — done**
- Date strip, court tabs and a live slot grid — available, selected, peak,
  taken and past slots all visually distinct
- Multi-slot selection for back-to-back hours, priced live by the server
- Review step: player count, promo code, payment method, policy reminder
- Ticket-style confirmation with a booking reference, QR block and confetti
- "My bookings" with upcoming / past tabs and a cancel flow that shows the
  exact refund before you commit
- Wallet page with balance, top-up and the full transaction ledger
- Owner request queue — confirm or decline assisted bookings in one tap

---

## Phase 3 — TeamUp & loyalty ✅ **built**

The social layer, and the feature nothing else in the market does well.

**Backend — done**
- `GET /api/teamup` geo-filtered feed; sport, type, skill, date-window and
  distance filters, plus "hosting" and "joined" views
- `POST /api/teamup` create a post; linking one of your own bookings is
  verified against ownership before the venue and time are copied across
- `POST /api/teamup/:id/join` and `DELETE` to withdraw
- `PATCH /api/teamup/:id/requests/:requestId` host accepts or declines;
  auto-approve is an option
- `POST /api/teamup/:id/settle` collects every player's share into the host's
  wallet, once, with failures reported rather than swallowed
- Team CRUD, single-use `crypto`-random invite codes, captaincy transfer
- Posts past their kickoff expire automatically so the feed stays honest

**Loyalty — done**
- Four tiers: Rookie → Pro (500) → Elite (2,000) → Legend (5,000 lifetime points)
- Perks scale by tier: platform-fee discount (0/25/50/100%), earn multiplier
  (1×/1.25×/1.5×/2×), and extra advance-booking days (0/3/7/14)
- `lifetimePoints` never decreases, so redeeming points cannot demote you
- Points revoked on cancellation, so book-and-cancel cannot farm status
- Redemption converts points to wallet credit atomically
- `GET /api/loyalty`, `GET /api/loyalty/tiers`, `POST /api/loyalty/redeem`

**Frontend — done**
- TeamUp feed with filled/empty spot pips, cost-split badges and host chips
- Post-a-game modal that can attach an existing booking
- Game detail page: squad list, host request inbox, settle-up, join with a message
- Teams page: roster, invite codes, "you're short — post on TeamUp" nudge
- Loyalty page: tier card with progress bar, perks, redemption, tier ladder
- Tier badges throughout the app

**Still to come here**
- Group chat once a game fills up
- Reliability score adjusting automatically on no-shows

---

## Phase 4 — Owner dashboard, analytics, payments & moderation ✅ **built**

**Analytics — done**
- Overview KPIs with period-on-period deltas: revenue, bookings, occupancy,
  average booking value, cancellation rate, unique and repeat customers
- Occupancy is computed against each venue's *real* sellable hours (operating
  hours × slot length × active courts), not a flat 24-hour denominator
- Daily revenue series, zero-filled so the chart has no gaps
- Breakdown by court, sport and venue
- Peak-hours histogram, so an owner can price peak from evidence
- Customer list ranked by spend — deliberately without players' email or phone
- Rating average and distribution

**Calendar — done**
- Day view across every court, showing who booked what and whether it is paid
- Blackouts take a slot, a court or a whole day out of service
- Blacking out a window with live bookings in it is refused, not silently applied
- Venue settings: operating hours, slot length, advance-booking window,
  cancellation policy — with a guard against re-phasing the grid under
  existing bookings

**Promos — done**
- Owner-managed codes with percent or flat discounts, caps, minimum spend,
  per-customer limits, total claim limits and expiry
- Owner codes override platform codes at that owner's venues
- Codes cannot be renamed once shared; deactivating preserves history

**Payments — done**
- Razorpay behind a feature flag: set the keys and the gateway is live, leave
  them empty and the wallet simulation runs. No SDK — orders are REST and
  signature verification is an HMAC, so there is no extra supply-chain surface
- Order creation prices from the database, never from the request
- Signature verification is timing-safe; the gateway is asked to confirm the
  capture and the amount before anything is marked paid
- A payment id can settle exactly one booking, ever
- Webhook verified against the raw request bytes, with its own rate limiter
- The gateway routes are disabled entirely when no gateway is configured

**Payouts — done**
- Weekly settlement per owner, gross minus per-venue commission
- Stable period boundaries, so a rerun updates rather than paying twice
- Owner-facing payout history and next-payout estimate

**Admin — done**
- Venue moderation queue with approve/reject, closing the Phase 3 gap where
  approving a listing meant a `mongosh` command
- Owner verification, account suspension (which also kills every live session)
- Platform stats including wallet liability and the current payment mode
- Ledger view and payout runner

**Still to come here**
- Featured-listing purchase (the `isFeatured` flag exists, nothing sells it)
- Bulk calendar operations (recurring blackouts, seasonal hours)

---

## Phase 5 — Mobile app, lifecycle & production hardening ✅ **built**

**Native shell**
- Capacitor wrap for Android and iOS; native GPS through
  `@capacitor/geolocation` (the existing `useGeolocation` hook picks it up)
- Push notifications for confirmations, TeamUp requests and reminders, with the
  token unregistered on logout so a shared phone stops receiving the last
  account's notifications
- Native share sheet, haptics, Android back button, status bar styling
- Secure token storage via `@capacitor/preferences` — the Keychain on iOS,
  encrypted SharedPreferences on Android. Session restore *awaits* that read;
  checking for a token before it completes logged the user out on every launch
- Offline shell (service worker) that opens without a connection. Authenticated
  responses are never cached, because the Cache API keys on the URL and not on
  the session — one user's bookings would otherwise be served to the next

**Lifecycle**

The three things nothing had ever done:
- Finished bookings become `COMPLETED`, incrementing `gamesPlayed` and asking
  for a review — windowed to games that ended in the last 48 hours, so the
  first run against an existing database does not send a wall of prompts
- Unanswered manual requests expire and release the slot, refunding anything
  that was paid up front, and never sooner than 45 minutes after the request
  was made
- `reliabilityScore` finally moves: +2 for a game you turned up to, −8 for
  withdrawing within 12 hours of kickoff *after being given a spot*

Every step claims its rows before acting on them, so running more than one API
instance is safe. It runs in-process every 15 minutes and can be triggered from
`POST /api/admin/lifecycle`.

**New in this phase**
- **Mark cash collected** — the owner records pay-at-venue money at the gate.
  Until they do, that revenue is invisible and the player cannot review
- Notification centre with per-type templates and a `booking_requested` type
  distinct from the day-before reminder
- The Docker stack actually works end to end: nginx now proxies `/api` to the
  API container, which it never did

See [MOBILE.md](./MOBILE.md) for the native build and
[DEPLOY.md](./DEPLOY.md) for going live.

---

## Later

- Tournament and league management (deck slide 8's revenue line)
- Coaching and equipment rental marketplace
- Premium memberships with priority slots
- Multi-city ops dashboard for the assisted-booking team
