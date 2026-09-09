import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { teamupApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import useDebounce from '../hooks/useDebounce.js';
import CreateGameModal from '../components/CreateGameModal.jsx';
import PlayerChip from '../components/PlayerChip.jsx';
import { SPORT_LABELS, rupees, distanceLabel } from '../utils/format.js';
import { relativeTime, prettyDate, minuteLabel, localKey } from '../utils/date.js';
import {
  IconSearch, IconLocate, IconUsers, IconPin, IconClock,
  IconSparkle, IconCheck, IconClose,
} from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball'];

const TYPE_LABEL = {
  need_players: 'Need players',
  need_opponent: 'Need an opponent',
  looking_to_join: 'Looking to join',
};
const TYPE_CLASS = {
  need_players: 'badge-volt',
  need_opponent: 'badge-violet',
  looking_to_join: 'badge-sky',
};

function timeOfDay(iso) {
  const d = new Date(iso);
  return minuteLabel(d.getHours() * 60 + d.getMinutes());
}

function GameCard({ post, onJoin, onWithdraw, busy }) {
  const remaining = post.spotsRemaining;
  const full = remaining <= 0;
  const mine = post.myRequest;

  return (
    <article className="game-card">
      <div className="game-head">
        <span className={`badge ${TYPE_CLASS[post.type]}`}>{TYPE_LABEL[post.type]}</span>
        <span className="badge badge-soft"><SportIcon sport={post.sport} size={14} /> {SPORT_LABELS[post.sport]}</span>
        {post.skillLevel !== 'any' && (
          <span className="badge badge-soft" style={{ textTransform: 'capitalize' }}>{post.skillLevel}</span>
        )}
        {post.isHost && <span className="badge badge-featured">You're hosting</span>}
      </div>

      <Link to={`/teamup/${post._id}`} className="game-title">{post.title}</Link>

      {post.description && <p className="text-soft game-desc">{post.description}</p>}

      <div className="game-meta">
        <span className="row gap-6">
          <IconClock style={{ width: 15, height: 15 }} />
          {prettyDate(localKey(new Date(post.playAt)))} · {timeOfDay(post.playAt)}
          <span className="text-faint">({relativeTime(post.playAt)})</span>
        </span>
        <span className="row gap-6">
          <IconPin style={{ width: 15, height: 15 }} />
          {post.venue?.name || post.proposedArea || 'Venue to be decided'}
          {typeof post.distanceKm === 'number' && (
            <span className="text-faint">· {distanceLabel(post.distanceKm)}</span>
          )}
        </span>
      </div>

      {/* Spot counter — filled pips read faster than "3/8" */}
      <div className="spots-row">
        <div className="spots-pips" aria-label={`${post.spotsFilled} of ${post.spotsNeeded} spots filled`}>
          {Array.from({ length: Math.min(post.spotsNeeded, 12) }, (_, i) => (
            <span key={i} className={`pip${i < post.spotsFilled ? ' filled' : ''}`} />
          ))}
        </div>
        <strong className={full ? 'text-faint' : ''}>
          {full ? 'Full' : `${remaining} spot${remaining === 1 ? '' : 's'} left`}
        </strong>
      </div>

      {post.costSharing?.enabled && post.costSharing.perPersonAmount > 0 && (
        <div className="cost-split">
          <IconSparkle style={{ width: 15, height: 15 }} />
          <span><strong>{rupees(post.costSharing.perPersonAmount)}</strong> each · split {post.spotsNeeded + 1} ways</span>
        </div>
      )}

      <div className="game-foot">
        <PlayerChip player={post.host} size="sm" sub={`Host · ${post.host?.reliabilityScore ?? 100}% reliable`} />

        {post.isHost ? (
          <Link to={`/teamup/${post._id}`} className="btn btn-ghost btn-sm">
            Manage{post.pendingCount > 0 && ` (${post.pendingCount})`}
          </Link>
        ) : mine?.status === 'accepted' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => onWithdraw(post)} disabled={busy === post._id}>
            <IconCheck style={{ width: 15, height: 15 }} /> You're in
          </button>
        ) : mine?.status === 'pending' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => onWithdraw(post)} disabled={busy === post._id}>
            Requested — withdraw
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onJoin(post)}
            disabled={full || busy === post._id}
          >
            {busy === post._id ? <span className="spinner" style={{ width: 14, height: 14 }} />
              : full ? 'Full' : post.autoApprove ? 'Join now' : 'Ask to join'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function TeamUp() {
  const [params, setParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const { coords, request, isLoading: locating } = useGeolocation();

  const [posts, setPosts] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const [searchInput, setSearchInput] = useState(params.get('q') || '');
  const debounced = useDebounce(searchInput, 400);

  const filters = useMemo(() => ({
    q: params.get('q') || '',
    sport: params.get('sport') || '',
    type: params.get('type') || '',
    when: params.get('when') || '',
    mine: params.get('mine') || '',
    lat: params.get('lat') || '',
    lng: params.get('lng') || '',
    radiusKm: params.get('radiusKm') || '',
    page: Number(params.get('page') || 1),
  }), [params]);

  const setFilter = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (!v) next.delete(k); else next.set(k, String(v));
      });
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    if (debounced !== filters.q) setFilter({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    teamupApi.list({ ...filters, limit: 12 })
      .then(({ data, meta: m }) => { setPosts(data); setMeta(m); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(load, [load]);

  const nearMe = async () => {
    if (filters.lat) { setFilter({ lat: '', lng: '', radiusKm: '' }); return; }
    const c = coords || (await request());
    if (c) setFilter({ lat: c.lat, lng: c.lng, radiusKm: 25 });
  };

  const join = async (post) => {
    if (!isAuthenticated) { toast.info('Log in to join a game.'); return; }
    setBusy(post._id);
    try {
      const { data } = await teamupApi.join(post._id, { spots: 1 });
      toast.success(data.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const withdraw = async (post) => {
    setBusy(post._id);
    try {
      const { data } = await teamupApi.withdraw(post._id);
      toast.info(data.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="container section fade-in">
      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Find players</span>
          <h1 style={{ marginTop: 8 }}>TeamUp</h1>
          <p className="text-soft">
            Short on players? Post your game and fill the gaps. Full team, no opponent?
            Post that too.
          </p>
        </div>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => (isAuthenticated ? setShowCreate(true) : toast.info('Log in to post a game.'))}
        >
          <IconUsers style={{ width: 18, height: 18 }} /> Post a game
        </button>
      </div>

      <div className="search-bar">
        <IconSearch style={{ width: 19, height: 19, color: 'var(--text-faint)', flexShrink: 0 }} />
        <input
          className="hero-input" placeholder="Search games by title…"
          value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label="Search games"
        />
        {searchInput && (
          <button className="icon-btn bare" onClick={() => setSearchInput('')} aria-label="Clear">
            <IconClose style={{ width: 16, height: 16 }} />
          </button>
        )}
        <button className={`btn btn-sm ${filters.lat ? 'btn-dark' : 'btn-ghost'}`} onClick={nearMe} disabled={locating}>
          {locating ? <span className="spinner" style={{ width: 14, height: 14 }} />
                    : <IconLocate style={{ width: 15, height: 15 }} />}
          {filters.lat ? 'Near me · on' : 'Near me'}
        </button>
      </div>

      <div className="chip-row" style={{ marginTop: 16 }}>
        <button className={`pill${!filters.sport ? ' active' : ''}`} onClick={() => setFilter({ sport: '' })}>
          All sports
        </button>
        {SPORTS.map((s) => (
          <button
            key={s} className={`pill${filters.sport === s ? ' active' : ''}`}
            onClick={() => setFilter({ sport: filters.sport === s ? '' : s })}
          >
            <span className="pill-icon"><SportIcon sport={s} size={16} /></span> {SPORT_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="chip-row">
        {[
          { k: 'when', v: 'today', label: 'Today' },
          { k: 'when', v: 'tomorrow', label: 'Tomorrow' },
          { k: 'when', v: 'week', label: 'This week' },
          { k: 'type', v: 'need_players', label: 'Need players' },
          { k: 'type', v: 'need_opponent', label: 'Need opponent' },
        ].map((o) => (
          <button
            key={`${o.k}-${o.v}`}
            className={`pill${filters[o.k] === o.v ? ' active' : ''}`}
            onClick={() => setFilter({ [o.k]: filters[o.k] === o.v ? '' : o.v })}
          >
            {o.label}
          </button>
        ))}
        {isAuthenticated && (
          <>
            <button
              className={`pill${filters.mine === 'hosting' ? ' active' : ''}`}
              onClick={() => setFilter({ mine: filters.mine === 'hosting' ? '' : 'hosting' })}
            >
              Hosting
            </button>
            <button
              className={`pill${filters.mine === 'joined' ? ' active' : ''}`}
              onClick={() => setFilter({ mine: filters.mine === 'joined' ? '' : 'joined' })}
            >
              Joined
            </button>
          </>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 18 }}>{error}</div>}

      <div className="game-grid" style={{ marginTop: 22 }}>
        {loading
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 268 }} />)
          : posts.map((p) => (
              <GameCard key={p._id} post={p} onJoin={join} onWithdraw={withdraw} busy={busy} />
            ))}
      </div>

      {!loading && !posts.length && !error && (
        <div className="card card-pad empty">
          <div className="empty-icon">🤝</div>
          <h2>No open games right now</h2>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 22 }}>
            Be the first to post one — nearby players with the right skill level will see it.
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => (isAuthenticated ? setShowCreate(true) : toast.info('Log in to post a game.'))}
          >
            Post a game
          </button>
        </div>
      )}

      {meta.pages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={filters.page <= 1}
            onClick={() => setFilter({ page: filters.page - 1 })}>Previous</button>
          <span className="text-soft">Page {meta.page} of {meta.pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={filters.page >= meta.pages}
            onClick={() => setFilter({ page: filters.page + 1 })}>Next</button>
        </div>
      )}

      {showCreate && (
        <CreateGameModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}
