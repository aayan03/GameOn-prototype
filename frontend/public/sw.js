/* eslint-env serviceworker */
/**
 * GameOn service worker.
 *
 * Strategy, chosen per resource type rather than one blanket rule:
 *
 *   navigation  → network first, cached shell as the offline fallback
 *   static      → cache first (hashed filenames, so they never go stale)
 *   API GET     → network first with a short-lived cache, so a flaky
 *                 connection shows the last known list instead of an error
 *   API writes  → never cached, never queued
 *
 * That last rule matters: replaying a queued POST after the user comes back
 * online is how people end up with two bookings for the same slot.
 */

const VERSION = 'gameon-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const OFFLINE_URL = './offline.html';

const SHELL_ASSETS = ['./', './index.html', './offline.html', './favicon.svg', './manifest.webmanifest'];

// How long an API response stays usable offline.
const DATA_TTL_MS = 10 * 60 * 1000;

// No skipWaiting() here on purpose. Activating a new worker underneath pages
// the old one is controlling swaps the asset manifest mid-session — the page
// asks for a chunk the new cache no longer has, reloads, and can land in a
// loop. The page asks for the handover explicitly via the message below.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_ASSETS))
      // A single missing asset must not stop the worker installing.
      .catch((err) => console.warn('[sw] precache partial:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  // The page asks a waiting worker to take over, once the user has accepted
  // the update prompt.
  if (event.data === 'SKIP_WAITING') self.skipWaiting();

  // Sign-out: drop every cached response before anyone else uses this device.
  if (event.data === 'CLEAR_DATA') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k.includes('-data')).map((k) => caches.delete(k))
      ))
    );
  }
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

/**
 * Is this request carrying a session?
 *
 * The Cache API keys on the URL, not on headers — so a cached
 * `/api/bookings` served to the next person on a shared laptop is the
 * previous user\'s bookings, wallet balance and phone number. Authenticated
 * responses are therefore never written to the cache at all. Offline reading
 * survives where it actually helps: venue lists, venue pages and config,
 * which carry no session and are the same for everyone.
 */
function isAuthenticated(request) {
  return request.headers.has('Authorization');
}

async function networkFirstData(request) {
  if (isAuthenticated(request)) return fetch(request);

  const cache = await caches.open(DATA);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      // Stamp the time so a stale entry can be labelled rather than trusted.
      const body = await fresh.clone().blob();
      const headers = new Headers(fresh.headers);
      headers.set('x-gameon-cached-at', String(Date.now()));
      await cache.put(request, new Response(body, { status: fresh.status, headers }));
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) {
      const at = Number(cached.headers.get('x-gameon-cached-at') || 0);
      if (Date.now() - at < DATA_TTL_MS) return cached;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;            // never cache a write

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !isApi(url)) return;   // let CDNs be

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(async () => (await caches.match(OFFLINE_URL)) || (await caches.match('./index.html')))
    );
    return;
  }

  if (isApi(url)) {
    // Auth and payment responses are per-session and must never be replayed
    // from a cache to a different user on a shared device.
    if (url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/payments')) return;
    event.respondWith(networkFirstData(request).catch(() => new Response(
      JSON.stringify({ success: false, error: { message: 'You are offline.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(request, copy));
      }
      return res;
    }).catch(() => cached || new Response('', {
      // `cached` is undefined on this path — it is the reason we went to the
      // network. Returning it made respondWith reject with a bare network
      // error and the browser showed its own failure page.
      status: 504,
      statusText: 'Offline',
    })))
  );
});

/* ── Push ────────────────────────────────────────────────────── */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { body: event.data.text() }; }

  event.waitUntil(self.registration.showNotification(payload.title || 'GameOn', {
    body: payload.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: payload.tag || 'gameon',
    data: { link: payload.link || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus an open tab rather than piling up new ones.
      for (const client of list) {
        if ('focus' in client) { client.navigate(link); return client.focus(); }
      }
      return self.clients.openWindow(link);
    })
  );
});
