import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePWA from '../hooks/usePWA.js';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationApi } from '../api/endpoints.js';
import {
  isNative, initSecureStorage, wireBackButton, styleStatusBar,
  hideSplash, registerForPush,
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
  const { updateReady, applyUpdate, canInstall, install } = usePWA();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showInstall, setShowInstall] = useState(false);

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
    if (!isAuthenticated || !isNative()) return;
    registerForPush(
      (token, platform) => { notificationApi.addPushToken(token, platform).catch(() => {}); },
      (link) => navigate(link)
    );
  }, [isAuthenticated, navigate]);

  // Offer install only after the user has had a reason to want it.
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
