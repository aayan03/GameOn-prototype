import { Link } from 'react-router-dom';
import { SPORT_ICONS, SPORT_LABELS, distanceLabel, rupees, initials } from '../utils/format.js';
import { prettyDateTime } from '../utils/date.js';
import { IconPin } from './Icons.jsx';

const TYPE_LABELS = {
  need_players: 'Need players',
  need_opponent: 'Need opponent',
  looking_to_join: 'Looking to join',
};

export default function TeamUpCard({ post }) {
  const spotsLeft = post.spotsRemaining ?? Math.max(0, post.spotsNeeded - post.spotsFilled);
  const pct = post.spotsNeeded ? Math.min(100, Math.round((post.spotsFilled / post.spotsNeeded) * 100)) : 0;
  const area = post.venue?.address
    ? [post.venue.address.area, post.venue.address.city].filter(Boolean).join(', ')
    : post.proposedArea;

  return (
    <Link to={`/teamup/${post._id}`} className="card card-hover card-pad tu-card fade-in">
      <div className="between gap-8 wrap">
        <span className="badge badge-violet">{SPORT_ICONS[post.sport]} {SPORT_LABELS[post.sport]}</span>
        <span className="badge badge-soft">{TYPE_LABELS[post.type]}</span>
      </div>

      <h3 className="tu-title">{post.title}</h3>

      <div className="vc-meta">
        <IconPin style={{ width: 14, height: 14, flexShrink: 0 }} />
        <span>{area || 'Area not set'}</span>
        {typeof post.distanceKm === 'number' && <span className="text-faint">· {distanceLabel(post.distanceKm)}</span>}
      </div>

      <div style={{ fontWeight: 700, fontSize: '.92rem' }}>{prettyDateTime(post.playAt)}</div>

      <div className="tu-spots">
        <div className="tu-spots-bar"><span style={{ width: `${pct}%` }} /></div>
        <span className="text-faint">{spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : 'Full'}</span>
      </div>

      <div className="tu-card-foot">
        <div className="row gap-8">
          <div className="avatar" style={{ width: 30, height: 30, fontSize: '.68rem' }}>{initials(post.host?.name)}</div>
          <span className="text-faint">{post.host?.name}</span>
        </div>
        {post.costSharing?.enabled && post.costSharing.perPersonAmount > 0 && (
          <strong className="mono">{rupees(post.costSharing.perPersonAmount)}/person</strong>
        )}
      </div>
    </Link>
  );
}
