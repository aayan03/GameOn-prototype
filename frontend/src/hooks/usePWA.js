import { useCallback, useEffect, useState } from 'react';
import { isNative, isStandalone } from '../utils/platform.js';

/**
 * Service worker registration, update detection and the install prompt.
 *
 * The update flow matters more than it looks: a cached SPA shell will happily
 * serve a months-old build forever unless something tells the user a new one
 * is waiting. This surfaces that as a prompt rather than silently reloading
 * mid-booking.
 */
export default function usePWA() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [waiting, setWaiting] = useState(null);

  useEffect(() => {
    // Capacitor serves from the filesystem and has its own update mechanism.
    if (isNative()) return undefined;
    if (!('serviceWorker' in navigator)) return undefined;
    if (import.meta.env.DEV) return undefined;   // never cache the dev server

    let reg;
    const onUpdate = () => {
      if (reg.waiting) { setWaiting(reg.waiting); setUpdateReady(true); }
    };

    navigator.serviceWorker.register('./sw.js')
      .then((r) => {
        reg = r;
        if (r.waiting) { setWaiting(r.waiting); setUpdateReady(true); }
        r.addEventListener('updatefound', () => {
          const sw = r.installing;
          sw?.addEventListener('statechange', () => {
            // controller present means this is an update, not a first install.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) onUpdate();
          });
        });
      })
      .catch((err) => console.warn('[pwa] registration failed', err));

    // Reload once the new worker takes over, so the page and worker match.
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();          // keep Chrome's own banner out of the way
      setInstallPrompt(e);
    };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) { window.location.reload(); return; }
    waiting.postMessage('SKIP_WAITING');
    setUpdateReady(false);
  }, [waiting]);

  const install = useCallback(async () => {
    if (!installPrompt) return 'unavailable';
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    return outcome;
  }, [installPrompt]);

  return {
    updateReady,
    applyUpdate,
    canInstall: Boolean(installPrompt) && !installed,
    install,
    installed,
  };
}
