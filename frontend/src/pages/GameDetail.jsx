import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { teamupApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PlayerChip from '../components/PlayerChip.jsx';
import VenueMap from '../components/VenueMap.jsx';
import { SPORT_LABELS, rupees } from '../utils/format.js';
import { prettyDateLong, relativeTime, minuteLabel, localKey } from '../utils/date.js';
import {
  IconArrowLeft, IconPin, IconClock, IconUsers, IconCheck,
  IconClose, IconSparkle, IconShield,
} from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

const TYPE_LABEL = {
  need_players: 'Need players',
  need_opponent: 'Need an opponent',
  looking_to_join: 'Looking to join',
};

export default function GameDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const toast = useToast();

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    teamupApi.get(id)
      .then(({ data }) => { setPost(data); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const join = async () => {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: `/teamup/${id}` } } }); return; }
    setBusy('join');
    try {
      const { data } = await teamupApi.join(id, { spots: 1, message: message.trim() || undefined });
      toast.success(data.message);
      setMessage('');
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const withdraw = async () => {
    setBusy('withdraw');
    try {
      const { data } = await teamupApi.withdraw(id);
      toast.info(data.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const decide = async (requestId, decision) => {
    setBusy(requestId);
    try {
      const { data } = await teamupApi.decide(id, requestId, decision);
      toast.success(data.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const cancelGame = async () => {
    setBusy('cancel');
    try {
      const { data } = await teamupApi.cancel(id);
      toast.info(data.message);
      navigate('/teamup');
    } catch (err) { toast.error(err.message); setBusy(null); }
  };

  const settle = async () => {
    setBusy('settle');
    try {
      const { data } = await teamupApi.settle(id);
      toast.success(data.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  if (loading) {
    return <div className="container section"><div className="skeleton" style={{ height: 420 }} /></div>;
  }

  if (error || !post) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🤝</div>
          <h3>{error || 'Game not found'}</h3>
          <Link to="/teamup" className="btn btn-primary" style={{ marginTop: 20 }}>Back to TeamUp</Link>
        </div>
      </div>
    );
  }

  const kickoff = new Date(post.playAt);
  const isPast = kickoff < new Date();
  const remaining = post.spotsRemaining;
  const pending = (post.joinRequests || []).filter((r) => r.status === 'pending');
  const accepted = (post.joinRequests || []).filter((r) => r.status === 'accepted');
  const coords = post.venue?.location?.coordinates || post.location?.coordinates;

  return (
    <div className="container section fade-in">
      <Link to="/teamup" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> All games
      </Link>

      <div className="vd-layout">
        <main className="vd-main">
          <div className="row gap-8 wrap" style={{ marginBottom: 10 }}>
            <span className="badge badge-volt">{TYPE_LABEL[post.type]}</span>
            <span className="badge badge-soft"><SportIcon sport={post.sport} size={14} /> {SPORT_LABELS[post.sport]}</span>
            {post.skillLevel !== 'any' && (
              <span className="badge badge-soft" style={{ textTransform: 'capitalize' }}>{post.skillLevel}</span>
            )}
            {post.status === 'filled' && <span className="badge badge-success">Full</span>}
            {post.status === 'cancelled' && <span className="badge badge-danger">Cancelled</span>}
            {isPast && post.status !== 'cancelled' && <span className="badge badge-soft">Finished</span>}
          </div>

          <h1>{post.title}</h1>

          {post.description && (
            <p className="text-soft" style={{ marginTop: 14, fontSize: '1.02rem' }}>{post.description}</p>
          )}

          <div className="game-facts">
            <div className="fact">
              <IconClock style={{ width: 19, height: 19 }} />
              <div>
                <span>When</span>
                <strong>
                  {prettyDateLong(localKey(kickoff))} ·{' '}
                  {minuteLabel(kickoff.getHours() * 60 + kickoff.getMinutes())}
                </strong>
                {!isPast && <span className="text-faint"> {relativeTime(post.playAt)}</span>}
              </div>
            </div>
            <div className="fact">
              <IconPin style={{ width: 19, height: 19 }} />
              <div>
                <span>Where</span>
                <strong>{post.venue?.name || post.proposedArea || 'To be decided'}</strong>
                {post.venue?.address && (
                  <span className="text-faint"> {[post.venue.address.area, post.venue.address.city].filter(Boolean).join(', ')}</span>
                )}
              </div>
            </div>
            <div className="fact">
              <IconUsers style={{ width: 19, height: 19 }} />
              <div>
                <span>Spots</span>
                <strong>{post.spotsFilled} of {post.spotsNeeded} filled</strong>
                {remaining > 0 && <span className="text-faint"> · {remaining} left</span>}
              </div>
            </div>
            <div className="fact">
              <IconSparkle style={{ width: 19, height: 19 }} />
              <div>
                <span>Duration</span>
                <strong>{post.durationMins} minutes</strong>
              </div>
            </div>
          </div>

          {post.costSharing?.enabled && post.costSharing.perPersonAmount > 0 && (
            <div className="card card-pad card-volt" style={{ marginTop: 22 }}>
              <div className="row gap-12">
                <IconSparkle style={{ width: 22, height: 22, flexShrink: 0 }} />
                <div>
                  <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.05rem' }}>
                    {rupees(post.costSharing.perPersonAmount)} each
                  </strong>
                  <p className="text-soft" style={{ marginTop: 3 }}>
                    {rupees(post.costSharing.totalAmount)} split {post.spotsNeeded + 1} ways, host included.
                    {post.isHost && ' You collect it once everyone has joined.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Host's request inbox */}
          {post.isHost && pending.length > 0 && (
            <section className="vd-section">
              <h2>Join requests <span className="badge badge-manual">{pending.length}</span></h2>
              <div className="stack gap-12">
                {pending.map((r) => (
                  <div key={r._id} className="card card-pad">
                    <PlayerChip player={r.user} />
                    {r.message && (
                      <p className="text-soft" style={{ marginTop: 12, fontStyle: 'italic' }}>“{r.message}”</p>
                    )}
                    <div className="row gap-10" style={{ marginTop: 14 }}>
                      <button
                        className="btn btn-primary grow" disabled={busy === r._id}
                        onClick={() => decide(r._id, 'accept')}
                      >
                        {busy === r._id ? <span className="spinner" style={{ width: 15, height: 15 }} />
                          : <><IconCheck style={{ width: 16, height: 16 }} /> Accept{r.spots > 1 && ` (${r.spots} spots)`}</>}
                      </button>
                      <button
                        className="btn btn-ghost" style={{ color: 'var(--danger)' }}
                        disabled={busy === r._id} onClick={() => decide(r._id, 'decline')}
                      >
                        <IconClose style={{ width: 15, height: 15 }} /> Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Squad */}
          <section className="vd-section">
            <h2>Who's playing</h2>
            <div className="stack gap-10">
              <div className="card card-pad">
                <PlayerChip
                  player={post.host}
                  sub={`Host · ${post.host?.reliabilityScore ?? 100}% reliable · ${post.host?.gamesPlayed ?? 0} games`}
                  right={<span className="badge badge-volt">Host</span>}
                />
              </div>
              {accepted.map((r) => (
                <div key={r._id} className="card card-pad">
                  <PlayerChip
                    player={r.user}
                    right={<span className="badge badge-success">In</span>}
                  />
                </div>
              ))}
              {accepted.length === 0 && (
                <p className="text-soft">No one else has joined yet — be the first.</p>
              )}
            </div>
          </section>

          {coords && (
            <section className="vd-section">
              <h2>Location</h2>
              <VenueMap
                pins={[{
                  id: post._id,
                  name: post.venue?.name || post.title,
                  slug: post.venue?.slug,
                  lat: coords[1], lng: coords[0],
                  area: post.proposedArea, city: post.venue?.address?.city,
                  rating: 0, sports: [post.sport], bookingMode: 'automated',
                  startingPrice: 0,
                }]}
                center={[coords[1], coords[0]]}
                zoom={14}
                height="300px"
              />
            </section>
          )}
        </main>

        {/* ── Action panel ─────────────────────────────────── */}
        <aside className="vd-side">
          <div className="book-card">
            <div className="between" style={{ marginBottom: 16 }}>
              <div>
                <span className="text-faint">Spots left</span>
                <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '2rem', fontWeight: 900, lineHeight: 1 }}>
                  {remaining}
                  <span className="text-faint" style={{ fontSize: '1rem', fontWeight: 500 }}> / {post.spotsNeeded}</span>
                </div>
              </div>
              {post.autoApprove && <span className="badge badge-sky">Instant join</span>}
            </div>

            <div className="spots-pips" style={{ marginBottom: 18 }}>
              {Array.from({ length: Math.min(post.spotsNeeded, 14) }, (_, i) => (
                <span key={i} className={`pip${i < post.spotsFilled ? ' filled' : ''}`} />
              ))}
            </div>

            {post.isHost ? (
              <div className="stack gap-10">
                {post.costSharing?.enabled && accepted.length > 0 && (
                  <button className="btn btn-primary btn-block" onClick={settle} disabled={busy === 'settle'}>
                    {busy === 'settle' ? <span className="spinner" style={{ width: 16, height: 16 }} />
                      : `Collect ${rupees(post.costSharing.perPersonAmount * accepted.length)}`}
                  </button>
                )}
                {post.status !== 'cancelled' && !isPast && (
                  <button
                    className="btn btn-ghost btn-block" style={{ color: 'var(--danger)' }}
                    onClick={cancelGame} disabled={busy === 'cancel'}
                  >
                    Cancel this game
                  </button>
                )}
              </div>
            ) : post.status === 'cancelled' ? (
              <div className="alert alert-error">This game was cancelled by the host.</div>
            ) : isPast ? (
              <div className="alert alert-info">This game has already been played.</div>
            ) : post.myRequest?.status === 'accepted' ? (
              <div className="stack gap-10">
                <div className="alert alert-success">
                  <IconCheck style={{ width: 18, height: 18, flexShrink: 0 }} />
                  <span>You're in. See you there.</span>
                </div>
                <button className="btn btn-ghost btn-block" onClick={withdraw} disabled={busy === 'withdraw'}>
                  Leave this game
                </button>
              </div>
            ) : post.myRequest?.status === 'pending' ? (
              <div className="stack gap-10">
                <div className="alert alert-warn">
                  <IconClock style={{ width: 18, height: 18, flexShrink: 0 }} />
                  <span>Waiting for the host to confirm.</span>
                </div>
                <button className="btn btn-ghost btn-block" onClick={withdraw} disabled={busy === 'withdraw'}>
                  Withdraw request
                </button>
              </div>
            ) : remaining <= 0 ? (
              <div className="alert alert-info">This game is full.</div>
            ) : (
              <div className="stack gap-12">
                <div className="field">
                  <label className="label" htmlFor="join-msg">Say hello (optional)</label>
                  <textarea
                    id="join-msg" className="textarea" maxLength={300} style={{ minHeight: 74 }}
                    placeholder="I play left back, been playing weekly for two years."
                    value={message} onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
                <button className="btn btn-primary btn-block btn-lg" onClick={join} disabled={busy === 'join'}>
                  {busy === 'join' ? <span className="spinner" style={{ width: 17, height: 17 }} />
                    : post.autoApprove ? 'Join this game' : 'Ask to join'}
                </button>
              </div>
            )}

            <div className="book-facts">
              <div className="between">
                <span className="text-soft">Skill level</span>
                <strong style={{ textTransform: 'capitalize' }}>{post.skillLevel === 'any' ? 'Any' : post.skillLevel}</strong>
              </div>
              <div className="between">
                <span className="text-soft">Approval</span>
                <strong>{post.autoApprove ? 'Instant' : 'Host confirms'}</strong>
              </div>
              {post.costSharing?.enabled && (
                <div className="between">
                  <span className="text-soft">Your share</span>
                  <strong>{rupees(post.costSharing.perPersonAmount)}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 16 }}>
            <div className="row gap-10">
              <IconShield style={{ width: 20, height: 20, flexShrink: 0, color: 'var(--violet)' }} />
              <p className="text-soft" style={{ fontSize: '.88rem' }}>
                Meet at the venue and settle up through the app. Reliability scores
                drop for no-shows, so people tend to turn up.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
