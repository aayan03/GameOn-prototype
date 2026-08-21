/** Client-side mirror of the server's tier table, for instant rendering. */
export const TIERS = {
  rookie: { label: 'Rookie', icon: '🥉', color: '#8B85A0', bg: 'var(--surface-2)' },
  pro:    { label: 'Pro',    icon: '🥈', color: '#0E8FBF', bg: 'var(--sky-soft)' },
  elite:  { label: 'Elite',  icon: '🥇', color: '#C77400', bg: 'var(--orange-soft)' },
  legend: { label: 'Legend', icon: '👑', color: '#16162B', bg: 'var(--volt)' },
};

export const tierOf = (key) => TIERS[key] || TIERS.rookie;
