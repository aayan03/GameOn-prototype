import { useState } from 'react';
import { IconEye, IconEyeOff } from './Icons.jsx';

/**
 * A password field you can look at.
 *
 * Typing a password blind on a phone keyboard is where most failed logins
 * actually come from — not a forgotten password, a mistyped one. The button
 * is a `button` with an explicit type, because inside a form a bare <button>
 * defaults to type="submit" and would send the form on every peek.
 *
 * The visible state is never persisted and resets on unmount: revealing a
 * password should be a deliberate act each time, not a preference that
 * leaves it on screen in a café next week.
 */
export default function PasswordInput({ className = '', ...rest }) {
  const [shown, setShown] = useState(false);

  return (
    <div className="pass-wrap">
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        className={`input pass-input ${className}`.trim()}
      />
      <button
        type="button"
        className="pass-peek"
        onClick={() => setShown((v) => !v)}
        // The label says what pressing it DOES, which is what a screen reader
        // user needs; `aria-pressed` carries the current state separately.
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        tabIndex={-1}
      >
        {shown
          ? <IconEyeOff style={{ width: 18, height: 18 }} />
          : <IconEye style={{ width: 18, height: 18 }} />}
      </button>
    </div>
  );
}
