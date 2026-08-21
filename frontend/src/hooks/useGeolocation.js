import { useState, useCallback, useEffect } from 'react';

const CACHE_KEY = 'gameon_last_location';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
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
