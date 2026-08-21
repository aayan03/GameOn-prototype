import { tierOf } from '../utils/loyalty.js';

/** The small tier chip shown next to a player's name across the app. */
export default function TierBadge({ tier, size = 'sm', showLabel = true }) {
  const t = tierOf(tier);
  return (
    <span
      className={`tier-badge${size === 'lg' ? ' lg' : ''}`}
      style={{ background: t.bg, color: t.color }}
      title={`${t.label} tier`}
    >
      <span aria-hidden="true">{t.icon}</span>
      {showLabel && t.label}
    </span>
  );
}
