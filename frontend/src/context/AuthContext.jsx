import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { authApi, notificationApi } from '../api/endpoints.js';
import { tokenStore } from '../api/client.js';
import { storageReady, getPushToken, clearPushToken, unsubscribeFromWebPush } from '../utils/platform.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on boot if a token survived from last time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // On a device the token lives in the Keychain, which is read
      // asynchronously. Checking for it before that read finishes means
      // logging the user out on every launch with a perfectly good token
      // sitting in storage. On the web this resolves immediately.
      await storageReady;
      if (cancelled) return;
      if (!tokenStore.access) { setLoading(false); return; }
      try {
        const { data } = await authApi.me();
        if (!cancelled) { setUser(data.user); setLoyalty(data.loyalty || null); }
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The API client fires this when a refresh token is dead.
  useEffect(() => {
    const onExpired = () => { setUser(null); setLoyalty(null); };
    window.addEventListener('gameon:session-expired', onExpired);
    return () => window.removeEventListener('gameon:session-expired', onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await authApi.login({ email, password });
    tokenStore.set(data.accessToken, data.refreshToken);
    setUser(data.user);
    setLoyalty(data.loyalty || null);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await authApi.register(payload);
    tokenStore.set(data.accessToken, data.refreshToken);
    setUser(data.user);
    setLoyalty(data.loyalty || null);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    /**
     * Tell the server first.
     *
     * Clearing local storage used to be the whole of logout, so the refresh
     * token stayed valid for its full thirty days — pressing Log out on a
     * shared machine removed the token from that browser and from nowhere
     * else. Revoking it server-side is what actually ends the session.
     *
     * Read before `tokenStore.clear()` below and not awaited: the request has
     * the value it needs the moment it is called, and making the user watch a
     * spinner to log out is how people close the tab instead.
     */
    try {
      const refreshToken = tokenStore.refresh;
      if (refreshToken) authApi.logout(refreshToken).catch(() => {});
    } catch { /* best effort — never block a logout */ }

    // Unregister the device, or this phone keeps receiving the previous
    // account's booking notifications after someone else signs in.
    //
    // Fired without awaiting: the request reads the access token
    // synchronously before it suspends on fetch, so it is still authenticated
    // even though the token is cleared on the next line. Awaiting it would
    // leave a user staring at a logged-in UI while the network hangs.
    try {
      const pushToken = getPushToken();
      if (pushToken) notificationApi.removePushToken(pushToken).catch(() => {});
      // The browser subscription too, or this device keeps receiving the
      // previous account's booking notifications after someone else signs in.
      unsubscribeFromWebPush().catch(() => {});
    } catch { /* best effort — never block a logout */ }

    // The service worker caches API responses. On a shared device those are
    // one user's bookings, wallet and notifications; drop them both from here
    // and inside the worker, since either may be the one holding them.
    try {
      navigator.serviceWorker?.controller?.postMessage('CLEAR_DATA');
    } catch { /* no worker registered */ }
    try {
      if (typeof caches !== 'undefined') {
        caches.keys()
          .then((keys) => Promise.all(
            keys.filter((k) => k.includes('data')).map((k) => caches.delete(k)),
          ))
          .catch(() => {});
      }
    } catch { /* noop */ }

    tokenStore.clear();
    clearPushToken();
    setUser(null);
    setLoyalty(null);
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const { data } = await authApi.updateMe(payload);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(() => ({
    user, loyalty, loading, login, register, logout, updateProfile,
    setUser, setLoyalty,
    isAuthenticated: Boolean(user),
    isOwner: user?.role === 'owner' || user?.role === 'admin',
  }), [user, loyalty, loading, login, register, logout, updateProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
