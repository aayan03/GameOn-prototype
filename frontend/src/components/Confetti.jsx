import { useEffect, useState } from 'react';

const COLORS = ['#D6FF3F', '#FF3E7F', '#6C3CE9', '#FF9C3D', '#3DC9FF', '#FFFFFF'];

/**
 * A burst of falling confetti, used when a booking is confirmed.
 * Pure CSS animation on absolutely-positioned divs — no canvas, no library,
 * and it self-cleans after the last piece lands.
 */
export default function Confetti({ active, pieces = 70, duration = 3200 }) {
  const [bits, setBits] = useState([]);

  useEffect(() => {
    if (!active) { setBits([]); return undefined; }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    setBits(
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        dur: 2.2 + Math.random() * 1.6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        spin: `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720)}deg`,
        size: 7 + Math.random() * 8,
        round: Math.random() > 0.65,
      }))
    );

    const t = setTimeout(() => setBits([]), duration + 900);
    return () => clearTimeout(t);
  }, [active, pieces, duration]);

  if (!bits.length) return null;

  return (
    <div className="confetti-layer" aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          className="confetti-bit"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.round ? b.size : b.size * 1.4,
            background: b.color,
            borderRadius: b.round ? '50%' : 2,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
            '--spin': b.spin,
          }}
        />
      ))}
    </div>
  );
}
