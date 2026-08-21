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

  let res;
  try {
    res = await fetch(url.toString(), {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running on port 5000?', 0);
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
  const json = text ? JSON.parse(text) : {};

  if (!res.ok || json.success === false) {
    throw new ApiError(json?.error?.message || `Request failed (${res.status})`, res.status, json?.error?.details);
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
