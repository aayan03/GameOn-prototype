/**
 * Platform bridge.
 *
 * The same React build runs in three places: a browser tab, an installed PWA,
 * and a Capacitor WebView. Everything that differs between them is resolved
 * here, so no component ever has to ask "am I native?".
 *
 * Capacitor plugins are imported dynamically and every call is wrapped, so a
 * web build that has never installed them still works — the import simply
 * fails and we fall back to the web API.
 */

export const isNative = () =>
  typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());

export const nativePlatform = () =>
  (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';

/** True when running as an installed PWA rather than a browser tab. */
export const isStandalone = () =>
  typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );

/** Loads a Capacitor plugin, or null if it is not installed. */
async function plugin(name) {
  if (!isNative()) return null;
  try {
    const mod = await import(/* @vite-ignore */ `@capacitor/${name}`);
    return mod;
  } catch {
    return null;
  }
}

/* ── Secure token storage ────────────────────────────────────── */
/**
 * On the web this is localStorage. On a device it is Preferences, which maps
 * to the Keychain on iOS and encrypted SharedPreferences on Android — a real
 * improvement over a WebView's localStorage, which is readable on a rooted
 * device.
 *
 * The reads are synchronous by necessity (the API client needs a token before
 * the first request), so the native store is mirrored into memory on boot.
 */
const memory = new Map();
let nativeStore = null;

/**
 * Resolves once storage is usable.
 *
 * A promise rather than a flag, because the session restore MUST wait for it.
 * Reading `tokenStore.access` before the native mirror is populated falls
 * through to an empty localStorage, and the user is logged out on every app
 * launch with a perfectly good token sitting in the Keychain.
 */
let readyResolve;
export const storageReady = new Promise((res) => { readyResolve = res; });

export async function initSecureStorage() {
  if (!isNative()) { readyResolve(false); return false; }
  try {
    const mod = await plugin('preferences');
    if (!mod?.Preferences) { readyResolve(false); return false; }

    nativeStore = mod.Preferences;
    for (const key of ['gameon_access_token', 'gameon_refresh_token']) {
      try {
        const { value } = await nativeStore.get({ key });
        if (value) memory.set(key, value);
      } catch { /* first run, nothing stored */ }
    }
    readyResolve(true);
    return true;
  } catch {
    readyResolve(false);
    return false;
  }
}

// Start immediately, so the promise is already in flight before any mount.
initSecureStorage();

export const secureStorage = {
  get(key) {
    if (isNative()) return memory.get(key) ?? null;
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    // Mirror in memory first, then flush once the native store is ready — so
    // a login during startup is not written to the wrong place.
    memory.set(key, value);
    if (isNative()) {
      storageReady.then(() => nativeStore?.set({ key, value }).catch(() => {}));
      return;
    }
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
  remove(key) {
    memory.delete(key);
    if (isNative()) {
      storageReady.then(() => nativeStore?.remove({ key }).catch(() => {}));
      return;
    }
    try { localStorage.removeItem(key); } catch { /* noop */ }
  },
};

/* ── Geolocation ─────────────────────────────────────────────── */
/**
 * Asks for location permission explicitly on native.
 *
 * The web API prompts implicitly on first use, which on a device means the OS
 * dialog appears at whatever moment the map happens to mount. Requesting it
 * deliberately puts the prompt where the user expects it.
 */
export async function ensureLocationPermission() {
  const mod = await plugin('geolocation');
  if (!mod?.Geolocation) return 'web';
  try {
    const status = await mod.Geolocation.checkPermissions();
    if (status.location === 'granted') return 'granted';
    const asked = await mod.Geolocation.requestPermissions();
    return asked.location;
  } catch {
    return 'denied';
  }
}

/* ── Push notifications ──────────────────────────────────────── */
/**
 * Registers for push and hands the token back. Returns null on the web unless
 * a VAPID key is configured, because a browser push subscription without one
 * cannot be delivered to.
 */
let pushRegistered = false;
let lastPushToken = null;

/** The device token registered this session, so logout can unregister it. */
export const getPushToken = () => lastPushToken;
export const clearPushToken = () => { lastPushToken = null; pushRegistered = false; };

export async function registerForPush(onToken, onOpen) {
  // Registering twice stacks duplicate listeners — duplicate token POSTs and
  // duplicate navigations on tap.
  if (pushRegistered) return true;

  const mod = await plugin('push-notifications');
  if (!mod?.PushNotifications) return null;

  try {
    let perm = await mod.PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await mod.PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return null;

    mod.PushNotifications.addListener('registration', (t) => {
      lastPushToken = t.value;
      onToken?.(t.value, nativePlatform());
    });
    mod.PushNotifications.addListener('registrationError', (e) => console.warn('[push]', e));
    mod.PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const link = a?.notification?.data?.link;
      if (link) onOpen?.(link);
    });

    await mod.PushNotifications.register();
    pushRegistered = true;
    return true;
  } catch (err) {
    console.warn('[push] registration failed', err);
    return null;
  }
}

/* ── Hardware back button ────────────────────────────────────── */
/**
 * Android's back button closes the app by default, even mid-flow. Wiring it to
 * history means it behaves the way the rest of the OS does, and only exits
 * from the top of the stack.
 */
export async function wireBackButton(navigate) {
  const mod = await plugin('app');
  if (!mod?.App) return () => {};

  const handle = await mod.App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.history.length > 1) navigate(-1);
    else mod.App.exitApp();
  });

  return () => handle?.remove?.();
}

/** Matches the native status bar to the app's dark header. */
export async function styleStatusBar() {
  const mod = await plugin('status-bar');
  if (!mod?.StatusBar) return;
  try {
    await mod.StatusBar.setStyle({ style: mod.Style.Dark });
    if (nativePlatform() === 'android') {
      await mod.StatusBar.setBackgroundColor({ color: '#16162B' });
    }
  } catch { /* not fatal */ }
}

/** Hides the splash once React has actually painted. */
export async function hideSplash() {
  const mod = await plugin('splash-screen');
  try { await mod?.SplashScreen?.hide(); } catch { /* noop */ }
}

/** Native share sheet, with a clipboard fallback on the web. */
export async function share({ title, text, url }) {
  const mod = await plugin('share');
  if (mod?.Share) {
    try { await mod.Share.share({ title, text, url }); return 'shared'; } catch { return 'cancelled'; }
  }
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch { return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(url || text); return 'copied'; } catch { return 'failed'; }
}

/** Light haptic tap on native; a no-op everywhere else. */
export async function tapFeedback() {
  const mod = await plugin('haptics');
  try { await mod?.Haptics?.impact({ style: 'LIGHT' }); } catch { /* noop */ }
}
