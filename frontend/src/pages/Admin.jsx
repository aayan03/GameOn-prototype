import { useCallback, useEffect, useState } from 'react';
import { adminApi, playgroundApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { StatTile } from '../components/Charts.jsx';
import { rupees, initials } from '../utils/format.js';
import SportIcon from '../components/SportIcon.jsx';
import { SPORT_LABELS, PLAYGROUND_FACILITY_LABELS, accessLabel } from '../utils/format.js';
import { IconCheck, IconClose, IconRefresh, IconShield, IconPin } from '../components/Icons.jsx';

const TABS = [
  { k: 'queue', label: 'Venues' },
  // Community submissions are moderated separately from venues: a free park
  // and a business taking bookings are different decisions with different
  // risks, and mixing them in one list invites reviewing them the same way.
  { k: 'grounds', label: 'Free grounds' },
  { k: 'users', label: 'Users' },
  { k: 'money', label: 'Money' },
];

export default function Admin() {
  const toast = useToast();
  const [tab, setTab] = useState('queue');
  const [stats, setStats] = useState(null);
  const [venues, setVenues] = useState([]);
  const [status, setStatus] = useState('pending');
  const [users, setUsers] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [grounds, setGrounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const loadStats = useCallback(() => {
    adminApi.stats().then(({ data }) => setStats(data)).catch((e) => toast.error(e.message));
  }, [toast]);

  const load = useCallback(() => {
    setLoading(true);
    const job = tab === 'queue' ? adminApi.venues({ status }).then(({ data }) => setVenues(data))
      : tab === 'grounds' ? playgroundApi.queue(status).then(({ data }) => setGrounds(data))
      : tab === 'users' ? adminApi.users({}).then(({ data }) => setUsers(data))
      : adminApi.ledger().then(({ data }) => setLedger(data));
    job.catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [tab, status, toast]);

  useEffect(loadStats, [loadStats]);
  useEffect(load, [load]);

  const moderate = async (venue, decision) => {
    setBusy(venue._id);
    try {
      const { data } = await adminApi.moderate(venue._id, decision);
      toast.success(data.message);
      load(); loadStats();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  /**
   * Approve or reject a community-submitted ground.
   *
   * A rejection note is required, and not for tidiness: the contributor is
   * told the outcome, and "no" with no reason is the fastest way to lose
   * somebody who was doing you a favour.
   */
  const moderateGround = async (pg, decision) => {
    let note = '';
    if (decision === 'reject') {
      // eslint-disable-next-line no-alert
      note = window.prompt(`Why is "${pg.name}" not going on the map?\nThis is sent to whoever added it.`) || '';
      if (!note.trim()) return;
    }
    setBusy(pg._id);
    try {
      const { data } = await playgroundApi.moderate(pg._id, decision, note.trim());
      toast.success(data.message);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  /** Pull a live ground. The contributor is told, with the reason. */
  const unpublishGround = async (pg) => {
    // eslint-disable-next-line no-alert
    const note = window.prompt(`Why is "${pg.name}" coming off the map?
This is sent to whoever added it.`) || '';
    if (!note.trim()) return;
    setBusy(pg._id);
    try {
      const { data } = await playgroundApi.unpublish(pg._id, note.trim());
      toast.success(data.message);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const toggleVerified = async (user) => {
    setBusy(user._id);
    try {
      const { data } = await adminApi.verifyUser(user._id, !user.isVerified);
      toast.success(data.message);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const toggleActive = async (user) => {
    setBusy(user._id);
    try {
      const { data } = await adminApi.setStatus(user._id, !user.isActive);
      toast.info(data.message);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const runPayouts = async () => {
    setBusy('payouts');
    try {
      const { data } = await adminApi.runPayouts();
      toast.success(data.message);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="container section fade-in">
      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Platform</span>
          <h1 style={{ marginTop: 8 }}>Admin</h1>
          <p className="text-soft">Moderation, accounts and money movement.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { load(); loadStats(); }}>
          <IconRefresh style={{ width: 15, height: 15 }} /> Refresh
        </button>
      </div>

      {stats && (
        <>
          {stats.paymentMode === 'simulated' && (
            <div className="alert alert-warn" style={{ marginBottom: 18 }}>
              <IconShield style={{ width: 19, height: 19, flexShrink: 0 }} />
              <span>
                <strong>Payments are simulated.</strong> No gateway is configured, so wallet
                balances are not backed by real money. Set the Razorpay keys before going live.
              </span>
            </div>
          )}

          <div className="stat-grid">
            <StatTile label="Pending review" value={stats.pendingVenues} accent={1}
                      hint={`${stats.activeVenues} live`} />
            <StatTile label="Venues" value={stats.venues} accent={0} hint={`${stats.owners} owners`} />
            <StatTile label="Users" value={stats.users.toLocaleString('en-IN')} accent={3} />
            <StatTile label="Revenue, 30d" value={rupees(stats.grossRevenue30)} accent={4}
                      hint={`${stats.bookings30} bookings`} />
            <StatTile label="Wallet liability" value={rupees(stats.walletLiability)} accent={2}
                      hint="unspent balances" />
          </div>
        </>
      )}

      <div className="row gap-10 wrap" style={{ margin: '24px 0 18px' }}>
        {TABS.map((t) => (
          <button key={t.k} className={`pill${tab === t.k ? ' active' : ''}`} onClick={() => setTab(t.k)}>
            {t.label}
            {t.k === 'queue' && stats?.pendingVenues > 0 && ` (${stats.pendingVenues})`}
          </button>
        ))}
      </div>

      {/* ── Moderation queue ────────────────────────────────── */}
      {tab === 'queue' && (
        <>
          <div className="row gap-8 wrap" style={{ marginBottom: 16 }}>
            {['pending', 'approved', 'rejected', 'all'].map((s) => (
              <button key={s} className={`pill${status === s ? ' active' : ''}`}
                      onClick={() => setStatus(s)} style={{ textTransform: 'capitalize' }}>
                {s}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="skeleton" style={{ height: 240 }} />
          ) : venues.length ? (
            <div className="stack gap-14">
              {venues.map((v) => (
                <div key={v._id} className="card card-pad">
                  <div className="between gap-14 wrap">
                    <div style={{ minWidth: 0 }}>
                      <div className="row gap-8 wrap">
                        <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.05rem' }}>{v.name}</strong>
                        <span className={`badge ${
                          v.moderationStatus === 'approved' ? 'badge-instant'
                          : v.moderationStatus === 'rejected' ? 'badge-danger' : 'badge-manual'}`}>
                          {v.moderationStatus}
                        </span>
                        {v.isClaimed === false && <span className="badge badge-unclaimed">Unclaimed</span>}
                      </div>
                      <div className="row gap-4 text-soft" style={{ fontSize: '.87rem', marginTop: 5 }}>
                        <IconPin style={{ width: 13, height: 13 }} />
                        {[v.address?.area, v.address?.city].filter(Boolean).join(', ') || 'No address'}
                      </div>
                      <div className="text-faint" style={{ marginTop: 5 }}>
                        {v.courts?.length || 0} courts · {v.bookingMode} ·
                        {' '}owner {v.owner?.name || 'unknown'}
                        {v.owner?.isVerified ? ' (verified)' : ' (unverified)'}
                      </div>
                      {v.description && (
                        <p className="text-soft" style={{ marginTop: 8, fontSize: '.88rem' }}>{v.description}</p>
                      )}
                    </div>

                    {v.moderationStatus === 'pending' && (
                      <div className="row gap-10">
                        <button className="btn btn-primary btn-sm" disabled={busy === v._id}
                                onClick={() => moderate(v, 'approve')}>
                          <IconCheck style={{ width: 15, height: 15 }} /> Approve
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                                disabled={busy === v._id} onClick={() => moderate(v, 'reject')}>
                          <IconClose style={{ width: 14, height: 14 }} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card card-pad empty">
              <div className="empty-icon">✅</div>
              <h3>Nothing {status === 'all' ? 'here' : status}</h3>
              <p className="text-soft" style={{ marginTop: 8 }}>
                {status === 'pending' ? 'The moderation queue is clear.' : 'No venues match this filter.'}
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Community grounds ───────────────────────────────── */}
      {tab === 'grounds' && (
        <>
          <div className="row gap-8 wrap" style={{ marginBottom: 16 }}>
            {['pending', 'approved', 'rejected', 'all'].map((sv) => (
              <button key={sv} className={`pill${status === sv ? ' active' : ''}`}
                      onClick={() => setStatus(sv)} style={{ textTransform: 'capitalize' }}>
                {sv}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="skeleton" style={{ height: 240 }} />
          ) : !grounds.length ? (
            <div className="card card-pad empty">
              <div className="empty-icon">🌳</div>
              <h3>Nothing {status === 'all' ? 'submitted' : status} right now</h3>
              <p className="text-soft" style={{ marginTop: 8 }}>
                Free grounds added by players land here for review before they go on the map.
              </p>
            </div>
          ) : (
            <div className="stack gap-12">
              {grounds.map((pg) => {
                const [lng, lat] = pg.location?.coordinates || [];
                return (
                  <div key={pg._id} className="card card-pad">
                    <div className="between gap-14 wrap" style={{ alignItems: 'flex-start' }}>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row gap-8 wrap">
                          <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.05rem' }}>{pg.name}</strong>
                          {pg.reportCount > 0 && (
                            <span className="badge badge-danger">{pg.reportCount} reports</span>
                          )}
                        </div>

                        <p className="text-soft" style={{ marginTop: 4, fontSize: '.9rem' }}>
                          <IconPin style={{ width: 13, height: 13, verticalAlign: '-2px' }} />{' '}
                          {[pg.address?.line1, pg.address?.area, pg.address?.city]
                            .filter(Boolean).join(', ') || 'No address given'}
                        </p>

                        {pg.description && (
                          <p className="text-soft" style={{ marginTop: 8, fontSize: '.92rem' }}>{pg.description}</p>
                        )}

                        <div className="row gap-6 wrap" style={{ marginTop: 10 }}>
                          {pg.sports?.map((sp) => (
                            <span key={sp} className="game-chip">
                              <SportIcon sport={sp} size={12} /> {SPORT_LABELS[sp] || sp}
                            </span>
                          ))}
                          {pg.facilities?.map((f) => (
                            <span key={f} className="badge badge-soft">
                              {PLAYGROUND_FACILITY_LABELS[f] || f}
                            </span>
                          ))}
                        </div>

                        <p className="text-faint" style={{ marginTop: 10, fontSize: '.85rem' }}>
                          {accessLabel(pg.access)}
                          {pg.access?.notes && ` · ${pg.access.notes}`}
                        </p>

                        <p className="text-faint" style={{ marginTop: 6, fontSize: '.85rem' }}>
                          Submitted by {pg.submittedBy?.name || 'unknown'}
                          {pg.submittedBy?.email && ` (${pg.submittedBy.email})`}
                        </p>

                        {/*
                          There are no photos, so the map pin IS the check —
                          it is the only way to tell a real park from an
                          address somebody typed.
                        */}
                        {typeof lat === 'number' && (
                          <a
                            className="link-btn"
                            style={{ marginTop: 8, display: 'inline-block', fontSize: '.86rem' }}
                            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                            target="_blank" rel="noreferrer"
                          >
                            Check this spot on a map →
                          </a>
                        )}
                      </div>

                      {pg.moderationStatus === 'pending' ? (
                        <div className="row gap-8 wrap">
                          <button className="btn btn-primary btn-sm" disabled={busy === pg._id}
                                  onClick={() => moderateGround(pg, 'approve')}>
                            <IconCheck style={{ width: 14, height: 14 }} /> Approve
                          </button>
                          <button className="btn btn-ghost btn-sm danger" disabled={busy === pg._id}
                                  onClick={() => moderateGround(pg, 'reject')}>
                            <IconClose style={{ width: 14, height: 14 }} /> Reject
                          </button>
                        </div>
                      ) : pg.moderationStatus === 'approved' ? (
                        <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                          <span className="badge badge-success">live</span>
                          {/* A ground that closes or turns out to be private
                              needs a way down that is not "reject a submission
                              that was already accepted". */}
                          <button className="btn btn-ghost btn-sm danger" disabled={busy === pg._id}
                                  onClick={() => unpublishGround(pg)}>
                            Take down
                          </button>
                        </div>
                      ) : (
                        <span className="badge badge-danger">{pg.moderationStatus}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Users ───────────────────────────────────────────── */}
      {tab === 'users' && (
        loading ? <div className="skeleton" style={{ height: 300 }} /> : (
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr><th>User</th><th>Role</th><th className="num">Wallet</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id}>
                    <td>
                      <div className="row gap-10">
                        <div className="avatar avatar-sm">{initials(u.name)}</div>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontFamily: 'Outfit, sans-serif' }}>{u.name}</strong>
                          <div className="text-faint">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-soft" style={{ textTransform: 'capitalize' }}>{u.role}</span>
                      {u.isVerified && <div style={{ marginTop: 4 }}><span className="badge badge-instant">Verified</span></div>}
                    </td>
                    <td className="num">{rupees(u.walletBalance)}</td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-instant' : 'badge-danger'}`}>
                        {u.isActive ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td>
                      <div className="row gap-8 wrap">
                        {u.role === 'owner' && (
                          <button className="btn btn-ghost btn-sm" disabled={busy === u._id}
                                  onClick={() => toggleVerified(u)}>
                            {u.isVerified ? 'Unverify' : 'Verify'}
                          </button>
                        )}
                        {u.role !== 'admin' && (
                          <button className="btn btn-ghost btn-sm"
                                  style={{ color: u.isActive ? 'var(--danger)' : 'var(--success)' }}
                                  disabled={busy === u._id} onClick={() => toggleActive(u)}>
                            {u.isActive ? 'Suspend' : 'Restore'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Money ───────────────────────────────────────────── */}
      {tab === 'money' && (
        <>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div className="between gap-12 wrap">
              <div>
                <h3>Weekly payouts</h3>
                <p className="text-soft" style={{ marginTop: 4 }}>
                  Closes the last seven days for every owner. Safe to run more than once —
                  periods already settled are never touched.
                </p>
              </div>
              <button className="btn btn-primary" onClick={runPayouts} disabled={busy === 'payouts'}>
                {busy === 'payouts' ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Run payouts'}
              </button>
            </div>
          </div>

          {loading ? <div className="skeleton" style={{ height: 300 }} /> : (
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr><th>When</th><th>User</th><th>Type</th><th>Description</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {ledger.map((t) => (
                    <tr key={t._id}>
                      <td className="text-faint">
                        {new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td>{t.user?.name || '—'}</td>
                      <td><span className="badge badge-soft">{t.type}</span></td>
                      <td className="text-faint">{t.description}</td>
                      <td className="num" style={{ color: t.direction === 'credit' ? 'var(--success)' : 'var(--text)' }}>
                        {t.direction === 'credit' ? '+' : '−'}{rupees(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
