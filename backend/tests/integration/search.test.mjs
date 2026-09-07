/**
 * Global search.
 *
 * The point of most of these is not "does it find things" but "does it refuse
 * to find things it should not". Search is a second door into every listing
 * on the site, and a door that skips moderation is worse than no door.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, get, resetDatabase, createUser,
} from '../helpers/harness.mjs';

after(stopTestServer);

let owner;

/** Everything below shares one fixture set — search does not mutate. */
before(async () => {
  await startTestServer();
  await resetDatabase();
  owner = await createUser({ role: 'owner', email: 'searchowner@test.local' });

  const { Venue, Event, Parlor, TeamUpPost } = await import('../../src/models/index.js');

  const baseVenue = {
    owner: owner.id,
    sports: ['football'],
    address: { line1: '1 Road', area: 'Koramangala', city: 'Bengaluru', pincode: '560034' },
    location: { type: 'Point', coordinates: [77.6, 12.93] },
    startingPrice: 800,
    slotDurationMins: 60,
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '06:00', close: '22:00', isClosed: false })),
  };

  await Venue.create([
    { ...baseVenue, name: 'Zenith Turf Park', moderationStatus: 'approved', isActive: true },
    // The two that must never surface.
    { ...baseVenue, name: 'Zenith Pending Turf', moderationStatus: 'pending', isActive: false },
    { ...baseVenue, name: 'Zenith Rejected Turf', moderationStatus: 'rejected', isActive: false },
  ]);

  const soon = new Date(Date.now() + 7 * 864e5);
  const past = new Date(Date.now() - 7 * 864e5);
  await Event.create([
    {
      title: 'Zenith Cup Finals', organiser: owner.id, type: 'tournament',
      startsAt: soon, endsAt: new Date(soon.getTime() + 3 * 36e5),
      location: { name: 'Zenith Grounds', city: 'Bengaluru' },
      moderationStatus: 'approved', isActive: true,
    },
    {
      title: 'Zenith Cup Last Year', organiser: owner.id, type: 'tournament',
      startsAt: past, endsAt: new Date(past.getTime() + 3 * 36e5),
      location: { name: 'Zenith Grounds', city: 'Bengaluru' },
      moderationStatus: 'approved', isActive: true,
    },
    {
      title: 'Zenith Cup Unapproved', organiser: owner.id, type: 'tournament',
      startsAt: soon, endsAt: new Date(soon.getTime() + 3 * 36e5),
      location: { name: 'Zenith Grounds', city: 'Bengaluru' },
      moderationStatus: 'pending', isActive: false,
    },
  ]);

  const baseParlor = {
    addedBy: owner.id,
    games: ['snooker'],
    address: { line1: '2 Road', area: 'Indiranagar', city: 'Bengaluru', pincode: '560038' },
    location: { type: 'Point', coordinates: [77.64, 12.97] },
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '11:00', close: '23:00', isClosed: false })),
    priceFrom: 200,
  };
  await Parlor.create([
    { ...baseParlor, name: 'Zenith Snooker Room', moderationStatus: 'approved', isActive: true },
    { ...baseParlor, name: 'Zenith Closed Forever', moderationStatus: 'approved', isActive: true, isPermanentlyClosed: true },
    { ...baseParlor, name: 'Zenith Unmoderated Hall', moderationStatus: 'pending', isActive: false },
  ]);

  await TeamUpPost.create([
    {
      host: owner.id, sport: 'football', title: 'Zenith 5-a-side needs two',
      playAt: soon, spotsNeeded: 2, proposedArea: 'Koramangala', status: 'open',
    },
    {
      host: owner.id, sport: 'football', title: 'Zenith cancelled kickabout',
      playAt: soon, spotsNeeded: 2, proposedArea: 'Koramangala', status: 'cancelled',
    },
  ]);
});

/* ── Shape ────────────────────────────────────────────────────── */

test('one query reaches every collection at once', async () => {
  const res = await get('/api/search?q=Zenith');
  assert.equal(res.status, 200);

  const { results, total, query } = res.body.data;
  assert.equal(query, 'Zenith');
  assert.deepEqual(Object.keys(results).sort(), ['event', 'game', 'parlor', 'venue']);
  assert.equal(total, 4, 'one visible row from each of the four collections');
});

test('every result carries the same fields, whatever it is', async () => {
  const { results } = (await get('/api/search?q=Zenith')).body.data;
  for (const rows of Object.values(results)) {
    for (const row of rows) {
      for (const key of ['id', 'type', 'title', 'subtitle', 'to']) {
        assert.ok(key in row, `${row.type} result is missing ${key}`);
      }
      assert.ok(row.to.startsWith('/'), 'the link is a route the client can navigate to');
    }
  }
});

/* ── Visibility: the part that matters ───────────────────────── */

test('a venue awaiting moderation is not findable', async () => {
  const { results } = (await get('/api/search?q=Zenith')).body.data;
  const names = results.venue.map((v) => v.title);
  assert.deepEqual(names, ['Zenith Turf Park']);
  assert.ok(!names.includes('Zenith Pending Turf'));
  assert.ok(!names.includes('Zenith Rejected Turf'));
});

test('search cannot be used to enumerate hidden listings by name', async () => {
  // Someone who already knows the exact name still gets nothing back.
  const res = await get('/api/search?q=Zenith%20Pending%20Turf');
  assert.equal(res.body.data.total, 0);
});

test('an unapproved parlour and a closed-down one stay out', async () => {
  const { results } = (await get('/api/search?q=Zenith')).body.data;
  assert.deepEqual(results.parlor.map((p) => p.title), ['Zenith Snooker Room']);
});

test('past events and unapproved events are both excluded', async () => {
  const { results } = (await get('/api/search?q=Zenith')).body.data;
  assert.deepEqual(results.event.map((e) => e.title), ['Zenith Cup Finals']);
});

test('only open games are offered', async () => {
  const { results } = (await get('/api/search?q=Zenith')).body.data;
  assert.deepEqual(results.game.map((g) => g.title), ['Zenith 5-a-side needs two']);
});

/* ── Matching ─────────────────────────────────────────────────── */

test('matching is case-insensitive', async () => {
  const lower = (await get('/api/search?q=zenith%20turf')).body.data;
  assert.equal(lower.results.venue.length, 1);
});

test('an area or city name finds what is there', async () => {
  const byArea = (await get('/api/search?q=Indiranagar')).body.data;
  assert.equal(byArea.results.parlor.length, 1);

  const byCity = (await get('/api/search?q=Bengaluru')).body.data;
  assert.ok(byCity.results.venue.length >= 1);
  assert.ok(byCity.results.event.length >= 1);
});

test('types= narrows the search to what the caller asked for', async () => {
  const res = await get('/api/search?q=Zenith&types=parlor,venue');
  assert.deepEqual(Object.keys(res.body.data.results).sort(), ['parlor', 'venue']);
  assert.equal(res.body.data.total, 2);
});

test('limit is applied per group', async () => {
  const res = await get('/api/search?q=Zenith&limit=1');
  assert.equal(res.status, 200);
  for (const rows of Object.values(res.body.data.results)) {
    assert.ok(rows.length <= 1);
  }
});

/* ── Input handling ───────────────────────────────────────────── */

test('a one-character query is rejected rather than answered', async () => {
  // It would match most of the database and tell the searcher nothing.
  assert.equal((await get('/api/search?q=z')).status, 400);
  assert.equal((await get('/api/search')).status, 400);
});

test('regex metacharacters are matched literally, not compiled', async () => {
  // Unescaped, this is a pattern that matches everything. Escaped, it matches
  // a venue literally called ".*" — of which there are none.
  const res = await get('/api/search?q=.*');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 0, 'a wildcard is treated as two characters of text');
});

test('a catastrophic-backtracking pattern is answered instantly', async () => {
  const evil = encodeURIComponent(`${'a+'.repeat(30)}b`);
  const started = Date.now();
  const res = await get(`/api/search?q=${evil}`);
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 2000, 'escaped input cannot backtrack');
});

test('an operator object cannot be smuggled in as the query', async () => {
  // q[$ne]= style injection: the schema wants a string and this is not one.
  const res = await get('/api/search?q[$ne]=zzz');
  assert.equal(res.status, 400);
});

test('an over-long query is rejected, not truncated silently', async () => {
  assert.equal((await get(`/api/search?q=${'a'.repeat(200)}`)).status, 400);
});

test('a query that matches nothing returns empty groups, not an error', async () => {
  const res = await get('/api/search?q=qwertyuiopnothing');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 0);
  assert.deepEqual(res.body.data.results.venue, []);
});

/* ── Matching on what a place offers, not just what it is called ──
   The reason this exists: of the three seeded parlours with a snooker
   table, exactly one has "Snooker" in its name. Searching names alone
   answered "snooker" with a third of the right answer. */

test('a sport finds venues that offer it', async () => {
  const { Venue } = await import('../../src/models/index.js');
  await Venue.create({
    name: 'Nothing In The Name', owner: owner.id, sports: ['badminton'],
    address: { line1: '3 Road', area: 'Whitefield', city: 'Bengaluru', pincode: '560066' },
    location: { type: 'Point', coordinates: [77.75, 12.97] },
    startingPrice: 500, slotDurationMins: 60,
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '06:00', close: '22:00', isClosed: false })),
    moderationStatus: 'approved', isActive: true,
  });

  const { results } = (await get('/api/search?q=badminton')).body.data;
  assert.deepEqual(results.venue.map((v) => v.title), ['Nothing In The Name']);
});

test('a game finds parlours that have it, however they are named', async () => {
  const { Parlor } = await import('../../src/models/index.js');
  await Parlor.create({
    name: 'Cue Masters Club', addedBy: owner.id, games: ['snooker', 'pool'],
    address: { line1: '4 Road', area: 'Whitefield', city: 'Bengaluru', pincode: '560066' },
    location: { type: 'Point', coordinates: [77.75, 12.97] },
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '12:00', close: '02:00', isClosed: false })),
    moderationStatus: 'approved', isActive: true,
  });

  const titles = (await get('/api/search?q=snooker')).body.data.results.parlor.map((p) => p.title);
  assert.ok(titles.includes('Cue Masters Club'), 'found by its table, not its name');
  assert.ok(titles.includes('Zenith Snooker Room'), 'and the one named for it is still there');
});

test('a sport finds open games looking for players', async () => {
  const { results } = (await get('/api/search?q=football')).body.data;
  assert.deepEqual(results.game.map((g) => g.title), ['Zenith 5-a-side needs two']);
});

test('matching a sport still cannot reach a hidden listing', async () => {
  const { Venue } = await import('../../src/models/index.js');
  await Venue.create({
    name: 'Secret Cricket Cage', owner: owner.id, sports: ['cricket'],
    address: { line1: '5 Road', area: 'Whitefield', city: 'Bengaluru', pincode: '560066' },
    location: { type: 'Point', coordinates: [77.75, 12.97] },
    startingPrice: 500, slotDurationMins: 60,
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '06:00', close: '22:00', isClosed: false })),
    moderationStatus: 'pending', isActive: false,
  });

  assert.equal((await get('/api/search?q=cricket')).body.data.total, 0);
});
