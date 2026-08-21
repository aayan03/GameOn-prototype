import { useEffect, useRef, useState } from 'react';
import { reviewApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { IconClose, IconStar } from './Icons.jsx';

const ASPECTS = [
  { key: 'surface', label: 'Playing surface' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'staff', label: 'Staff' },
  { key: 'value', label: 'Value for money' },
];

function Stars({ value, onChange, size = 30, label }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" className={`star${n <= shown ? ' on' : ''}`}
          onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
        >
          <IconStar filled={n <= shown} style={{ width: size, height: size }} />
        </button>
      ))}
    </div>
  );
}

/**
 * Writing a review. The server only accepts one from someone with a completed
 * booking at that venue, so this form is only offered where that is true.
 */
export default function ReviewModal({ venueId, venueName, existing, onClose, onSaved }) {
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating || 0);
  const [comment, setComment] = useState(existing?.comment || '');
  const [aspects, setAspects] = useState(existing?.aspects || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set as soon as the user changes anything, so a late prefill stands down.
  const touched = useRef(false);
  const mark = (fn) => (...args) => { touched.current = true; fn(...args); };

  // Fetch the existing review when the caller did not hand one over. Without
  // this, editing a review opened a blank form and silently replaced what was
  // already written — the user could not see what they were changing.
  useEffect(() => {
    if (existing || !venueId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await reviewApi.mine(venueId);
        // `touched` matters: this request takes a few hundred milliseconds,
        // and without the guard a user who picked a rating in that window
        // watched the form snap back to their old review as it landed.
        if (cancelled || touched.current || !data?.review) return;
        setRating(data.review.rating || 0);
        setComment(data.review.comment || '');
        setAspects(data.review.aspects || {});
      } catch { /* a first review, or offline — the blank form is correct */ }
    })();
    return () => { cancelled = true; };
  }, [venueId, existing]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, busy]);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) { setError('Pick a rating first'); return; }
    setBusy(true); setError('');
    try {
      const payload = { venueId, rating };
      if (comment.trim()) payload.comment = comment.trim();
      const filled = Object.fromEntries(Object.entries(aspects).filter(([, v]) => v));
      if (Object.keys(filled).length) payload.aspects = filled;

      const { data } = await reviewApi.create(payload);
      toast.success(data.message);
      setBusy(false);
      onSaved?.(data.review);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rv-title">
        <div className="modal-head">
          <h3 id="rv-title">{existing ? 'Update your review' : 'Rate this venue'}</h3>
          <button className="icon-btn bare" onClick={onClose} disabled={busy} aria-label="Close">
            <IconClose style={{ width: 20, height: 20 }} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'contents' }}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="center">
              <p className="text-soft" style={{ marginBottom: 12 }}>How was {venueName}?</p>
              <Stars value={rating} onChange={mark(setRating)} label="Overall rating" />
              {rating > 0 && (
                <p style={{ marginTop: 10, fontWeight: 700, fontFamily: 'Outfit, sans-serif' }}>
                  {['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'][rating]}
                </p>
              )}
            </div>

            <div className="divider-dash" />

            <div className="stack gap-12">
              {ASPECTS.map((a) => (
                <div key={a.key} className="between gap-12">
                  <span style={{ fontWeight: 600, fontSize: '.92rem' }}>{a.label}</span>
                  <Stars
                    value={aspects[a.key] || 0}
                    onChange={mark((v) => setAspects((s) => ({ ...s, [a.key]: v })))}
                    size={18} label={a.label}
                  />
                </div>
              ))}
            </div>

            <div className="field">
              <label className="label" htmlFor="rv-comment">Anything worth telling other players?</label>
              <textarea
                id="rv-comment" className="textarea" maxLength={1000}
                placeholder="Lights were good, parking was tight on a Sunday…"
                value={comment} onChange={mark((e) => setComment(e.target.value))}
              />
              <span className="text-faint">{comment.length}/1000</span>
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !rating}>
              {busy ? <span className="spinner" style={{ width: 17, height: 17 }} />
                    : existing ? 'Update review' : 'Post review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
