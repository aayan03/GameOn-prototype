import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ownerApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { rupees } from '../utils/format.js';
import { IconArrowLeft, IconShield } from '../components/Icons.jsx';

const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function OwnerPayouts() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ownerApi.payouts()
      .then(({ data: d }) => setData(d))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="container section"><div className="skeleton" style={{ height: 320 }} /></div>;
  }

  const up = data?.upcoming;

  return (
    <div className="container section fade-in" style={{ maxWidth: 900 }}>
      <Link to="/owner" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Dashboard
      </Link>

      <div className="page-head">
        <span className="eyebrow">Money</span>
        <h1 style={{ marginTop: 8 }}>Payouts</h1>
        <p className="text-soft">What you have earned, and what has been settled.</p>
      </div>

      {/* Next payout */}
      <div className="card card-pad" style={{ background: 'var(--ink)', color: '#fff', borderRadius: 'var(--r-xl)' }}>
        <span style={{ fontSize: '.76rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>
          Next payout
        </span>
        <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '2.8rem', fontWeight: 900, color: 'var(--volt)', letterSpacing: '-.04em', lineHeight: 1.1 }}>
          {rupees(up?.netAmount || 0)}
        </div>
        <div className="row gap-16 wrap" style={{ marginTop: 12, color: 'rgba(255,255,255,.75)', fontSize: '.88rem' }}>
          <span>{up?.slots || 0} slots</span>
          <span>Gross {rupees(up?.grossAmount || 0)}</span>
          <span>Commission {up?.commissionPercent}% ({rupees(up?.commissionAmount || 0)})</span>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginTop: 18 }}>
        <IconShield style={{ width: 19, height: 19, flexShrink: 0 }} />
        <span>
          Payouts are generated weekly and settled by the GameOn team. The figure above
          covers everything collected since your last settled period.
        </span>
      </div>

      <h2 style={{ marginTop: 30, marginBottom: 14 }}>History</h2>
      {data?.history?.length ? (
        <div className="table-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Period</th><th className="num">Slots</th><th className="num">Gross</th>
                <th className="num">Commission</th><th className="num">Net</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((p) => (
                <tr key={p._id}>
                  <td>{fmt(p.periodStart)} – {fmt(p.periodEnd)}</td>
                  <td className="num">{p.bookingCount}</td>
                  <td className="num">{rupees(p.grossAmount)}</td>
                  <td className="num">−{rupees(p.commissionAmount)}</td>
                  <td className="num"><strong>{rupees(p.netAmount)}</strong></td>
                  <td>
                    <span className={`badge ${p.status === 'paid' ? 'badge-instant' : p.status === 'failed' ? 'badge-danger' : 'badge-manual'}`}>
                      {p.status}
                    </span>
                    {p.paidAt && <div className="text-faint" style={{ marginTop: 3 }}>{fmt(p.paidAt)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">💸</div>
          <h3>No payouts yet</h3>
          <p className="text-soft" style={{ marginTop: 8 }}>
            Your first settlement will appear here once a period closes.
          </p>
        </div>
      )}
    </div>
  );
}
