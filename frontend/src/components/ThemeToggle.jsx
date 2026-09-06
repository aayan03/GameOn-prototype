import { useTheme } from '../context/ThemeContext.jsx';

/**
 * Light / dark / system, as one button.
 *
 * A three-state cycle rather than a two-state switch, because "follow my
 * phone" is a real preference and the commonest one — a plain toggle forces
 * everyone into a manual choice they then have to remember to change twice a
 * day.
 *
 * The icon shows the state you are IN, not the one you would move to. Toggles
 * that show the destination are a perennial source of "wait, which is it?" —
 * and with three states there is no sensible single destination to show
 * anyway.
 */

const NEXT = { light: 'dark', dark: 'system', system: 'light' };

const LABEL = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'Matching your device',
};

function SunIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M5.9 5.9 4.4 4.4M19.6 19.6l-1.5-1.5M18.1 5.9l1.5-1.5M4.4 19.6l1.5-1.5" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9Z" />
    </svg>
  );
}

/** Half sun, half moon — the device deciding for you. */
function AutoIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICONS = { light: SunIcon, dark: MoonIcon, system: AutoIcon };

export default function ThemeToggle({ className = '' }) {
  const { mode, cycle } = useTheme();
  const Icon = ICONS[mode];

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={cycle}
      // The accessible name carries the current state AND what pressing it
      // does, because the icon alone cannot say both.
      aria-label={`${LABEL[mode]}. Switch to ${LABEL[NEXT[mode]].toLowerCase()}`}
      title={LABEL[mode]}
    >
      <span className="theme-toggle-icon" key={mode}>
        <Icon style={{ width: 18, height: 18 }} />
      </span>
    </button>
  );
}
