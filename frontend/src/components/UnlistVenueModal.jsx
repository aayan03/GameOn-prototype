import { useState } from 'react';
import { venueApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { IconTrash } from './Icons.jsx';

/**
 * Confirming the removal of a venue.
 *
 * The word "delete" is avoided throughout, because that is not what happens
 * and an owner who believes it did would be badly misled. The row survives —
 * bookings reference it, reviews hang off it, payouts settle against it — and
 * it can be put back. What actually happens is that it stops being listed.
 *
 * The number that matters is `upcomingBookings`. Unlisting is not a
 * cancellation: nobody is refunded and nobody is told, so an owner with
 * fixtures still to play is being told, plainly, that they still owe those
 * games. That is the one thing they could otherwise get wrong here.
 */
export default function UnlistVenueModal({ venue, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upcoming = venue.upcomingBookings || 0;

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await venueApi.remove(venue._id);
      toast.success(
        data.upcomingBookings
          ? `${venue.name} is no longer listed. ${data.upcomingBookings} booking${data.upcomingBookings === 1 ? '' : 's'} still stand.`
          : `${venue.name} is no longer listed.`
      );
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unlist-title">
        <div className="modal-head">
          <h3 id="unlist-title">Remove {venue.name}?</h3>
        </div>

        <div className="modal-body">
          <p className="text-soft">
            It will stop appearing in search and its page will no longer open
            for players. Nothing is deleted — your bookings, reviews and payout
            history stay exactly as they are, and you can list it again
            whenever you want.
          </p>

          {upcoming > 0 && (
            <div className="alert alert-warn" style={{ marginTop: 16 }}>
              <span>
                <strong>
                  {upcoming} upcoming booking{upcoming === 1 ? '' : 's'} will not be cancelled.
                </strong>{' '}
                Removing the listing only stops new ones. Those players keep
                their slot and expect you to be there — cancel them yourself
                from the calendar if you cannot host them, so they get refunded.
              </span>
            </div>
          )}

          {error && <div className="alert alert-error" style={{ marginTop: 14 }}><span>{error}</span></div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Keep it listed</button>
          <button className="btn btn-danger" onClick={confirm} disabled={busy}>
            {busy
              ? <span className="spinner" style={{ width: 16, height: 16 }} />
              : <><IconTrash style={{ width: 15, height: 15 }} /> Remove listing</>}
          </button>
        </div>
      </div>
    </div>
  );
}
