import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ownerApi, venueApi } from '../api/endpoints.js';
import { TrendChart, HourBars, RankedBars, StatTile } from '../components/Charts.jsx';
import UnlistVenueModal from '../components/UnlistVenueModal.jsx';
import { rupees, SPORT_LABELS } from '../utils/format.js';
import {
  IconPin, IconBolt, IconPhone, IconStar, IconChevron,
  IconRefresh, IconSparkle, IconUsers, IconTrash, IconCheck,
} from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

const RANGES = [
  { d: 7, label: '7 days' },
  { d: 30, label: '30 days' },
  { d: 90, label: '90 days' },
];

export default function OwnerDashboard() {
  const [days, setDays] = useState(30);
  const [venueId, setVenueId] = useState('');
  const [data, setData] = useState(null);
  const [hours, setHours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The venue awaiting an unlist confirmation, if any.
  const [unlisting, setUnlisting] = useState(null);
  const [relisting, setRelisting] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = { days, venueId: venueId || undefined };
    Promise.all([ownerApi.overview(params), ownerApi.peakHours(params)])
      .then(([o, p]) => { setData(o.data); setHours(p.data); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days, venueId]);

  useEffect(load, [load]);

  /**
   * Putting a venue back. The server gates activation on moderation, so a
   * listing that was rejected or is still in the queue will come back
   * inactive however hard this asks — hence re-reading rather than assuming.
   */
  const relist = async (v) => {
    setRelisting(v._id);
    try {
      await venueApi.update(v._id, { isActive: true });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRelisting('');
    }
  };

  const sports = useMemo(() => (data?.breakdown?.bySport || []).slice(0, 6).map((s) => ({
    ...s,
    // A chart axis is text, so this one stays a plain label.
    label: SPORT_LABELS[s.sport] || s.sport,
  })), [data]);

  if (loading && !data) {
    return (
      <div className="container section">
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 260, marginTop: 18 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">📊</div>
          <h3>{error}</h3>
          <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const s = data.stats;
  const hasVenues = data.venues.length > 0;

  return (
    <div className="container section fade-in">
      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Owner</span>
          <h1 style={{ marginTop: 8 }}>Dashboard</h1>
          <p className="text-soft">How your venues are performing, and what needs your attention.</p>
        </div>
        <div className="row gap-10 wrap">
          <Link to="/owner/requests" className="btn btn-dark">
            Requests{s.pendingRequests > 0 && ` (${s.pendingRequests})`}
          </Link>
          <Link to="/owner/calendar" className="btn btn-ghost">Calendar</Link>
          <Link to="/owner/promos" className="btn btn-ghost">Promos</Link>
        </div>
      </div>

      {!hasVenues ? (
        <div className="card card-pad empty">
          <div className="empty-icon">🏟️</div>
          <h3>No venues yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 22 }}>
            List your first turf or court and your numbers will show up here.
          </p>
          <Link to="/owner/venues/new" className="btn btn-primary btn-lg">Add a venue</Link>
        </div>
      ) : (
        <>
          {/* Filters — one row above the charts */}
          <div className="between gap-12 wrap" style={{ marginBottom: 20 }}>
            <div className="segmented">
              {RANGES.map((r) => (
                <button key={r.d} className={days === r.d ? 'active' : ''} onClick={() => setDays(r.d)}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="row gap-10 wrap">
              {data.venues.length > 1 && (
                <select
                  className="select" aria-label="Choose a venue"
                  value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ maxWidth: 240 }}
                >
                  <option value="">All venues</option>
                  {data.venues.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                </select>
              )}
              <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
                <IconRefresh style={{ width: 15, height: 15 }} /> Refresh
              </button>
            </div>
          </div>

          {/* Headline numbers */}
          <div className="stat-grid">
            <StatTile label="Revenue" value={rupees(s.revenue)} delta={s.deltas?.revenue}
                      hint={`last ${days} days`} accent={0} />
            <StatTile label="Bookings" value={s.bookings.toLocaleString('en-IN')} delta={s.deltas?.bookings}
                      hint={`${s.slots} slots`} accent={1} />
            <StatTile label="Occupancy" value={`${s.occupancyPercent}%`}
                      hint="of sellable hours" accent={3} />
            <StatTile label="Avg booking" value={rupees(s.avgBookingValue)}
                      hint={`${s.cancellationRate}% cancelled`} accent={2} />
            <StatTile label="Customers" value={s.uniqueCustomers.toLocaleString('en-IN')} delta={s.deltas?.customers}
                      hint={`${s.repeatCustomers} repeat`} accent={4} />
          </div>

          {s.pendingRequests > 0 && (
            <div className="alert alert-warn" style={{ marginTop: 18 }}>
              <IconPhone style={{ width: 19, height: 19, flexShrink: 0 }} />
              <span>
                <strong>{s.pendingRequests} booking request{s.pendingRequests === 1 ? '' : 's'}</strong> waiting for you.{' '}
                <Link to="/owner/requests" style={{ textDecoration: 'underline', fontWeight: 800 }}>Review them</Link>
              </span>
            </div>
          )}

          {/* Revenue trend */}
          <div className="dash-grid two" style={{ marginTop: 20 }}>
            <div className="dash-card">
              <div className="dash-card-head">
                <h3>Revenue, last {days} days</h3>
                <span className="text-faint">Collected payments only</span>
              </div>
              <TrendChart data={data.series} valueKey="revenue" label="Revenue" />
            </div>

            <div className="dash-card">
              <div className="dash-card-head"><h3>By sport</h3></div>
              {sports.length ? (
                <RankedBars data={sports} labelKey="label" valueKey="revenue" />
              ) : (
                <p className="text-soft">No completed bookings in this period.</p>
              )}
            </div>
          </div>

          {/* Demand + courts */}
          <div className="dash-grid two" style={{ marginTop: 20 }}>
            <div className="dash-card">
              <div className="dash-card-head">
                <h3>When people play</h3>
                <span className="text-faint">Busiest hour highlighted</span>
              </div>
              <HourBars data={hours} />
              <p className="text-faint" style={{ marginTop: 12 }}>
                Use this to set peak pricing — the busiest hours are where a higher rate
                will not cost you bookings.
              </p>
            </div>

            <div className="dash-card">
              <div className="dash-card-head"><h3>By court</h3></div>
              {data.breakdown.byCourt.length ? (
                <RankedBars data={data.breakdown.byCourt.slice(0, 6)} labelKey="name" valueKey="revenue" colored={false} />
              ) : (
                <p className="text-soft">No completed bookings in this period.</p>
              )}
            </div>
          </div>

          {/* Ratings */}
          {data.reviews.total > 0 && (
            <div className="dash-card" style={{ marginTop: 20 }}>
              <div className="dash-card-head">
                <h3>Ratings</h3>
                <span className="row gap-6">
                  <IconStar filled style={{ width: 16, height: 16, color: 'var(--orange)' }} />
                  <strong>{data.reviews.average}</strong>
                  <span className="text-faint">from {data.reviews.total} reviews</span>
                </span>
              </div>
              <RankedBars
                data={data.reviews.distribution.map((d) => ({ label: `${d.star} star`, count: d.count }))}
                labelKey="label" valueKey="count" colored={false}
                format={(n) => `${n}`}
              />
            </div>
          )}

          {/* Venue list */}
          <div style={{ marginTop: 28 }}>
            <div className="between gap-16 wrap" style={{ marginBottom: 14 }}>
              <h2>Your venues</h2>
              <Link to="/owner/venues/new" className="btn btn-primary btn-sm">Add a venue</Link>
            </div>
            <div className="stack gap-12">
              {data.venues.map((v) => (
                <div key={v._id} className="card card-pad owner-row">
                  <div className="court-icon" style={{ width: 50, height: 50, fontSize: '1.4rem' }}>
                    <SportIcon sport={v.sports?.[0]} size={26} />
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row gap-8 wrap">
                      <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.02rem' }}>{v.name}</strong>
                      <span className={`badge ${v.bookingMode === 'automated' ? 'badge-instant' : 'badge-manual'}`}>
                        {v.bookingMode === 'automated'
                          ? <><IconBolt style={{ width: 11, height: 11 }} /> Instant</>
                          : <><IconPhone style={{ width: 11, height: 11 }} /> Assisted</>}
                      </span>
                      {v.moderationStatus === 'pending' && <span className="badge badge-warning">Awaiting review</span>}
                      {v.moderationStatus === 'rejected' && <span className="badge badge-danger">Rejected</span>}
                      {!v.isActive && v.moderationStatus === 'approved' && <span className="badge badge-soft">Paused</span>}
                    </div>
                    <div className="row gap-4 text-soft" style={{ fontSize: '.85rem', marginTop: 4 }}>
                      <IconPin style={{ width: 13, height: 13 }} />
                      {[v.address?.area, v.address?.city].filter(Boolean).join(', ') || 'No address'}
                    </div>
                    <div className="row gap-12 text-faint" style={{ marginTop: 5 }}>
                      <span>{v.courtCount} courts</span>
                      <span>from {rupees(v.startingPrice)}/hr</span>
                      {v.rating > 0 && <span>⭐ {v.rating.toFixed(1)} ({v.reviewCount})</span>}
                    </div>
                  </div>
                  <div className="row gap-8 wrap">
                    <Link to={`/owner/venues/${v._id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                    <Link to={`/owner/calendar?venueId=${v._id}`} className="btn btn-ghost btn-sm">Calendar</Link>
                    {/* A paused venue has no public page, so offer the way back
                        instead of a link that would 404. */}
                    {v.isActive ? (
                      <Link to={`/venues/${v.slug || v._id}`} className="btn btn-ghost btn-sm">
                        View <IconChevron style={{ width: 13, height: 13 }} />
                      </Link>
                    ) : v.moderationStatus === 'approved' && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => relist(v)}
                        disabled={relisting === v._id}
                      >
                        {relisting === v._id
                          ? <span className="spinner" style={{ width: 13, height: 13 }} />
                          : <><IconCheck style={{ width: 13, height: 13 }} /> List again</>}
                      </button>
                    )}
                    {v.isActive && (
                      <button
                        className="btn btn-ghost btn-sm danger"
                        onClick={() => setUnlisting(v)}
                        aria-label={`Remove ${v.name}`}
                      >
                        <IconTrash style={{ width: 13, height: 13 }} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="row gap-12 wrap" style={{ marginTop: 24 }}>
            <Link to="/owner/customers" className="btn btn-ghost">
              <IconUsers style={{ width: 16, height: 16 }} /> Customers
            </Link>
            <Link to="/owner/payouts" className="btn btn-ghost">
              <IconSparkle style={{ width: 16, height: 16 }} /> Payouts
            </Link>
          </div>
        </>
      )}

      {unlisting && (
        <UnlistVenueModal
          venue={unlisting}
          onClose={() => setUnlisting(null)}
          onDone={() => { setUnlisting(null); load(); }}
        />
      )}
    </div>
  );
}
