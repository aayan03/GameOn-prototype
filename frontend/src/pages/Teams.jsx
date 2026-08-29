import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { teamApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PlayerChip from '../components/PlayerChip.jsx';
import { SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import { IconUsers, IconClose, IconCheck, IconSparkle, IconTrash } from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'pro'];

function CreateTeamModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', sport: 'football', skillLevel: 'intermediate', minPlayers: 5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await teamApi.create({
        name: form.name.trim(),
        sport: form.sport,
        skillLevel: form.skillLevel,
        minPlayers: Number(form.minPlayers),
      });
      toast.success(`${form.name} created. Invite your squad.`);
      onCreated();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Create a team</h3>
          <button className="icon-btn bare" onClick={onClose} disabled={busy} aria-label="Close">
            <IconClose style={{ width: 20, height: 20 }} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'contents' }}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="field">
              <label className="label" htmlFor="t-name">Team name</label>
              <input
                id="t-name" className="input" required minLength={3} maxLength={60}
                placeholder="Sunday Warriors"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <span className="label">Sport</span>
              <div className="row gap-8 wrap">
                {SPORTS.map((s) => (
                  <button key={s} type="button"
                    className={`pill${form.sport === s ? ' active' : ''}`}
                    onClick={() => setForm({ ...form, sport: s })}>
                    {SPORT_ICONS[s]} {SPORT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">Skill level</span>
              <div className="row gap-8 wrap">
                {LEVELS.map((l) => (
                  <button key={l} type="button"
                    className={`pill${form.skillLevel === l ? ' active' : ''}`}
                    onClick={() => setForm({ ...form, skillLevel: l })}
                    style={{ textTransform: 'capitalize' }}>{l}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="t-min">Players needed for a full side</label>
              <input
                id="t-min" type="number" className="input" min={2} max={30}
                value={form.minPlayers}
                onChange={(e) => setForm({ ...form, minPlayers: e.target.value })}
              />
              <span className="text-faint">
                Below this we'll nudge you to post on TeamUp.
              </span>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 17, height: 17 }} /> : 'Create team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TeamCard({ team, onInvite, onLeave, busy }) {
  const short = team.isShort;
  return (
    <div className="card card-pad team-card">
      <div className="between gap-12 wrap">
        <div className="row gap-12">
          <div className="team-crest">{SPORT_ICONS[team.sport]}</div>
          <div>
            <div className="row gap-8 wrap">
              <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.1rem' }}>{team.name}</strong>
              {team.isCaptain && <span className="badge badge-volt">Captain</span>}
            </div>
            <span className="text-faint">
              {SPORT_LABELS[team.sport]} · {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
              {team.city && ` · ${team.city}`}
            </span>
          </div>
        </div>
        {team.isCaptain && (
          <button className="btn btn-ghost btn-sm" onClick={() => onInvite(team)} disabled={busy === team._id}>
            {busy === team._id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Invite player'}
          </button>
        )}
      </div>

      {short && (
        <div className="alert alert-warn" style={{ marginTop: 14 }}>
          <IconSparkle style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span>
            You're {team.minPlayers - team.memberCount} short of a full side.{' '}
            <Link to="/teamup" style={{ textDecoration: 'underline', fontWeight: 800 }}>Post on TeamUp</Link> to fill the gaps.
          </span>
        </div>
      )}

      <div className="roster">
        {team.members.map((m) => (
          <div key={m.user?._id || m.user} className="roster-row">
            <PlayerChip
              player={m.user}
              size="sm"
              sub={[m.role === 'captain' ? 'Captain' : m.position || 'Player'].filter(Boolean).join(' · ')}
              right={
                team.isCaptain && m.role !== 'captain' ? (
                  <button
                    className="icon-btn bare"
                    style={{ color: 'var(--danger)' }}
                    title={`Remove ${m.user?.name}`}
                    onClick={() => onLeave(team, m.user?._id || m.user)}
                  >
                    <IconTrash style={{ width: 16, height: 16 }} />
                  </button>
                ) : null
              }
            />
          </div>
        ))}
      </div>

      {!team.isCaptain && (
        <button
          className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', marginTop: 14 }}
          onClick={() => onLeave(team, 'self')}
        >
          Leave team
        </button>
      )}
    </div>
  );
}

export default function Teams() {
  const { user } = useAuth();
  const toast = useToast();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState(null);

  const load = () => {
    teamApi.mine()
      .then(({ data }) => setTeams(data))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (team) => {
    setBusy(team._id);
    try {
      // No address: this is the "generate a code and paste it in the group
      // chat" flow. Sending a made-up placeholder email bound the code to an
      // account nobody owns, and every redemption was rejected.
      const { data } = await teamApi.invite(team._id, {});
      setInviteCode({ team: team.name, code: data.code });
    } catch (err) { toast.error(err.message); }
    finally { setBusy(null); }
  };

  const leave = async (team, userId) => {
    const target = userId === 'self' ? user._id : userId;
    try {
      const { data } = await teamApi.removeMember(team._id, target);
      toast.info(data.message);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const joinTeam = async (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    try {
      const { data } = await teamApi.joinByCode(joinCode.trim().toUpperCase());
      toast.success(data.message);
      setJoinCode('');
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 900 }}>
      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Squads</span>
          <h1 style={{ marginTop: 8 }}>My teams</h1>
          <p className="text-soft">Keep your regular squad together, and see instantly when you're short.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => setShowCreate(true)}>
          <IconUsers style={{ width: 18, height: 18 }} /> Create team
        </button>
      </div>

      <form className="search-bar" onSubmit={joinTeam} style={{ marginBottom: 24 }}>
        <IconCheck style={{ width: 18, height: 18, color: 'var(--text-faint)', flexShrink: 0 }} />
        <input
          className="hero-input" placeholder="Have an invite code? Paste it here"
          value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          maxLength={12}
        />
        <button className="btn btn-dark btn-sm" type="submit" disabled={!joinCode.trim()}>Join team</button>
      </form>

      {loading ? (
        <div className="stack gap-16">
          {Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton" style={{ height: 220 }} />)}
        </div>
      ) : teams.length ? (
        <div className="stack gap-18">
          {teams.map((t) => (
            <TeamCard key={t._id} team={t} onInvite={invite} onLeave={leave} busy={busy} />
          ))}
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">👥</div>
          <h3>No teams yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 22 }}>
            Create your squad, invite your regulars, and TeamUp will help you fill the gaps.
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => setShowCreate(true)}>Create your team</button>
        </div>
      )}

      {showCreate && (
        <CreateTeamModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}

      {inviteCode && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setInviteCode(null)}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>Invite code</h3>
              <button className="icon-btn bare" onClick={() => setInviteCode(null)} aria-label="Close">
                <IconClose style={{ width: 20, height: 20 }} />
              </button>
            </div>
            <div className="modal-body center">
              <p className="text-soft">Share this code with your player. It works once.</p>
              <div className="ticket-ref" style={{ marginTop: 14 }}>{inviteCode.code}</div>
              <button
                className="btn btn-ghost" style={{ marginTop: 16 }}
                onClick={() => {
                  navigator.clipboard?.writeText(inviteCode.code)
                    .then(() => toast.success('Code copied'))
                    .catch(() => toast.info('Copy it manually'));
                }}
              >
                Copy code
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
