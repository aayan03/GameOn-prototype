import { useEffect, useState } from 'react';
import { IconClock } from './Icons.jsx';

/**
 * How long is left on a slot hold.
 *
 * An unfinished gateway checkout holds the pitch, and the server releases it
 * after ten minutes. Without this the player has no idea there is a clock —
 * they come back an hour later, press Pay, and get an error about a slot they
 * thought was theirs. A visible countdown turns that into a decision.
 *
 * The deadline comes from the booking's own `createdAt`, so a reload does not
 * restart it and two devices agree.
 */
const HOLD_MS = 10 * 60 * 1000;

export default function HoldCountdown({ createdAt, onExpire }) {
  const deadline = new Date(createdAt).getTime() + HOLD_MS;
  const [left, setLeft] = useState(() => deadline - Date.now());

  useEffect(() => {
    // Recomputed from the deadline each tick rather than counted down, so a
    // backgrounded tab (which throttles timers) does not drift slow and show
    // time the player does not actually have.
    const id = setInterval(() => {
      const remaining = deadline - Date.now();
      setLeft(remaining);
      if (remaining <= 0) { clearInterval(id); onExpire?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, onExpire]);

  if (Number.isNaN(deadline)) return null;

  if (left <= 0) {
    return (
      <div className="alert alert-error">
        <span>
          <strong>This slot was released.</strong> The payment was not completed within
          ten minutes, so it has gone back to the venue. Nothing was charged.
        </span>
      </div>
    );
  }

  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  // Under two minutes it stops being information and starts being a warning.
  const urgent = left < 2 * 60 * 1000;

  return (
    <div className={`alert ${urgent ? 'alert-error' : 'alert-warn'} hold-countdown`}>
      <IconClock style={{ width: 17, height: 17, flexShrink: 0 }} />
      <span>
        <strong>{mins}:{String(secs).padStart(2, '0')}</strong> left to pay.
        {' '}We are holding this slot until then — after that it goes back to the venue.
      </span>
    </div>
  );
}
