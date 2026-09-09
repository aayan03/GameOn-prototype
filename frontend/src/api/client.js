/**
 * Single HTTP client for the whole app.
 *
 * Why this matters for the mobile app: when this project is wrapped with
 * Capacitor, the WebView has no dev server to proxy /api. Setting
 * VITE_API_URL at build time is the only change needed — no component
 * anywhere else touches a URL.
 */

import { secureStorage } from '../utils/platform.js';

const RAW_BASE = import.meta.env.VITE_API_URL || '';
export const API_BASE = RAW_BASE ? `${RAW_BASE.replace(/\/$/, '')}/api` : '/api';

// Same-origin `/api` is correct in development, where Vite proxies it, and in
// the Docker stack, where nginx proxies it. On a static host like Vercel or
// Netlify nothing serves `/api`, so say so loudly at boot rather than letting
// every screen fail with a parse error.
if (
  !RAW_BASE
  && typeof window !== 'undefined'
  && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
  && window.location.protocol !== 'capacitor:'
) {
  console.warn(
    '[GameOn] VITE_API_URL is not set, so API calls are going to this site\'s own origin '
    + `(${window.location.origin}/api). If the API is hosted elsewhere, set VITE_API_URL `
    + 'and redeploy — Vite bakes it in at build time.'
  );
}

// Long enough to cover a cold start on a sleeping free-tier host, short
// enough that a genuinely dead API does not hang the UI forever.
const REQUEST_TIMEOUT_MS = 75_000;
// When a request passes this, tell the UI so it can explain the wait.
const SLOW_AFTER_MS = 6_000;

const TOKEN_KEY = 'gameon_access_token';
const REFRESH_KEY = 'gameon_refresh_token';

/**
 * Token storage. Backed by localStorage on the web and by Capacitor
 * Preferences on a device — which is the Keychain on iOS and encrypted
 * SharedPreferences on Android. See utils/platform.js.
 */
export const tokenStore = {
  get access() { return secureStorage.get(TOKEN_KEY); },
  get refresh() { return secureStorage.get(REFRESH_KEY); },
  set(accessToken, refreshToken) {
    if (accessToken) secureStorage.set(TOKEN_KEY, accessToken);
    if (refreshToken) secureStorage.set(REFRESH_KEY, refreshToken);
  },
  clear() {
    secureStorage.remove(TOKEN_KEY);
    secureStorage.remove(REFRESH_KEY);
  },
};

/**
 * What to say when the response carries no message of its own.
 *
 * The API always sends `error.message`, so this only fires when something
 * BETWEEN the browser and the API answered instead: a sleeping dyno, a proxy,
 * a load balancer, a gateway timeout. Those are the moments a user is most
 * likely to give up, and "Request failed (500)" — which is what they used to
 * get — reads as though the app is broken rather than starting up.
 */
function fallbackMessage(status) {
  if (status === 429) return 'You are doing that a bit too quickly. Wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is waking up or briefly unavailable. Give it a few seconds and try again.';
  }
  if (status >= 500) return 'Something went wrong on our end. Please try again in a moment.';
  if (status === 404) return 'We could not find that.';
  if (status === 403) return 'You do not have access to that.';
  if (status === 401) return 'Please log in to continue.';
  return `That request could not be completed (${status}).`;
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details || null;
  }
}

let refreshingPromise = null;

async function attemptRefresh() {
  // Collapse parallel 401s into one refresh call.
  if (refreshingPromise) return refreshingPromise;
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return null;

  refreshingPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const newToken = json?.data?.accessToken;
      if (newToken) { tokenStore.set(newToken, null); return newToken; }
      return null;
    } catch { return null; }
    finally { refreshingPromise = null; }
  })();

  return refreshingPromise;
}

async function request(path, { method = 'GET', body, params, auth = true, retry = true } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) {
        url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
      }
    });
  }

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = tokenStore.access;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  // A free-tier host sleeps after idling and takes up to a minute to wake.
  // `fetch` has no default timeout, so without this the promise simply never
  // settles: the button spins, the list says "Searching…", and nothing ever
  // tells the user what is happening.
  const controller = new AbortController();
  const slowTimer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent('gameon:slow-request', { detail: { path } }));
  }, SLOW_AFTER_MS);
  const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(
        `The server did not respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds. `
        + 'On a free hosting tier the first request after a quiet spell has to wake the server — '
        + 'wait a moment and try again.',
        408
      );
    }
    // `fetch` rejects without detail for a CORS refusal, a DNS failure and a
    // dead server alike — the browser deliberately hides which, so the best
    // this can do is name the likely causes and the URL it actually tried.
    // "Is the backend running on port 5000?" was a development message that
    // meant nothing to someone looking at a deployed site.
    const sameOrigin = !RAW_BASE;
    throw new ApiError(
      sameOrigin
        ? 'Cannot reach the server. If you are running this locally, check the backend is started.'
        : `Cannot reach the API at ${RAW_BASE}. Either it is still starting up, or it is refusing this site's origin — `
          + `check CORS_ORIGINS on the API includes ${window.location.origin}. The browser console has the exact error.`,
      0
    );
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(abortTimer);
  }

  // Access token expired — refresh once, then replay the request.
  if (res.status === 401 && retry && tokenStore.refresh) {
    const fresh = await attemptRefresh();
    if (fresh) return request(path, { method, body, params, auth, retry: false });
    tokenStore.clear();
    // Same reasoning as logout: a dead session must not leave this person's
    // cached bookings and wallet sitting there for whoever signs in next.
    try {
      navigator.serviceWorker?.controller?.postMessage('CLEAR_DATA');
    } catch { /* no worker registered */ }
    window.dispatchEvent(new CustomEvent('gameon:session-expired'));
  }

  const text = await res.text();

  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // The body is not JSON at all. In a deployed app this almost always means
    // the request never reached the API: VITE_API_URL was empty at build
    // time, so `/api/...` resolved against the SITE's own origin and the host
    // answered with its 404 page. Parsing that gave people
    // "Unexpected token 'T'", which tells them nothing.
    const looksLikePage = /^\s*(<|The page)/i.test(text);
    throw new ApiError(
      looksLikePage
        ? `The API did not answer — ${API_BASE} returned a web page instead of data. On a deployed site this usually means VITE_API_URL is unset or wrong. It is baked in at build time, so it needs a fresh deploy after you change it.`
        : `The server sent a response that was not JSON (HTTP ${res.status}).`,
      res.status
    );
  }

  // Anything that came back at all means the server is awake.
  window.dispatchEvent(new CustomEvent('gameon:request-ok'));

  if (!res.ok || json.success === false) {
    throw new ApiError(
      json?.error?.message || fallbackMessage(res.status),
      res.status,
      json?.error?.details,
    );
  }

  return json;
}

export const api = {
  get:   (path, params, opts) => request(path, { ...opts, params }),
  post:  (path, body, opts)   => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts)   => request(path, { ...opts, method: 'PATCH', body }),
  // DELETE carries a body for the push-token unregister, which identifies the
  // device by its token rather than by a resource id in the path.
  del:   (path, opts)         => request(path, { ...opts, method: 'DELETE', body: opts?.body }),
};

export default api;
