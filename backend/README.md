# GameOn API

Node + Express + MongoDB. Every response has the shape
`{ success: true, data, meta? }` or `{ success: false, error: { message, details? } }`.

## Run it

```bash
npm install
cp .env.example .env
npm run dev          # nodemon on http://localhost:5000
npm start            # production
npm run seed         # reset and populate demo data (needs MONGO_URI)
npm test             # 38 unit tests over pricing, peak hours and refunds
```

With no `MONGO_URI` set, the server boots an in-memory MongoDB and seeds it
automatically. Nothing to install, but the data resets on restart.

## Layout

```
src/
├── config/       env, database connection, shared constants
├── models/       Mongoose schemas — all five phases
├── controllers/  request handlers + Zod validation schemas
├── routes/       endpoint definitions
├── middleware/   auth, role guards, validation, error handling
├── services/     token signing (payments and notifications go here next)
├── utils/        API errors, async wrapper, response helpers, geo maths
└── seed/         demo data and the seed scripts
```

## Endpoints

### Meta
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Liveness check |
| GET | `/api/config` | Sports, amenities, enums and phase status |

### Auth
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | — | `{ name, email, password, role?, phone?, city?, favoriteSports? }` |
| POST | `/api/auth/login` | — | Returns `accessToken` + `refreshToken` |
| POST | `/api/auth/refresh` | — | Exchange a refresh token for a new access token |
| GET | `/api/auth/me` | ✔ | Current user |
| PATCH | `/api/auth/me` | ✔ | Update profile, skill level, location |

Register and login are rate-limited to 30 attempts per 15 minutes per IP.

### Venues
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/venues` | — | Search and filter. See parameters below |
| GET | `/api/venues/map` | — | Lightweight pin payload for the map |
| GET | `/api/venues/meta/cities` | — | Cities with venue counts |
| GET | `/api/venues/:idOrSlug` | optional | Venue, reviews and your favourite state |
| POST | `/api/venues` | owner | Create a venue with courts |
| PATCH | `/api/venues/:id` | owner | Update your own venue |
| DELETE | `/api/venues/:id` | owner | Soft delete — booking history survives |
| GET | `/api/venues/owner/mine` | owner | Your venues |
| POST | `/api/venues/:id/favorite` | ✔ | Toggle saved |

### Bookings (Phase 2)
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/venues/:venueId/availability` | — | Slot grid. `?date=YYYY-MM-DD&courtId=` |
| POST | `/api/bookings/quote` | ✔ | Price a selection before committing |
| POST | `/api/bookings` | ✔ | Create the booking |
| GET | `/api/bookings` | ✔ | Your bookings, split upcoming / past |
| GET | `/api/bookings/:groupRef` | ✔ | One booking, with a refund preview |
| PATCH | `/api/bookings/:groupRef/cancel` | ✔ | Cancel and refund per policy |
| PATCH | `/api/bookings/:groupRef/decision` | owner | `{ decision: 'confirm' \| 'reject' }` |
| GET | `/api/bookings/owner/requests` | owner | Assisted-booking queue |
| GET | `/api/bookings/wallet` | ✔ | Balance and ledger |
| POST | `/api/bookings/wallet/topup` | ✔ | Mock top-up, ₹100–₹20,000 |
| GET | `/api/bookings/promos` | ✔ | Promo codes a user can try |

**Query parameters for `GET /api/venues`**

`q`, `sport`, `city`, `area`, `amenities` (comma-separated), `bookingMode`
(`automated` \| `manual`), `lat`, `lng`, `radiusKm`, `minPrice`, `maxPrice`,
`minRating`, `sort` (`distance` \| `rating` \| `price_low` \| `price_high` \|
`popular`), `page`, `limit`.

Passing `lat` and `lng` switches the query to a `$geoNear` aggregation and adds
`distanceKm` to every result.

## Notable design decisions

**Hybrid booking.** Every venue has a `bookingMode` of `automated` or `manual`.
Automated venues confirm instantly; manual ones create a `pending` booking that
an owner or the ops team confirms. This is the deck's core differentiator, so it
lives in the schema rather than being bolted on later.

**Double bookings are structurally impossible.** `Booking` carries a unique
partial index on `(court, date, startMinutes)` filtered to `slotLocked: true`.
Two simultaneous requests for the same slot cannot both succeed — the second
gets a duplicate-key error, which the error handler turns into a friendly
"that slot has just been taken" message. Cancelling flips `slotLocked` to false
and frees the slot again.

**Slot times are stored as minutes from midnight plus a `YYYY-MM-DD` date key**,
alongside real `Date` objects. Slot arithmetic on integers never has a timezone
bug; the `Date` fields are there for sorting and reminders.

**Geo queries use a real `2dsphere` index**, not a bounding-box approximation,
so "within 5 km" means 5 km.

**A multi-hour booking is one document per slot**, all sharing a `groupRef`.
Storing a 3-hour booking as a single row would leave the unique index guarding
only the first hour; per-slot rows mean every hour is protected. The API groups
them back together, so the client still sees one booking. If any slot in the
group fails to write, the whole group is deleted before the error is returned —
no half-booked, permanently locked slots.

**Manual venues are never charged up front.** A `pending` booking holds the slot
but takes no money; payment happens when the owner confirms. Anything else would
be charging for a slot nobody has agreed to.

**Refunds are quoted before they happen.** `refundFor()` is the single source of
truth, and the client shows its output in the cancel dialog, so the number the
user agrees to is the number they get.
