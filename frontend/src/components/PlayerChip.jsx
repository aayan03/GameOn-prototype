import { initials } from '../utils/format.js';
import TierBadge from './TierBadge.jsx';

/** Compact player identity block — avatar, name, tier, reliability. */
export default function PlayerChip({ player, sub, right, size = 'md' }) {
  if (!player) return null;
  return (
    <div className="player-chip">
      <div className={`avatar${size === 'sm' ? ' avatar-sm' : ''}`}>{initials(player.name)}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-6 wrap">
          <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: size === 'sm' ? '.9rem' : '.98rem' }}>
            {player.name}
          </strong>
          {player.loyaltyTier && <TierBadge tier={player.loyaltyTier} showLabel={false} />}
        </div>
        <div className="text-faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub || [
            player.skillLevel,
            player.position,
            player.gamesPlayed != null && `${player.gamesPlayed} games`,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      {right}
    </div>
  );
}
