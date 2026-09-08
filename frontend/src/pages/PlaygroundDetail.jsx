import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { playgroundApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import VenueMap from '../components/VenueMap.jsx';
import SportIcon from '../components/SportIcon.jsx';
import {
  SPORT_LABELS, PLAYGROUND_FACILITY_LABELS, SURFACE_LABELS, accessLabel, initials, directionsUrl } from '../utils/format.js';
import { IconChevron, IconLocate, IconPin, IconInfo } from '../components/Icons.jsx';

export default function PlaygroundDetail() {
  const { idOrSlug } = useParams();
  const { isAuthenticated } = useAuth();
  const toast = useToast();

  const [pg, setPg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reported, setReported] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    playgroundApi.get(idOrSlug)
      .then(({ data }) => { setPg(data); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [idOrSlug]);

  const report = async () => {
    try {
      await playgroundApi.report(pg._id);
      setReported(true);
      toast.success('Thanks — we will take a look.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const sendCorrection = async () => {
    setSending(true);
    try {
      const { data } = await playgroundApi.correct(pg._id, correction.trim());
      toast.success(data.message);
      setCorrecting(false);
      setCorrection('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 60 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  if (error || !pg) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🌳</div>
          <h3>{error || 'Ground not found'}</h3>
          <Link to="/playgrounds" className="btn btn-primary" style={{ marginTop: 20 }}>
            Find another
          </Link>
        </div>
      </div>
    );
  }

  const [lng, lat] = pg.location?.coordinates || [];
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  // Name first, coordinates as the fallback — an unclaimed listing's pin is
  // approximate, but "Nehru Community Ground, Gomti Nagar" still gets you there.
  const directions = directionsUrl({
    name: pg.name, area: pg.address?.area, city: pg.address?.city, lat, lng,
  });
  const address = [pg.address?.line1, pg.address?.area, pg.address?.city, pg.address?.pincode]
    .filter(Boolean).join(', ');

  return (
    <div className="container section" style={{ maxWidth: 940 }}>
      <Link to="/playgrounds" className="back-link">
        <IconChevron style={{ width: 16, height: 16, transform: 'rotate(180deg)' }} /> All free grounds
      </Link>

      {/* Only its own submitter or an admin can see an unpublished one. */}
      {pg.moderationStatus && pg.moderationStatus !== 'approved' && (
        <div className={`alert ${pg.moderationStatus === 'rejected' ? 'alert-error' : 'alert-warn'}`} style={{ marginTop: 16 }}>
          <span>
            <strong>
              {pg.moderationStatus === 'pending' ? 'Waiting to be reviewed.' : 'Not published.'}
            </strong>{' '}
            {pg.moderationStatus === 'pending'
              ? 'Only you can see this page until we have checked it.'
              : pg.moderationNote || 'This one was not added to the map.'}
          </span>
        </div>
      )}

      <div className="parlor-hero">
        <div className="between gap-14 wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{pg.name}</h1>
            {address && (
              <p style={{ marginTop: 6 }}>
                <a
                  className="addr-link" href={directions || undefined}
                  target="_blank" rel="noreferrer"
                >
                  <IconPin style={{ width: 14, height: 14 }} /> {address}
                </a>
              </p>
            )}
          </div>
          <span className="badge badge-free big">Free to use</span>
        </div>

        {pg.description && (
          <p className="text-soft" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{pg.description}</p>
        )}

        <div className="row gap-8 wrap" style={{ marginTop: 18 }}>
          {pg.sports?.map((s) => (
            <span key={s} className="game-chip big">
              <SportIcon sport={s} size={16} /> {SPORT_LABELS[s] || s}
            </span>
          ))}
        </div>

        {/*
          No Book button, and that is the whole point. Every other listing on
          this site is reservable, so silence here would read as a missing
          feature rather than as "this is public land".
        */}
        <div className="parlor-actions">
          {directions && (
            <a href={directions} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
              <IconLocate style={{ width: 17, height: 17 }} /> Directions
            </a>
          )}
        </div>
        <p className="text-faint" style={{ marginTop: 12, fontSize: '.88rem' }}>
          Nothing to book and nothing to pay — turn up and play. Busy times are
          first come, first served.
        </p>
      </div>

      <div className="parlor-detail-grid">
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>What to expect</h3>

          <div className="hours-row today">
            <span>Access</span>
            <strong>{accessLabel(pg.access)}</strong>
          </div>
          <div className="hours-row">
            <span>Surface</span>
            <strong>{SURFACE_LABELS[pg.surface] || 'Not known'}</strong>
          </div>

          {pg.access?.notes && (
            <p className="text-soft" style={{ marginTop: 14, fontSize: '.92rem' }}>
              <IconInfo style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> {pg.access.notes}
            </p>
          )}

          {pg.facilities?.length > 0 && (
            <div className="row gap-8 wrap" style={{ marginTop: 16 }}>
              {pg.facilities.map((f) => (
                <span key={f} className="badge badge-soft">
                  {PLAYGROUND_FACILITY_LABELS[f] || f.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        {hasCoords && (
          <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
            <VenueMap
              pins={[{
                id: pg._id, name: pg.name, slug: pg.slug, lat, lng,
                area: pg.address?.area || '', city: pg.address?.city || '',
                sports: pg.sports || [], startingPrice: 0, rating: 0,
              }]}
              center={[lat, lng]}
              zoom={15}
              height="320px"
            />
          </div>
        )}
      </div>

      {/* The credit. A contributor who gets nothing back stops contributing. */}
      {pg.submittedBy?.name && (
        <div className="card card-pad pg-credit">
          <span className="avatar-sm">{initials(pg.submittedBy.name)}</span>
          <div>
            <strong>Added by {pg.submittedBy.name}</strong>
            <p className="text-soft" style={{ fontSize: '.9rem', marginTop: 2 }}>
              Found this ground and put it on the map so other people could use it.
            </p>
          </div>
        </div>
      )}

      <div className="between gap-12 wrap" style={{ marginTop: 18 }}>
        <p className="text-faint" style={{ fontSize: '.86rem', maxWidth: '58ch' }}>
          <IconPin style={{ width: 13, height: 13, verticalAlign: '-2px' }} />{' '}
          Details come from the player who added this and were checked before it went
          live, but a public ground can change without notice. Take it as a good lead.
        </p>
        {isAuthenticated && pg.moderationStatus !== 'pending' && (
          <div className="row gap-8 wrap">
            <button className="btn btn-ghost btn-sm" onClick={() => setCorrecting((v) => !v)}>
              Suggest a correction
            </button>
            <button className="btn btn-ghost btn-sm danger" onClick={report} disabled={reported}>
              {reported ? 'Reported' : 'Report a problem'}
            </button>
          </div>
        )}
      </div>

      {/*
        A live listing is not the finder's to rewrite, but a ground that has
        gained floodlights or lost its nets should not stay wrong until
        somebody notices. This sends a description to the admins; it edits
        nothing, so the published row still only changes by a human decision.
      */}
      {correcting && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 8 }}>What&rsquo;s changed?</h3>
          <p className="text-soft" style={{ fontSize: '.9rem', marginBottom: 12 }}>
            Tell us what&rsquo;s wrong and we&rsquo;ll check it. This goes to our team, not
            straight onto the page.
          </p>
          <textarea
            className="input" rows={3} maxLength={500}
            placeholder="The floodlights were taken out last month, and the gate now shuts at 7pm."
            value={correction} onChange={(e) => setCorrection(e.target.value)}
            aria-label="Suggested correction"
          />
          <div className="row gap-10" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={sending || correction.trim().length < 10}
              onClick={sendCorrection}
            >
              {sending ? <span className="spinner" style={{ width: 15, height: 15 }} /> : 'Send'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCorrecting(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
