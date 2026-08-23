import { useEffect, useState } from 'react';

/**
 * "The server is waking up" banner.
 *
 * A free-tier host shuts the API down after fifteen idle minutes and takes up
 * to a minute to start again. Without this the app just sits there: a spinner
 * on the login button, "Searching…" over an empty venue list, and nothing
 * telling the user whether it is broken or merely slow.
 *
 * It listens for the event the API client fires when a request passes six
 * seconds, and hides itself as soon as anything succeeds.
 */
export default function WakingBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let hideTimer = null;

    const onSlow = () => {
      setWaking(true);
      // Safety net: if no request ever resolves, stop claiming we are waking.
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setWaking(false), 90_000);
    };
    const onDone = () => {
      clearTimeout(hideTimer);
      setWaking(false);
    };

    window.addEventListener('gameon:slow-request', onSlow);
    window.addEventListener('gameon:request-ok', onDone);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('gameon:slow-request', onSlow);
      window.removeEventListener('gameon:request-ok', onDone);
    };
  }, []);

  if (!waking) return null;

  return (
    <div className="waking-banner" role="status" aria-live="polite">
      <span className="spinner" style={{ width: 15, height: 15 }} />
      <span>
        Waking the server up — it sleeps when nobody is using it.
        This takes up to a minute the first time.
      </span>
    </div>
  );
}
