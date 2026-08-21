import { useEffect, useState } from 'react';
import { bookingApi } from '../api/endpoints.js';
import { rupees } from '../utils/format.js';
import { prettyDate, slotRangeLabel } from '../utils/date.js';
import { IconClose, IconShield } from './Icons.jsx';

const REASONS = [
  'Team can no longer make it',
  'Booked the wrong time',
  'Weather',
  'Found another venue',
  'Something else',
];

/**
 * Shows exactly what the refund will be *before* the user commits.
 * The figure comes from the server so it always matches what actually happens.
 */
export default function CancelModal({ booking, onClose, onCancelled }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refund = booking.refundPreview || { tier: 'unpaid', amount: 0, message: '' };

  // Escape closes, and the background stops scrolling behind the modal.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await bookingApi.cancel(booking.groupRef, reason);
      onCancelled(data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const boxClass = refund.tier === 'full' ? '' : refund.tier === 'partial' ? 'partial' : 'none';

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
        <div className="modal-head">
          <h3 id="cancel-title">Cancel this booking?</h3>
          <button className="icon-btn bare" onClick={onClose} disabled={busy} aria-label="Close">
            <IconClose style={{ width: 20, height: 20 }} />
          </button>
        </div>

        <div className="modal-body">
          <div className="card card-pad card-flat" style={{ background: 'var(--surface-2)' }}>
            <strong style={{ fontFamily: 'Outfit, sans-serif' }}>{booking.venue?.name}</strong>
            <p className="text-soft" style={{ marginTop: 3 }}>
              {prettyDate(booking.date)} · {slotRangeLabel(booking.slots)} · {booking.courtName}
            </p>
          </div>

          <div className={`refund-box ${boxClass}`}>
            <div className="row gap-10" style={{ alignItems: 'flex-start' }}>
              <IconShield style={{ width: 21, height: 21, flexShrink: 0 }} />
              <div>
                <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.05rem', display: 'block' }}>
                  {refund.tier === 'full' ? `Full refund — ${rupees(refund.amount)}`
                    : refund.tier === 'partial' ? `${refund.percent}% refund — ${rupees(refund.amount)}`
                    : refund.tier === 'unpaid' ? 'Nothing to refund'
                    : refund.tier === 'at_venue' ? 'Settle with the venue directly'
                    : 'No refund available'}
                </strong>
                <p style={{ marginTop: 5, fontSize: '.89rem' }}>{refund.message}</p>
              </div>
            </div>
          </div>

          <div className="field">
            <span className="label">Why are you cancelling? (optional)</span>
            <div className="row gap-8 wrap">
              {REASONS.map((r) => (
                <button
                  key={r}
                  className={`pill${reason === r ? ' active' : ''}`}
                  onClick={() => setReason(reason === r ? '' : r)}
                  disabled={busy}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Keep booking</button>
          <button className="btn btn-danger" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner spinner-light" style={{ width: 17, height: 17 }} /> : 'Cancel booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
