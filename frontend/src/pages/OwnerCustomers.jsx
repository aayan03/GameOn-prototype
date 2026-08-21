import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ownerApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import TierBadge from '../components/TierBadge.jsx';
import { rupees, initials, SPORT_ICONS } from '../utils/format.js';
import { IconArrowLeft } from '../components/Icons.jsx';

export default function OwnerCustomers() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ownerApi.customers({ days: 180 })
      .then(({ data }) => setRows(data))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container section fade-in" style={{ maxWidth: 980 }}>
      <Link to="/owner" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Dashboard
      </Link>

      <div className="page-head">
        <span className="eyebrow">Regulars</span>
        <h1 style={{ marginTop: 8 }}>Customers</h1>
        <p className="text-soft">
          Who plays at your venues, ranked by spend over the last six months.
        </p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Player</th><th>Sports</th>
                <th className="num">Bookings</th><th className="num">Slots</th>
                <th className="num">Spend</th><th>Last played</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.userId}>
                  <td>
                    <div className="row gap-10">
                      <div className="avatar avatar-sm">{initials(c.name)}</div>
                      <div>
                        <strong style={{ fontFamily: 'Outfit, sans-serif' }}>{c.name || 'Player'}</strong>
                        {c.loyaltyTier && (
                          <div style={{ marginTop: 3 }}><TierBadge tier={c.loyaltyTier} /></div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>{(c.sports || []).map((s) => SPORT_ICONS[s] || '').join(' ')}</td>
                  <td className="num">{c.bookings}</td>
                  <td className="num">{c.slots}</td>
                  <td className="num">{rupees(c.spend)}</td>
                  <td className="text-faint">
                    {new Date(c.lastPlayed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">👥</div>
          <h3>No customers yet</h3>
          <p className="text-soft" style={{ marginTop: 8 }}>
            Once people start booking, your regulars will show up here.
          </p>
        </div>
      )}

      <p className="text-faint" style={{ marginTop: 16 }}>
        Only the details you need to recognise a regular are shown. Players' email
        addresses and phone numbers are not shared with venues.
      </p>
    </div>
  );
}
