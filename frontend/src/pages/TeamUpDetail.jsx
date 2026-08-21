import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { teamUpApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SPORT_ICONS, SPORT_LABELS, rupees, initials } from '../utils/format.js';
import { prettyDateTime, relativeTime } from '../utils/date.js';
import { IconArrowLeft, IconPin, IconUsers, IconCheck, IconClose, IconClock } from '../components/Icons.jsx';

const TYPE_LABELS = {
  need_players: 'Need players',
  need_opponent: 'Need opponent',
  looking_to_join: 'Looking to join',
};

function ChatPanel({ postId }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  const load = useCallback(() => {
    teamUpApi.messages(postId).then(({ data }) => setMessages(data)).catch(() => {});
  }, [postId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { data } = await teamUpApi.sendMessage(postId, text.trim());
      setMessages((m) => [...m, data]);
      setText('');
    } catch { /* chat is best-effort */ }
    finally { setBusy(false); }
  };

  return (
    <div className="tu-chat">
      <div className="tu-chat-log" ref={logRef}>
        {messages.length === 0 && <p className="text-faint center" style={{ margin: 'auto' }}>Say hi to the squad.</p>}
        {messages.map((m) => (
          <div key={m._id} className={`chat-bubble${String(m.user?._id) === String(user._id) ? ' mine' : ''}`}>
            <span className="chat-author">
              {m.user?.name}
              <span className="chat-time">{new Date(m.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            </span>
            {m.text}
          </div>
        ))}
      </div>
      <form className="tu-chat-form" onSubmit={send}>
        <input className="input" placeholder="Message the squad…" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

export default function TeamUpDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [joinSpots, setJoinSpots] = useState(1);

  const load = useCallback(() => {
    teamUpApi.get(id)
      .then(({ data }) => setPost(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="container section"><div className="skeleton" style={{ height: 400 }} /></div>;
  }
  if (error || !post) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🤝</div>
          <h3>{error || 'Post not found'}</h3>
          <Link to="/teamup" className="btn btn-primary" style={{ marginTop: 20 }}>Back to TeamUp</Link>
        </div>
      </div>
    );
  }

  const viewer = post.viewer || {};
  const isPast = new Date(post.playAt) < new Date();
  const spotsLeft = post.spotsRemaining ?? Math.max(0, post.spotsNeeded - post.spotsFilled);
  const area = post.venue?.address
    ? [post.venue.address.area, post.venue.address.city].filter(Boolean).join(', ')
    : post.proposedArea;

  const statusBadge = {
    open: { cls: 'badge-instant', text: 'Open' },
    filled: { cls: 'badge-violet', text: 'Full' },
    cancelled: { cls: 'badge-danger', text: 'Cancelled' },
    completed: { cls: 'badge-soft', text: 'Played' },
    expired: { cls: 'badge-soft', text: 'Expired' },
  }[post.status] || { cls: 'badge-soft', text: post.status };

  const myRequest = user ? post.joinRequests?.find((r) => String(r.user?._id) === String(user._id)) : null;
  const canJoin = user && !viewer.isHost && !viewer.isConfirmed
    && !(myRequest && ['pending', 'accepted'].includes(myRequest.status)) && post.status === 'open';
  const canChat = (viewer.isHost || viewer.isConfirmed) && ['filled', 'completed'].includes(post.status);
  const roster = post.host ? [post.host, ...(post.confirmedPlayers || [])] : (post.confirmedPlayers || []);

  const run = async (fn) => {
    setBusy(true);
    try {
      const { data } = await fn();
      toast.success(data.message || 'Done');
      load();
      return data;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const doJoin = (e) => {
    e.preventDefault();
    run(() => teamUpApi.join(post._id, { message: joinMessage, spots: joinSpots })).then((data) => {
      if (data) setJoinOpen(false);
    });
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 900 }}>
      <Link to="/teamup" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> TeamUp
      </Link>

      <div className="tu-hero">
        <div className="between gap-12 wrap">
          <div className="row gap-8 wrap">
            <span className="badge badge-violet">{SPORT_ICONS[post.sport]} {SPORT_LABELS[post.sport]}</span>
            <span className="badge badge-soft">{TYPE_LABELS[post.type]}</span>
            <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
          </div>
          {viewer.isHost && post.status === 'open' && (
            <button
              className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy}
              onClick={() => run(() => teamUpApi.cancel(post._id))}
            >
              Cancel post
            </button>
          )}
        </div>

        <h1 style={{ marginTop: 14, fontSize: '1.7rem' }}>{post.title}</h1>
        {post.description && <p className="text-soft" style={{ marginTop: 8 }}>{post.description}</p>}

        <div className="tu-fact-grid">
          <div className="tu-fact"><span>When</span><strong>{prettyDateTime(post.playAt)}</strong></div>
          <div className="tu-fact"><span>Where</span><strong><IconPin style={{ width: 13, height: 13 }} /> {area || 'Not set'}</strong></div>
          <div className="tu-fact"><span>Spots</span><strong>{spotsLeft > 0 ? `${spotsLeft} left of ${post.spotsNeeded}` : 'Full'}</strong></div>
          <div className="tu-fact"><span>Skill level</span><strong style={{ textTransform: 'capitalize' }}>{post.skillLevel}</strong></div>
          {post.costSharing?.enabled && post.costSharing.perPersonAmount > 0 && (
            <div className="tu-fact"><span>Cost per person</span><strong>{rupees(post.costSharing.perPersonAmount)}</strong></div>
          )}
          {post.venue && <div className="tu-fact"><span>Venue</span><strong>{post.venue.name}</strong></div>}
        </div>

        {canJoin && !joinOpen && (
          <button className="btn btn-primary btn-lg" style={{ marginTop: 22 }} onClick={() => setJoinOpen(true)}>
            <IconUsers style={{ width: 17, height: 17 }} /> Ask to join
          </button>
        )}

        {canJoin && joinOpen && (
          <form onSubmit={doJoin} className="card card-pad card-flat stack gap-12" style={{ marginTop: 22, background: 'var(--surface-2)' }}>
            <div className="field">
              <label className="label" htmlFor="join-msg">Message the host (optional)</label>
              <textarea
                id="join-msg" className="textarea" maxLength={300} value={joinMessage}
                onChange={(e) => setJoinMessage(e.target.value)} placeholder="I play midfield, free all evening…"
              />
            </div>
            <div className="field" style={{ maxWidth: 180 }}>
              <label className="label" htmlFor="join-spots">Spots (you + friends)</label>
              <input
                id="join-spots" type="number" min={1} max={Math.max(1, spotsLeft)} className="input"
                value={joinSpots} onChange={(e) => setJoinSpots(Number(e.target.value))}
              />
            </div>
            <div className="row gap-10">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? <span className="spinner" style={{ width: 15, height: 15 }} /> : 'Send request'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setJoinOpen(false)}>Cancel</button>
            </div>
          </form>
        )}

        {myRequest?.status === 'pending' && (
          <div className="alert alert-info" style={{ marginTop: 22 }}>
            <IconClock style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>Your request is pending. The host will confirm shortly.</span>
          </div>
        )}

        {viewer.isConfirmed && (
          <div className="alert alert-success" style={{ marginTop: 22 }}>
            <IconCheck style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>You're in!{!isPast && ` Starts ${relativeTime(post.playAt)}.`}</span>
          </div>
        )}

        {!user && post.status === 'open' && (
          <div className="alert alert-info" style={{ marginTop: 22 }}>
            <Link to="/login" className="link-btn">Log in</Link>&nbsp;to ask to join this game.
          </div>
        )}

        {myRequest && ['pending', 'accepted'].includes(myRequest.status) && !viewer.isHost && (
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => teamUpApi.withdraw(post._id, myRequest._id))}>
              {myRequest.status === 'accepted' ? 'Leave this game' : 'Withdraw request'}
            </button>
          </div>
        )}
      </div>

      {/* Host: pending requests inbox */}
      {viewer.isHost && post.joinRequests?.some((r) => r.status === 'pending') && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ marginBottom: 14 }}>Join requests</h3>
          <div className="stack gap-12">
            {post.joinRequests.filter((r) => r.status === 'pending').map((r) => (
              <div key={r._id} className="player-row between">
                <div className="row gap-12">
                  <div className="avatar" style={{ width: 38, height: 38, fontSize: '.8rem' }}>{initials(r.user?.name)}</div>
                  <div>
                    <strong>{r.user?.name}</strong>
                    <div className="text-faint">
                      {r.spots} spot{r.spots === 1 ? '' : 's'}
                      {r.user?.reliabilityScore != null && ` · ${r.user.reliabilityScore}% reliable`}
                    </div>
                    {r.message && <p className="text-soft" style={{ marginTop: 4, fontStyle: 'italic' }}>“{r.message}”</p>}
                  </div>
                </div>
                <div className="row gap-8">
                  <button className="icon-btn" aria-label="Accept" disabled={busy} onClick={() => run(() => teamUpApi.decide(post._id, r._id, 'accept'))}>
                    <IconCheck style={{ width: 16, height: 16 }} />
                  </button>
                  <button
                    className="icon-btn" aria-label="Decline" disabled={busy} style={{ color: 'var(--danger)' }}
                    onClick={() => run(() => teamUpApi.decide(post._id, r._id, 'decline'))}
                  >
                    <IconClose style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roster */}
      {roster.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ marginBottom: 14 }}>Who's in ({roster.length})</h3>
          <div className="stack gap-10">
            {roster.map((p) => {
              const isHostRow = String(p._id) === String(post.host?._id);
              const reported = post.noShows?.some((n) => String(n) === String(p._id));
              return (
                <div key={p._id} className="player-row between">
                  <div className="row gap-12">
                    <div className="avatar" style={{ width: 34, height: 34, fontSize: '.75rem' }}>{initials(p.name)}</div>
                    <div>
                      <strong>{p.name}{isHostRow && ' (host)'}</strong>
                      <div className="text-faint">{p.reliabilityScore}% reliable</div>
                    </div>
                  </div>
                  {viewer.isHost && isPast && !isHostRow && ['filled', 'completed'].includes(post.status) && (
                    reported
                      ? <span className="badge badge-danger">No-show reported</span>
                      : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => teamUpApi.noShow(post._id, p._id))}>Report no-show</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Host: wrap up */}
      {viewer.isHost && isPast && post.status === 'filled' && (
        <div className="card card-pad" style={{ marginTop: 28, background: 'var(--volt-soft)' }}>
          <div className="between gap-16 wrap">
            <div>
              <strong>Game's over — mark it played</strong>
              <p className="text-soft" style={{ marginTop: 4 }}>Everyone confirmed gets a small reliability boost.</p>
            </div>
            <button className="btn btn-dark" disabled={busy} onClick={() => run(() => teamUpApi.complete(post._id))}>Mark as played</button>
          </div>
        </div>
      )}

      {/* Chat */}
      {canChat && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ marginBottom: 14 }}>Group chat</h3>
          <ChatPanel postId={post._id} />
        </div>
      )}
    </div>
  );
}
