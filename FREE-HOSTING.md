# Putting GameOn on the internet, free

A prototype anyone can open in a browser. Total cost: ₹0. Time: about 40
minutes, most of it waiting for builds.

Three services, all with real free tiers:

| Piece | Service | What free means here |
| --- | --- | --- |
| Database | MongoDB Atlas | 512 MB, pauses after 30 days with no connections |
| API | Render | Sleeps after 15 min idle, ~1 min to wake, 750 hrs/month |
| Website | Vercel | Fast, always on, **personal/non-commercial use only** |
| Scheduler | cron-job.org | Runs the housekeeping job |

**Read this before you start.** Two limits will shape what you build:

- **Render sleeps.** After 15 minutes with no traffic your API shuts down. The
  next request takes about a minute while it boots. Whoever you are demoing to
  will think the site is broken unless you warm it up first. Step 6 deals with
  this, but there is no free way to make it disappear entirely.
- **Vercel's free plan is for non-commercial use.** Their fair-use terms say
  personal projects only. A prototype you show investors is fine. The day
  GameOn takes a real rupee from a real player, you need Vercel Pro ($20/mo) or
  a different host. Do not skip this and find out later.

You need a **GitHub account** — all three services deploy from a repository.

---

## Step 1 — Put the code on GitHub

Unzip the project, then in a terminal inside the `gameon` folder:

```bash
git init
git add .
git commit -m "GameOn prototype"
```

Create a new **empty** repository on GitHub (no README, no .gitignore — the
project has its own), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/gameon.git
git branch -M main
git push -u origin main
```

Check on GitHub that `backend/` and `frontend/` are both there, and that
`.env` is **not** — it is gitignored, which is why you will type the secrets
into each service by hand instead.

---

## Step 2 — Database (MongoDB Atlas)

1. Sign up at <https://www.mongodb.com/atlas> — no card needed for the free
   tier.
2. **Create a cluster** → choose **M0 / Free**. Pick the region closest to your
   users; for India that is usually Mumbai (`ap-south-1`).
3. **Database Access** → **Add New Database User**. Username `gameon`, click
   **Autogenerate Secure Password**, and **copy that password now** — Atlas
   will not show it again.
4. **Network Access** → **Add IP Address** → **Allow access from anywhere**
   (`0.0.0.0/0`).

   This is the honest trade-off: Render's free tier gives you no fixed IP to
   allow-list, so this is the only option that works. It means anyone who
   obtains your username and password can connect from anywhere. Acceptable for
   a prototype with fake data. Not acceptable once real people's phone numbers
   are in there.
5. **Connect** → **Drivers** → copy the connection string. It looks like:

   ```
   mongodb+srv://gameon:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   Two edits before you use it:
   - Replace `<password>` with the real password (no angle brackets)
   - Insert the database name `gameon` before the `?`

   Final form:

   ```
   mongodb+srv://gameon:YOURPASSWORD@cluster0.xxxxx.mongodb.net/gameon?retryWrites=true&w=majority
   ```

Keep it in a notes file. Step 3 needs it.

> If your password contains `@`, `:`, `/` or `#`, it will break the URL.
> Regenerate it until you get one without those, or percent-encode it.

---

## Step 3 — Generate your two secrets

The server refuses to start in production with weak, missing, default, or
identical JWT secrets. That is deliberate — a default signing secret means
anyone who has read this repo can mint themselves an admin token.

Run this twice and keep both values:

```bash
openssl rand -base64 48
```

On Windows without `openssl`, use PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object {Get-Random -Max 256}))
```

Label them `JWT_SECRET` and `JWT_REFRESH_SECRET`. They must be different from
each other.

---

## Step 4 — API (Render)

1. Sign up at <https://render.com> with GitHub.
2. **New** → **Web Service** → connect your `gameon` repository.
3. Settings:

   | Field | Value |
   | --- | --- |
   | Name | `gameon-api` |
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

   `npm install`, not `npm ci` — `npm ci` needs a committed `package-lock.json`
   and a fresh clone of this repo does not have one.

4. **Advanced** → **Health Check Path**: `/api/ready`
5. **Environment Variables** — add these one at a time:

   ```
   NODE_ENV          production
   MONGO_URI         <the string from step 2>
   JWT_SECRET        <first secret from step 3>
   JWT_REFRESH_SECRET <second secret from step 3>
   JWT_EXPIRES_IN    2h
   JWT_REFRESH_EXPIRES_IN 30d
   TRUST_PROXY       true
   LOG_LEVEL         combined
   CRON_SECRET       <run `openssl rand -hex 32` for a third value>
   CORS_ORIGINS      http://localhost:5173
   ```

   `TRUST_PROXY=true` is not optional on Render. Without it every request looks
   like it came from Render's load balancer, so per-IP rate limiting becomes
   one shared bucket for the entire internet — one abusive user locks out
   everybody.

   `CORS_ORIGINS` is a placeholder for now. Step 5 gives you the real URL and
   step 6 comes back to fix it.

6. **Create Web Service**. First build takes 3–5 minutes.
7. When it goes live, test it:

   ```
   https://gameon-api.onrender.com/api/health
   ```

   You want `{"success":true,"data":{"status":"up",...}}`. If you get a 502,
   open the **Logs** tab — a bad `MONGO_URI` and a rejected JWT secret both
   say so explicitly there.

**Copy your API URL.** It looks like `https://gameon-api.onrender.com`.

---

## Step 5 — Seed the database

Your site works but has no venues yet. Fill it from your own machine, pointing
at Atlas:

```bash
cd backend
npm install
MONGO_URI="<your atlas string>" npm run seed:demo
```

On Windows PowerShell:

```powershell
cd backend
npm install
$env:MONGO_URI="<your atlas string>"; npm run seed:demo
```

That gives you demo venues, demo accounts and sample bookings. `npm run seed`
adds the 22 real Lucknow venues as well — read the warning at the top of
`DEPLOY.md` before you use that one publicly. Those are real business names
with invented prices.

Demo logins after seeding:

- `aayan@gameon.app` / `player123` — a player with wallet balance
- `shivanshu@gameon.app` / `owner123` — a venue owner

---

## Step 6 — Website (Vercel)

1. Sign up at <https://vercel.com> with GitHub.
2. **Add New** → **Project** → import your `gameon` repository.
3. Settings:

   | Field | Value |
   | --- | --- |
   | Framework Preset | Vite |
   | Root Directory | `frontend` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |

4. **Environment Variables**:

   ```
   VITE_API_URL   https://gameon-api.onrender.com
   ```

   No trailing slash — the API client appends `/api` itself. This is baked in
   at build time, so changing it later means redeploying.

5. **Deploy**. Two to three minutes.

You now have a URL like `https://gameon.vercel.app`.

---

## Step 7 — Close the loop

The site will not talk to the API yet, because the API does not trust it. Go
back to **Render** → your service → **Environment** and change:

```
CORS_ORIGINS   https://gameon.vercel.app
```

Exactly that origin — no trailing slash, no path. Save; Render redeploys
automatically.

**Vercel preview deployments need a second entry.** Every deploy gets its own
hostname (`game-on-prototype-8wixop2c4-asa-0f21.vercel.app`), so an
exact-match list only ever works for your production URL. Set both,
comma-separated:

```
CORS_ORIGINS   https://game-on-prototype-tau.vercel.app,https://game-on-prototype-*.vercel.app
```

The `*` matches any run of characters **except a dot**, so it covers your
preview builds and nothing on another domain. Keep a real prefix in front of
it — `https://*.vercel.app` would give every app on vercel.app credentialed
access to your API, and the server refuses to boot if you write that.

Then open your Vercel URL and check:

1. Venues load on the home page
2. Sign up for a new account
3. Book a slot
4. Cancel it, and the refund lands in your wallet
5. Loyalty points move

If venues do not load, open the browser console (F12). A CORS error means
`CORS_ORIGINS` does not match your URL character for character.

---

## Step 8 — Keep the housekeeping running

The lifecycle job is what completes finished games, expires requests a venue
never answered, sends reminders and updates reliability scores. It runs on a
15-minute timer **inside** the API — which does nothing while Render has your
service asleep.

Wire an external scheduler to it:

1. Sign up at <https://cron-job.org> (free).
2. **Create cronjob**:
   - **URL**: `https://gameon-api.onrender.com/api/cron/lifecycle`
   - **Schedule**: every 30 minutes
   - **Advanced** → **Headers** → add `x-cron-secret` with the `CRON_SECRET`
     value from step 4
3. Save, then hit **Test run**. You want a `200` with a JSON body.

This does two jobs at once: it runs the housekeeping, and the traffic keeps
your API awake between calls.

**Watch the hours.** Render gives you 750 free instance-hours per month across
your whole account, and a service that never sleeps burns about 730. That fits
— barely, with one service and no room for a second. If you add another free
service, or ping every 5 minutes and redeploy often, you will hit the cap and
Render suspends **everything** until the 1st of next month.

If you are only demoing occasionally, a gentler setup is better: run the cron
every 6 hours, accept the cold start, and just load the site yourself a minute
before anyone else does.

---

## Step 9 — Make yourself an admin

The `admin` role cannot be assigned through any API endpoint — that is on
purpose, so a bug in registration can never hand someone the admin console.
Set it once, directly in the database.

In Atlas: **Browse Collections** → `gameon` → `users` → find your account →
edit → change `role` from `player` to `admin` → save.

Log out and back in. `/admin` appears in the navigation, with venue moderation,
owner verification, platform stats and the payout runner.

---

## What you have, and what you do not

**Working:** discovery with maps, slot booking, cancellations with real refund
policy, wallet, loyalty tiers, TeamUp, teams, owner dashboard with analytics,
promo codes, admin moderation, notifications, and an installable PWA.

**Not working, by design:**

- **Real payments.** Razorpay is fully implemented but switched off without
  keys. Card and UPI endpoints return `501` rather than pretending to verify
  signatures they have no secret for. The wallet simulation runs instead.
- **`/api/bookings/wallet/topup` mints money from nothing.** It is capped at
  ₹25,000/day per account and rate-limited, but it is a faucet. Fine for a
  prototype where the point is to demonstrate the flow. Delete it or wire it to
  a real Razorpay order before you take a single real rupee.
- **No email verification.** Anyone can register with any address, including as
  a venue owner — which is exactly why owner listings sit in a moderation queue
  instead of publishing straight away.
- **No backups.** Atlas free has none. If you delete the cluster, the data is
  gone.

---

## When something breaks

| Symptom | Cause |
| --- | --- |
| Site loads, no venues, console shows CORS | `CORS_ORIGINS` does not exactly match your Vercel URL |
| `Unexpected token 'T', "The page c"... is not valid JSON` | `VITE_API_URL` is unset or wrong, so the site is calling **itself** for `/api` and parsing its own 404 page. Fix the variable **and redeploy** — Vite bakes it in at build time, so saving alone changes nothing |
| Everything 404s or returns HTML | Same cause as above |
| Login button spins forever / venues stuck on "Searching…" | Render is asleep and waking. Wait up to a minute — the app now shows a banner saying so. If it still hangs after that, check CORS below |
| First request takes a minute | Render woke from sleep. Expected. See step 8 |
| Works on your main URL, fails on a Vercel preview link | Every Vercel deploy mints a NEW hostname, and `CORS_ORIGINS` is an exact-match list. Add a wildcard entry — see below |
| Render logs: "refusing to boot" | A JWT secret is missing, under 32 characters, still the example, or the same as the other one |
| Render logs: `MongoServerError: bad auth` | Wrong password in `MONGO_URI`, or you left the `<` `>` around it |
| Atlas connection times out | Network Access has no `0.0.0.0/0` entry |
| `/api/cron/lifecycle` returns 404 | `CRON_SECRET` is not set on Render. The route hides itself when unconfigured |
| `/api/cron/lifecycle` returns 401 | The `x-cron-secret` header does not match |
| Everything stopped on the 20th of the month | You burned the 750 free instance-hours. Wait for the 1st, or ping less often |

---

## If you outgrow the free tier

Cheapest path to a site that never sleeps:

| | Free | Next step |
| --- | --- | --- |
| Render | Sleeps, 750 hrs/mo | $7/mo, always warm |
| Atlas | 512 MB, no backups | ~$9/mo for M2 with backups |
| Vercel | Non-commercial only | $20/mo Pro |

The one to buy first is Render, because the cold start is what people notice.
The one you are legally obliged to buy first, the moment this stops being a
prototype and starts being a business, is Vercel.

---

## Appendix — will anything in this code bill me?

Short answer: **no.** Nothing in this repository can charge you money, because
nothing in it is wired to a payment-bearing account. Here is every outbound
call the code makes, audited rather than remembered.

| What it talks to | Needs a key? | Can it bill you? |
| --- | --- | --- |
| OpenStreetMap tiles | No | No. Free, donation-funded |
| CARTO basemap tiles | No | No, on the free basemap |
| Google Fonts | No | No |
| `images.unsplash.com` | No | No — plain image URLs in the demo seed |
| Razorpay API | **Yes** | Only if you set the keys — see below |
| MongoDB (your own database) | Connection string | Only if you pick a paid tier |

**Every npm dependency is free and open source**: express, mongoose, zod,
helmet, cors, morgan, bcryptjs, jsonwebtoken, express-rate-limit on the
backend; react, react-router, leaflet, react-leaflet on the frontend. No
SDK phones home. No analytics. No telemetry. No AI API.

### The one that could cost money, and why it will not

`services/payment.service.js` calls `api.razorpay.com`. That code is gated:

```js
export const isLive = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
```

With no keys set, `isLive()` is false, the card and UPI endpoints return `501`,
and the wallet simulation runs instead. The gateway is never contacted. You
would have to create a Razorpay account, get approved, and paste the keys in
yourself. Razorpay also charges per successful transaction, not for existing —
so even with keys set, a prototype nobody pays through costs nothing.

### What OpenStreetMap can do instead of billing you

OSM tiles are free and always will be, but the servers are donation-funded and
the [usage policy](https://operations.osmfoundation.org/policies/tiles/) is
enforced by **blocking, not billing**. A prototype with a handful of users is
squarely fine. If GameOn ever gets real traffic, move to a paid tile host
before they block you — bulk prefetching or offline tile caching will get you
blocked with no warning.

### The real risk of a public repo is not cost — it is secrets

This is what actually goes wrong when people push a project to GitHub:

- **`.env` is gitignored**, and `.env.example` contains only placeholders. Both
  are already correct in this repo. After your first push, open the repository
  on GitHub and confirm `backend/.env` is genuinely not there.
- **If you ever commit a secret, rotating it is the only fix.** Deleting the
  file in a later commit does nothing — it stays in the history, and bots scan
  public GitHub for exactly this within minutes. Generate new JWT secrets, a
  new Atlas password, and new Razorpay keys, then update them in Render.
- **`0.0.0.0/0` on Atlas plus a leaked password is a total loss.** The two
  together are what turn "I pushed a secret" into "someone dropped my
  database". That is why the connection string never belongs in the repo.
- **There is no Google Maps key in this project**, deliberately. Google Maps
  requires a billing account, and a leaked Maps key on a public repo is one of
  the most common ways people wake up to a four-figure bill. The map uses
  OpenStreetMap, which cannot be billed to anyone.

Turn on **GitHub → Settings → Code security → Secret scanning** (free on public
repositories) so GitHub tells you if a credential ever lands in a commit.

### If you would rather not publish the code at all

You do not have to make the repository public. **Private repositories are free
on GitHub**, unlimited, and Render and Vercel both deploy from them on their
free tiers. If the prototype is for investors rather than for other developers,
private is the better default — and it removes the secret-scanning risk
entirely.
