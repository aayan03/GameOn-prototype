import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

/**
 * Light / dark / follow-the-system.
 *
 * Three states, not two. "Dark" and "light" are explicit choices that stick;
 * "system" is the default and tracks the OS live, so someone whose phone
 * flips at sunset sees the app flip with it.
 *
 * The applied theme is written to `data-theme` on <html>, which is what the
 * CSS in theme.css keys off. `system` writes NO attribute at all, deliberately
 * — that is what lets the `@media (prefers-color-scheme: dark)` block apply,
 * and it is why the CSS guards that block with `:not([data-theme="light"])`.
 */

const STORAGE_KEY = 'gameon_theme';
const MODES = ['light', 'dark', 'system'];

const ThemeContext = createContext(null);

/** What the OS is asking for right now. */
function systemPrefers() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : 'system';
  } catch {
    // Private browsing, or storage disabled. Following the system is a
    // perfectly good default; it just will not be remembered.
    return 'system';
  }
}

/**
 * Applies a mode to the document.
 *
 * Exported because the inline boot script in index.html does exactly this
 * before React mounts — see the comment there. Keeping one implementation
 * means the two cannot drift apart and produce a flash on load.
 */
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readStored);
  const [systemTheme, setSystemTheme] = useState(systemPrefers);

  // Track the OS while in `system` mode, so the app follows a sunset flip
  // without a reload.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyTheme(mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* not fatal */ }

    /**
     * Keep the browser chrome in step on mobile.
     *
     * Without this the address bar stays paper-white above a dark page on
     * Android, which looks like a rendering bug rather than a choice.
     */
    const resolved = mode === 'system' ? systemTheme : mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#181831' : '#FBF9F4');
  }, [mode, systemTheme]);

  /** Cycles light → dark → system. */
  const cycle = useCallback(() => {
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
  }, []);

  const value = useMemo(() => ({
    mode,
    // What is actually on screen, with `system` already resolved. Components
    // that need to branch on the look (an illustration, a map tile set) want
    // this rather than `mode`.
    resolved: mode === 'system' ? systemTheme : mode,
    setMode,
    cycle,
  }), [mode, systemTheme, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
