import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { teamApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SPORT_ICONS, SPORT_LABELS, initials } from '../utils/format.js';
import { IconArrowLeft, IconUsers, IconTrash } from '../components/Icons.jsx';

export default function TeamDetail() {
  const { idOrSlug } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  const load = () => {
    teamApi.get(idOrSlug)
      .then(({ data }) => setTeam(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [idOrSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="container section"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (error || !team) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">👥</div>
          <h3>{error || 'Team not found'}</h3>
          <Link to="/teams" className="btn btn-primary" style={{ marginTop: 20 }}>My teams</Link>
        </div>
      </div>
    );
  }

  const isCaptain = Boolean(user) && String(team.captain?._id) === String(user._id);
  const isMember = team.isMember;
  const isShort = team.members.length < team.minPlayers;

  const invite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      const { data } = await teamApi.invite(team._id, inviteEmail.trim());
      toast.success(data.message);
      setInviteEmail('');
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const removeMember = async (userId) => {
    if (!window.confirm('Remove this player from the team?')) return;
    setBusy(true);
    try {
      await teamApi.removeMember(team._id, userId);
      toast.success('Removed.');
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    if (!window.confirm(`Leave ${team.name}?`)) return;
    setBusy(true);
    try {
      await teamApi.leave(team._id);
      toast.success('You left the team.');
      navigate('/teams');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete ${team.name}? This can't be undone.`)) return;
    setBusy(true);
    try {
      await teamApi.remove(team._id);
      toast.success('Team deleted.');
      navigate('/teams');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 780 }}>
      <Link to="/teams" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> My teams
      </Link>

      <div className="profile-head">
        <div className="avatar" style={{ width: 60, height: 60, fontSize: '1.3rem' }}>{SPORT_ICONS[team.sport]}</div>
        <div className="grow">
          <h1 style={{ fontSize: '1.6rem' }}>{team.name}</h1>
          <div className="row gap-8 wrap" style={{ marginTop: 8 }}>
            <span className="badge badge-violet">{SPORT_LABELS[team.sport]}</span>
            {team.city && <span className="badge badge-soft">{team.city}</span>}
            <span className="badge badge-soft" style={{ textTransform: 'capitalize' }}>{team.skillLevel}</span>
          </div>
        </div>
        {isMember && (
          <Link to={`/teamup/new?sport=${team.sport}`} className="btn btn-primary">
            <IconUsers style={{ width: 16, height: 16 }} /> We're short — post it
          </Link>
        )}
      </div>

      {isShort && (
        <div className="alert alert-warn" style={{ marginTop: 18 }}>
          You have {team.members.length} of {team.minPlayers} players. TeamUp can help fill the gap.
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 22 }}>
        <div className="between gap-10" style={{ marginBottom: 16 }}>
          <h3>Roster ({team.members.length})</h3>
          {isMember && (
            <span className="text-faint mono" title="Share this code so players can join">
              Join code: <strong>{team.slug}</strong>
            </span>
          )}
        </div>
        <div className="stack gap-10">
          {team.members.map((m) => (
            <div key={m.user._id} className="player-row between">
              <div className="row gap-12">
                <div className="avatar" style={{ width: 36, height: 36, fontSize: '.78rem' }}>{initials(m.user.name)}</div>
                <div>
                  <strong>{m.user.name}{m.role === 'captain' && ' (captain)'}</strong>
                  <div className="text-faint">{m.user.reliabilityScore}% reliable{m.position && ` · ${m.position}`}</div>
                </div>
              </div>
              {isCaptain && m.role !== 'captain' && (
                <button
                  className="icon-btn" aria-label="Remove" disabled={busy} style={{ color: 'var(--danger)' }}
                  onClick={() => removeMember(m.user._id)}
                >
                  <IconTrash style={{ width: 15, height: 15 }} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isCaptain && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 12 }}>Invite a player</h3>
          <form onSubmit={invite} className="row gap-10 wrap">
            <input
              className="input grow" style={{ minWidth: 220 }} type="email" placeholder="player@email.com"
              value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
            />
            <button className="btn btn-ghost" disabled={busy || !inviteEmail.trim()}>Send invite</button>
          </form>
          {team.invites?.length > 0 && (
            <div className="stack gap-8" style={{ marginTop: 14 }}>
              {team.invites.map((inv) => <div key={inv._id} className="text-faint">{inv.email} · pending</div>)}
            </div>
          )}
        </div>
      )}

      {isMember && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <div className="between gap-16 wrap">
            <div>
              <strong>{isCaptain ? 'Delete team' : 'Leave team'}</strong>
              <p className="text-soft" style={{ marginTop: 4 }}>
                {isCaptain ? "This can't be undone." : "You'll need a new invite or the join code to come back."}
              </p>
            </div>
            <button
              className="btn btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
              disabled={busy} onClick={isCaptain ? deleteTeam : leave}
            >
              {isCaptain ? 'Delete team' : 'Leave team'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
