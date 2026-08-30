import { useEffect, useRef, useState } from 'react';

/**
 * Counts a number up when it scrolls into view, easing out as it lands.
 *
 * The animation is decoration; the final number is not. These now show real
 * figures (venues listed, cities covered), so "settles on the right value" is
 * a correctness requirement, not a nicety.
 *
 * That matters because `requestAnimationFrame` does not run in a backgrounded
 * tab — and opening a link in a background tab is completely ordinary. The
 * first version started the animation, the tab was hidden before it finished,
 * rAF stopped, and the counter froze partway. It never recovered either: the
 * observer had already unobserved and the started flag was set, so returning
 * to the tab left a permanent, wrong number on screen — "3 venues listed" when
 * there were thirty-four.
 *
 * A timer backstop closes that. `setTimeout` is throttled in a hidden tab but
 * it still fires, so whatever happens to rAF the value lands on the target.
 */
export default function useCountUp(target, { duration = 1400, decimals = 0 } = {}) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // A new target (data arrived, or it changed) means a fresh run.
    started.current = false;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return undefined;
    }

    let frame = null;
    let backstop = null;
    let finished = false;

    const settle = () => {
      if (finished) return;
      finished = true;
      if (frame) cancelAnimationFrame(frame);
      setValue(target);
    };

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      io.unobserve(el);

      const start = performance.now();
      const tick = (now) => {
        if (finished) return;
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - p) ** 3;          // easeOutCubic
        setValue(Number((target * eased).toFixed(decimals)));
        if (p < 1) frame = requestAnimationFrame(tick);
        else settle();
      };
      frame = requestAnimationFrame(tick);

      // If rAF never runs, or stalls partway, land on the real number anyway.
      backstop = setTimeout(settle, duration + 400);
    }, { threshold: 0.4 });

    io.observe(el);

    /**
     * Second backstop, for when the observer itself never fires.
     *
     * IntersectionObserver needs a viewport to intersect with. In a
     * zero-height frame, a print view, or a browser where it is unavailable,
     * the callback simply never runs — and the counter sits at 0 forever.
     * When the number was decorative that was invisible; now that it is the
     * real venue count, "0 venues listed" is a lie on the landing page.
     *
     * So if nothing has started shortly after mount, show the true value and
     * skip the animation. Losing a flourish beats publishing a wrong number.
     */
    const revealAnyway = setTimeout(() => {
      if (!started.current) settle();
    }, 1600);

    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (backstop) clearTimeout(backstop);
      clearTimeout(revealAnyway);
    };
  }, [target, duration, decimals]);

  return [value, ref];
}
