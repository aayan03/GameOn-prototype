import { useState, useCallback, useEffect } from 'react';

const CACHE_KEY = 'gameon_last_location';

/**
 * How long a remembered position is still worth believing.
 *
 * The cache used to have no expiry at all, and that was a correctness bug
 * with a user-visible lie attached: someone who granted location in Bengaluru
 * months ago and opened the site in Mumbai got Bengaluru venues under the
 * heading "Sorted by distance from where you are right now" — with the
 * browser permission showing DENIED and no prompt ever shown. Worse, the 30km
 * radius filter then hid every venue actually near them.
 *
 * Thirty minutes is long enough to survive a page reload, a tab restore and a
 * walk to the pitch, and short enough that it cannot follow you to another
 * city.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    // Anything written before this TTL existed has no `ts` and is discarded
    // rather than trusted — the whole point is not knowing how old it is.
    if (!cached?.ts || Date.now() - cached.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cached;
  } catch { return null; }
}

/**
 * Wraps the browser Geolocation API.
 *
 * Mobile note: Capacitor's @capacitor/geolocation plugin shims
 * navigator.geolocation, so this same hook works unchanged in the native
 * app — it just gets native GPS accuracy and the OS permission dialog.
 */
export default function useGeolocation({ auto = false } = {}) {
  const [coords, setCoords] = useState(() => readCache());
  const [status, setStatus] = useState(() => (readCache() ? 'cached' : 'idle'));
  const [error, setError] = useState(null);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Location is not supported by this browser.');
      setStatus('error');
      return Promise.resolve(null);
    }

    setStatus('loading');
    setError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            accuracy: pos.coords.accuracy,
            // Stamped, so readCache can tell how old it is.
            ts: Date.now(),
          };
          setCoords(next);
          setStatus('granted');
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* noop */ }
          resolve(next);
        },
        (err) => {
          const messages = {
            1: 'Location permission denied. You can still search by city.',
            2: 'Could not determine your location right now.',
            3: 'Location request timed out.',
          };
          setError(messages[err.code] || 'Location unavailable.');
          setStatus('error');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 }
      );
    });
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setStatus('idle');
    try { localStorage.removeItem(CACHE_KEY); } catch { /* noop */ }
  }, []);

  useEffect(() => { if (auto && !coords) request(); }, [auto, coords, request]);

  return { coords, status, error, request, clear, isLoading: status === 'loading' };
}
