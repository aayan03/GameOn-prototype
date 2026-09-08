import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePWA from '../hooks/usePWA.js';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationApi } from '../api/endpoints.js';
import {
  isNative, initSecureStorage, wireBackButton, styleStatusBar,
  hideSplash, registerForPush, subscribeToWebPush,
} from '../utils/platform.js';
import { IconRefresh, IconClose, IconSparkle } from './Icons.jsx';

const INSTALL_DISMISSED = 'gameon_install_dismissed';

/**
 * Native and PWA plumbing, kept out of App.jsx.
 *
 * Renders two thin bars when relevant — "update available" and "install" —
 * and otherwise nothing at all.
 */
export default function AppShell() {
  const { updateReady, applyUpdate, canInstall, install, isIOS, isStandalone } = usePWA();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showInstall, setShowInstall] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  // Native setup, once.
  useEffect(() => {
    if (!isNative()) return undefined;
    let unwire = () => {};

    (async () => {
      await initSecureStorage();
      await styleStatusBar();
      unwire = await wireBackButton(navigate);
      // Splash stays up until React has painted, so there is no white flash.
      setTimeout(hideSplash, 250);
    })();

    return () => unwire();
  }, [navigate]);

  // Register for push once there is an account to attach the device to.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;

    if (isNative()) {
      registerForPush(
        (token, platform) => { notificationApi.addPushToken(token, platform).catch(() => {}); },
        (link) => navigate(link)
      );
      return undefined;
    }

    // Web: ask the API whether push is configured at all before prompting.
    // Requesting notification permission the server cannot act on spends a
    // permission the browser only lets you ask for once.
    (async () => {
      try {
        const { data } = await notificationApi.vapidKey();
        if (cancelled || !data.enabled) return;
        const subscription = await subscribeToWebPush(data);
        if (cancelled || !subscription) return;
        await notificationApi.addPushToken(subscription, 'web');
      } catch { /* notifications are a bonus; never block the app on them */ }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, navigate]);

  // Offer install only after the user has had a reason to want it.
  /**
   * iOS gets told how, because it cannot be shown a button.
   *
   * Safari fires no `beforeinstallprompt`, so there is nothing to call — the
   * only route is Share → Add to Home Screen, done by hand. Suppressed once
   * they have actually done it, and remembered when dismissed so it is a
   * suggestion rather than a nag.
   */
  useEffect(() => {
    if (!isIOS || isStandalone) return undefined;
    try {
      if (localStorage.getItem('gameon_ios_hint_dismissed')) return undefined;
    } catch { /* private mode — show it, it is only a hint */ }
    const t = setTimeout(() => setShowIOSHint(true), 4000);
    return () => clearTimeout(t);
  }, [isIOS, isStandalone]);

  const dismissIOSHint = () => {
    setShowIOSHint(false);
    try { localStorage.setItem('gameon_ios_hint_dismissed', '1'); } catch { /* noop */ }
  };

  useEffect(() => {
    if (!canInstall) return undefined;
    let dismissed = false;
    try { dismissed = localStorage.getItem(INSTALL_DISMISSED) === '1'; } catch { /* noop */ }
    if (dismissed) return undefined;

    const t = setTimeout(() => setShowInstall(true), 25_000);
    return () => clearTimeout(t);
  }, [canInstall]);

  const dismissInstall = () => {
    setShowInstall(false);
    try { localStorage.setItem(INSTALL_DISMISSED, '1'); } catch { /* noop */ }
  };

  return (
    <>
      {updateReady && (
        <div className="app-bar update" role="status">
          <IconRefresh style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span className="grow">A new version of GameOn is ready.</span>
          <button className="btn btn-dark btn-sm" onClick={applyUpdate}>Reload</button>
        </div>
      )}

      {showIOSHint && (
        <div className="app-bar install">
          <IconSparkle style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span className="grow">
            Add GameOn to your Home Screen: tap <strong>Share</strong>, then{' '}
            <strong>Add to Home Screen</strong>.
          </span>
          <button className="icon-btn bare" onClick={dismissIOSHint} aria-label="Not now">
            <IconClose style={{ width: 17, height: 17 }} />
          </button>
        </div>
      )}

      {showInstall && (
        <div className="app-bar install">
          <IconSparkle style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span className="grow">Add GameOn to your home screen for one-tap booking.</span>
          <button className="btn btn-primary btn-sm" onClick={() => { install(); dismissInstall(); }}>
            Install
          </button>
          <button className="icon-btn bare" onClick={dismissInstall} aria-label="Not now">
            <IconClose style={{ width: 17, height: 17 }} />
          </button>
        </div>
      )}
    </>
  );
}
