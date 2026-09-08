/**
 * Community-submitted free public grounds.
 *
 * The feature is a map anybody can add to, so most of what matters is what
 * happens when somebody adds the wrong thing: nothing a stranger submits may
 * reach the public before a human has looked at it, the same park must not
 * land on the map nine times, and the contributor who found it gets credit
 * without getting control of public land.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, createUser, makeAdmin,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const PARK = { lat: 26.8540, lng: 80.9990 };

const body = (over = {}) => ({
  name: 'Nehru Community Ground',
  description: 'Open ground behind the school. Concrete cricket strip, no nets.',
  sports: ['cricket', 'football'],
  facilities: ['lit', 'drinking_water'],
  address: { area: 'Gomti Nagar', city: 'Lucknow', state: 'Uttar Pradesh' },
  ...PARK,
  access: { alwaysOpen: false, opensAt: '06:00', closesAt: '20:00', notes: 'Gate locked after dark' },
  surface: 'mud',
  ...over,
});

async function submitter(email = 'finder@test.local') {
  return createUser({ email });
}

/** The token is minted before the role changes, but `protect` re-reads the
 *  user on every request, so it sees the promotion. */
async function admin() {
  const a = await createUser({ email: `admin${Date.now()}${Math.random()}@test.local` });
  await makeAdmin(a.id);
  return a;
}

/* ── Submitting ───────────────────────────────────────────────── */

test('a signed-out visitor cannot submit anything', async () => {
  assert.equal((await post('/api/playgrounds', body())).status, 401);
});

test('an ordinary player can submit a ground', async () => {
  const user = await submitter();
  const res = await post('/api/playgrounds', body(), { token: user.token });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.data.message, /review/i);
  assert.equal(res.body.data.playground.name, 'Nehru Community Ground');
});

test('a submission does NOT go live on its own', async () => {
  const user = await submitter();
  await post('/api/playgrounds', body(), { token: user.token });

  // The whole safety property: user-generated content carrying a physical
  // address must not reach strangers unreviewed.
  assert.equal((await get('/api/playgrounds')).body.data.length, 0);
});

test('a submitter cannot publish their own by saying so', async () => {
  const user = await submitter();
  await post('/api/playgrounds', {
    ...body(), isActive: true, moderationStatus: 'approved',
  }, { token: user.token });

  const { Playground } = await import('../../src/models/index.js');
  const pg = await Playground.findOne({}).lean();
  assert.equal(pg.isActive, false);
  assert.equal(pg.moderationStatus, 'pending');
});

test('the submitter can see their own while it waits', async () => {
  const user = await submitter();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  const mine = await get(`/api/playgrounds/${playground._id}`, { token: user.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.moderationStatus, 'pending');

  // But a stranger cannot.
  const other = await submitter('stranger@test.local');
  assert.equal((await get(`/api/playgrounds/${playground._id}`, { token: other.token })).status, 404);
  assert.equal((await get(`/api/playgrounds/${playground._id}`)).status, 404);
});

test('a ground needs at least one sport and a location', async () => {
  const user = await submitter();
  const noSport = await post('/api/playgrounds', { ...body(), sports: [] }, { token: user.token });
  assert.equal(noSport.status, 400);

  const { lat: _lat, ...noLat } = body();
  assert.equal((await post('/api/playgrounds', noLat, { token: user.token })).status, 400);
});

/* ── The same park, twice ─────────────────────────────────────── */

test('a ground already on the map is refused', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`, { decision: 'approve' }, { token: a.token });

  // Same spot, different name — which is how this actually happens.
  const other = await submitter('second@test.local');
  const dupe = await post('/api/playgrounds', body({ name: 'the park near the school' }), { token: other.token });

  assert.equal(dupe.status, 409);
  assert.match(dupe.body.error.message, /already listed/i);
});

test('a ground still in the queue also blocks a duplicate', async () => {
  // Two people submitting the same new park within an hour is the common
  // case; catching it here saves reviewing the same ground twice.
  const one = await submitter('one@test.local');
  await post('/api/playgrounds', body(), { token: one.token });

  const two = await submitter('two@test.local');
  const dupe = await post('/api/playgrounds', body({ name: 'Totally Different Name' }), { token: two.token });

  assert.equal(dupe.status, 409);
  assert.match(dupe.body.error.message, /waiting to be reviewed/i);
});

test('a genuinely different ground down the road is accepted', async () => {
  const one = await submitter('a@test.local');
  await post('/api/playgrounds', body(), { token: one.token });

  // ~500m away — well outside the 120m duplicate radius.
  const two = await submitter('b@test.local');
  const far = await post('/api/playgrounds', body({
    name: 'Riverside Maidan', lat: PARK.lat + 0.0045, lng: PARK.lng,
  }), { token: two.token });

  assert.equal(far.status, 201);
});

test('one account cannot flood the queue', async () => {
  const user = await submitter();
  for (let i = 0; i < 5; i += 1) {
    const res = await post('/api/playgrounds', body({
      name: `Ground ${i}`, lat: PARK.lat + i * 0.01, lng: PARK.lng,
    }), { token: user.token });
    assert.equal(res.status, 201, `submission ${i} should be accepted`);
  }

  const sixth = await post('/api/playgrounds', body({
    name: 'Ground 6', lat: PARK.lat + 0.09, lng: PARK.lng,
  }), { token: user.token });
  assert.equal(sixth.status, 400);
  assert.match(sixth.body.error.message, /still being reviewed/i);
});

/* ── Moderation ───────────────────────────────────────────────── */

test('only an admin can approve', async () => {
  const user = await submitter();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  const self = await patch(`/api/playgrounds/${playground._id}/moderate`,
    { decision: 'approve' }, { token: user.token });
  assert.equal(self.status, 403);
});

test('approving puts it on the public map', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  const res = await patch(`/api/playgrounds/${playground._id}/moderate`,
    { decision: 'approve' }, { token: a.token });
  assert.equal(res.status, 200);

  const list = await get('/api/playgrounds');
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].name, 'Nehru Community Ground');

  // And it is readable by a signed-out visitor, which is the whole point.
  assert.equal((await get(`/api/playgrounds/${playground.slug}`)).status, 200);
});

test('rejecting keeps it off the map', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  await patch(`/api/playgrounds/${playground._id}/moderate`,
    { decision: 'reject', note: 'This is private land.' }, { token: a.token });

  assert.equal((await get('/api/playgrounds')).body.data.length, 0);
  assert.equal((await get(`/api/playgrounds/${playground._id}`)).status, 404);
});

test('the contributor is told either way', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  await patch(`/api/playgrounds/${playground._id}/moderate`,
    { decision: 'approve' }, { token: a.token });

  const { Notification } = await import('../../src/models/index.js');
  const note = await Notification.findOne({ user: user.id }).sort({ createdAt: -1 }).lean();
  assert.equal(note.type, 'playground_approved');
  assert.match(note.body, /Nehru Community Ground/);
  assert.match(note.link, /^\/playgrounds\//);
});

test('a rejection carries the reason so it can be fixed', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  await patch(`/api/playgrounds/${playground._id}/moderate`,
    { decision: 'reject', note: 'This is private land.' }, { token: a.token });

  const { Notification } = await import('../../src/models/index.js');
  const note = await Notification.findOne({ user: user.id }).sort({ createdAt: -1 }).lean();
  assert.equal(note.type, 'playground_rejected');
  assert.match(note.body, /private land/i);
});

test('the moderation trail is not public', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`,
    { decision: 'approve', note: 'Checked against the ward map.' }, { token: a.token });

  const pub = (await get(`/api/playgrounds/${playground.slug}`)).body.data;
  assert.equal(pub.moderationNote, undefined, 'internal note stays internal');
  assert.equal(pub.moderatedBy, undefined, 'which admin reviewed it is not public');
  assert.equal(pub.reportCount, undefined);
});

/* ── Credit, not ownership ───────────────────────────────────── */

test('the submitter can correct their own while it is pending', async () => {
  const user = await submitter();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  const res = await patch(`/api/playgrounds/${playground._id}`,
    { name: 'Nehru Ground (east gate)' }, { token: user.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Nehru Ground (east gate)');
});

test('once live it is no longer theirs to rewrite', async () => {
  // Public land is not the finder's to gate, and a listing approved as a park
  // must not be quietly edited into something else afterwards.
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`, { decision: 'approve' }, { token: a.token });

  const res = await patch(`/api/playgrounds/${playground._id}`,
    { name: 'Something Else Entirely' }, { token: user.token });
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /already been reviewed/i);
});

test('somebody else cannot edit a submission at all', async () => {
  const user = await submitter();
  const other = await submitter('nosy@test.local');
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;

  assert.equal(
    (await patch(`/api/playgrounds/${playground._id}`, { name: 'Mine now' }, { token: other.token })).status,
    403
  );
});

/* ── Finding one ──────────────────────────────────────────────── */

test('the list filters by sport and city, and finds by name', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`, { decision: 'approve' }, { token: a.token });

  assert.equal((await get('/api/playgrounds?sport=cricket')).body.data.length, 1);
  assert.equal((await get('/api/playgrounds?sport=tennis')).body.data.length, 0);
  assert.equal((await get('/api/playgrounds?city=Lucknow')).body.data.length, 1);
  assert.equal((await get('/api/playgrounds?q=Nehru')).body.data.length, 1);
  assert.equal((await get('/api/playgrounds?facilities=lit')).body.data.length, 1);
});

test('near-me returns a distance', async () => {
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`, { decision: 'approve' }, { token: a.token });

  const res = await get(`/api/playgrounds?lat=${PARK.lat}&lng=${PARK.lng}&radiusKm=5`);
  assert.equal(res.body.data.length, 1);
  assert.ok(res.body.data[0].distanceKm < 0.2);
});

test('a wildcard query is matched literally', async () => {
  assert.equal((await get('/api/playgrounds?q=.*')).status, 200);
  assert.equal((await get('/api/playgrounds?q=.*')).body.data.length, 0);
});

test('my submissions shows where each one got to', async () => {
  const user = await submitter();
  const a = await admin();
  const first = (await post('/api/playgrounds', body(), { token: user.token })).body.data.playground;
  await post('/api/playgrounds', body({ name: 'Second', lat: PARK.lat + 0.02 }), { token: user.token });
  await patch(`/api/playgrounds/${first._id}/moderate`, { decision: 'approve' }, { token: a.token });

  const mine = await get('/api/playgrounds/mine', { token: user.token });
  assert.equal(mine.body.data.length, 2);
  const statuses = mine.body.data.map((p) => p.moderationStatus).sort();
  assert.deepEqual(statuses, ['approved', 'pending']);
});

/* ── Reporting ────────────────────────────────────────────────── */

test('a report is counted, not acted on', async () => {
  // One annoyed person must not get a delete button for a ground they simply
  // do not like.
  const user = await submitter();
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`, { decision: 'approve' }, { token: a.token });

  const reporter = await submitter('reporter@test.local');
  assert.equal((await post(`/api/playgrounds/${playground._id}/report`, {}, { token: reporter.token })).status, 200);

  assert.equal((await get('/api/playgrounds')).body.data.length, 1, 'still live');

  const { Playground } = await import('../../src/models/index.js');
  assert.equal((await Playground.findById(playground._id).lean()).reportCount, 1);
});

/* ── Admin queue ──────────────────────────────────────────────── */

test('the queue is admin-only and shows who submitted what', async () => {
  const user = await submitter();
  const a = await admin();
  await post('/api/playgrounds', body(), { token: user.token });

  assert.equal((await get('/api/playgrounds/admin/queue', { token: user.token })).status, 403);

  const q = await get('/api/playgrounds/admin/queue', { token: a.token });
  assert.equal(q.status, 200);
  assert.equal(q.body.data.length, 1);
  assert.equal(q.body.data[0].submittedBy.email, 'finder@test.local');
});

/* ── Telling the admins there is work ─────────────────────────── */

test('every admin is notified when a ground is submitted', async () => {
  // Without this the queue is a page somebody has to remember to visit, and
  // the "usually within a day" promised to the contributor is not kept.
  const a1 = await admin();
  const a2 = await admin();
  const user = await submitter();

  await post('/api/playgrounds', body(), { token: user.token });

  const { Notification } = await import('../../src/models/index.js');
  const sent = await Notification.find({ type: 'playground_submitted' }).lean();

  assert.equal(sent.length, 2, 'both admins hear about it');
  assert.deepEqual(
    sent.map((n) => String(n.user)).sort(),
    [String(a1.id), String(a2.id)].sort()
  );
  assert.match(sent[0].body, /Nehru Community Ground/);
  assert.match(sent[0].body, /Lucknow/);
  assert.equal(sent[0].link, '/admin');
});

test('the contributor is not spammed with their own submission', async () => {
  await admin();
  const user = await submitter();
  await post('/api/playgrounds', body(), { token: user.token });

  const { Notification } = await import('../../src/models/index.js');
  assert.equal(
    await Notification.countDocuments({ user: user.id, type: 'playground_submitted' }),
    0
  );
});

test('a submission still succeeds when there are no admins to tell', async () => {
  const user = await submitter();
  const res = await post('/api/playgrounds', body(), { token: user.token });
  assert.equal(res.status, 201, 'the row matters more than the notification');
});

/* ── Taking one down, and keeping one right ──────────────────── */

async function liveGround() {
  const user = await submitter(`f${Date.now()}${Math.random()}@test.local`);
  const a = await admin();
  const { playground } = (await post('/api/playgrounds', body(), { token: user.token })).body.data;
  await patch(`/api/playgrounds/${playground._id}/moderate`, { decision: 'approve' }, { token: a.token });
  return { user, a, playground };
}

test('an admin can take a live ground off the map', async () => {
  const { a, playground } = await liveGround();
  assert.equal((await get('/api/playgrounds')).body.data.length, 1);

  const res = await patch(`/api/playgrounds/${playground._id}/unpublish`,
    { note: 'Built on — no longer a ground.' }, { token: a.token });
  assert.equal(res.status, 200);
  assert.equal((await get('/api/playgrounds')).body.data.length, 0);
});

test('the contributor is told when their ground comes down', async () => {
  const { user, a, playground } = await liveGround();
  await patch(`/api/playgrounds/${playground._id}/unpublish`,
    { note: 'Turned out to be private land.' }, { token: a.token });

  const { Notification } = await import('../../src/models/index.js');
  const n = await Notification.findOne({ user: user.id, type: 'playground_rejected' }).lean();
  assert.match(n.body, /private land/i);
});

test('only an admin can unpublish', async () => {
  const { user, playground } = await liveGround();
  assert.equal(
    (await patch(`/api/playgrounds/${playground._id}/unpublish`, {}, { token: user.token })).status,
    403
  );
});

test('one person cannot raise the report count by tapping twice', async () => {
  // Otherwise a single account reaches the alert threshold on its own.
  const { playground } = await liveGround();
  const r = await submitter('rep1@test.local');

  await post(`/api/playgrounds/${playground._id}/report`, {}, { token: r.token });
  await post(`/api/playgrounds/${playground._id}/report`, {}, { token: r.token });
  await post(`/api/playgrounds/${playground._id}/report`, {}, { token: r.token });

  const { Playground } = await import('../../src/models/index.js');
  assert.equal((await Playground.findById(playground._id).lean()).reportCount, 1);
});

test('three separate people pull in the admins, and it stays live', async () => {
  const { playground } = await liveGround();
  for (const e of ['r1@test.local', 'r2@test.local', 'r3@test.local']) {
    const r = await submitter(e);
    await post(`/api/playgrounds/${playground._id}/report`, {}, { token: r.token });
  }

  const { Notification, Playground } = await import('../../src/models/index.js');
  const alert = await Notification.findOne({ title: /being reported/i }).lean();
  assert.ok(alert, 'admins were told');
  // Still live: a listing that vanishes on a vote is one anybody can delete.
  assert.equal((await Playground.findById(playground._id).lean()).isActive, true);
});

test('who reported a ground never leaves the server', async () => {
  const { playground } = await liveGround();
  const r = await submitter('secret@test.local');
  await post(`/api/playgrounds/${playground._id}/report`, {}, { token: r.token });

  const pub = (await get(`/api/playgrounds/${playground.slug}`)).body.data;
  assert.equal(pub.reportedBy, undefined);
  assert.equal(pub.reportCount, undefined);
  assert.equal((await get('/api/playgrounds')).body.data[0].reportedBy, undefined);
});

test('anyone signed in can suggest a correction to a live ground', async () => {
  const { playground } = await liveGround();
  const passer = await submitter('passerby@test.local');

  const res = await post(`/api/playgrounds/${playground._id}/correction`,
    { text: 'The floodlights have been removed since this was added.' }, { token: passer.token });
  assert.equal(res.status, 200);

  const { Notification } = await import('../../src/models/index.js');
  const n = await Notification.findOne({ title: /Correction suggested/i }).lean();
  assert.match(n.body, /floodlights/i);
});

test('a correction changes nothing on its own', async () => {
  // The published row only ever moves by a human decision.
  const { playground } = await liveGround();
  const passer = await submitter('passerby2@test.local');
  await post(`/api/playgrounds/${playground._id}/correction`,
    { text: 'The name is spelled differently on the gate.' }, { token: passer.token });

  const { Playground } = await import('../../src/models/index.js');
  const after = await Playground.findById(playground._id).lean();
  assert.equal(after.name, 'Nehru Community Ground');
  assert.equal(after.isActive, true);
});

test('a one-word correction is refused', async () => {
  const { playground } = await liveGround();
  const passer = await submitter('passerby3@test.local');
  assert.equal(
    (await post(`/api/playgrounds/${playground._id}/correction`, { text: 'bad' }, { token: passer.token })).status,
    400
  );
});
