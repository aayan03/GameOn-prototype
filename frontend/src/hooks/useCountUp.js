import { useEffect, useRef, useState } from 'react';

/**
 * Counts a number up when it scrolls into view. Uses requestAnimationFrame
 * with an ease-out curve so it decelerates instead of running at a flat rate.
 */
export default function useCountUp(target, { duration = 1400, decimals = 0 } = {}) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return undefined;
    }

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      io.unobserve(el);

      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - p) ** 3;          // easeOutCubic
        setValue(Number((target * eased).toFixed(decimals)));
        if (p < 1) requestAnimationFrame(tick);
        else setValue(target);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });

    io.observe(el);
    return () => io.disconnect();
  }, [target, duration, decimals]);

  return [value, ref];
}
