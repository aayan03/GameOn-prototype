import { useEffect, useRef } from 'react';

/**
 * Adds the `reveal` class the first time an element scrolls into view, which
 * triggers the CSS transition on `.will-reveal`. IntersectionObserver rather
 * than scroll listeners, so it costs nothing while idle.
 *
 * Usage:  const ref = useReveal();  <div ref={ref} className="will-reveal">
 * For a stagger, set `style={{ '--i': index }}` on each child.
 */
export default function useReveal({ threshold = 0.12, once = true, rootMargin = '0px 0px -60px 0px' } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // Respect the OS setting — no animation, just show it.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('reveal');
      return undefined;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('reveal');
          if (once) io.unobserve(el);
        } else if (!once) {
          el.classList.remove('reveal');
        }
      },
      { threshold, rootMargin }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once, rootMargin]);

  return ref;
}

/**
 * Same idea for a list: one observer reveals the container, and the CSS
 * `--i` custom property staggers the children.
 */
export function useRevealGroup(options) {
  return useReveal(options);
}
