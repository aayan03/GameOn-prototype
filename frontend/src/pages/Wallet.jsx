import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookingApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { rupees } from '../utils/format.js';
import { IconWallet, IconSparkle, IconArrowLeft } from '../components/Icons.jsx';

const TOPUPS = [500, 1000, 2000, 5000];

const LABELS = {
  topup: 'Wallet top-up', booking_payment: 'Booking payment', refund: 'Refund',
  cashback: 'Cashback', payout: 'Payout', adjustment: 'Adjustment',
};

export default function Wallet() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [data, setData] = useState({ balance: 0, loyalty: null, transactions: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(0);

  const load = () => {
    bookingApi.wallet()
      .then(({ data: d }) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const topUp = async (amount) => {
    setBusy(amount);
    try {
      const { data: res } = await bookingApi.topUp(amount);
      setUser({ ...user, walletBalance: res.balance });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(0);
    }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 780 }}>
      <Link to="/bookings" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> My bookings
      </Link>

      <div className="page-head">
        <h1>Wallet</h1>
        <p className="text-soft">Pay for slots instantly, and get refunds back here within seconds.</p>
      </div>

      {/* Balance card */}
      <div className="card card-pad" style={{ background: 'var(--ink)', color: '#fff', borderRadius: 'var(--r-xl)' }}>
        <div className="between gap-16 wrap">
          <div>
            <span style={{ fontSize: '.8rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>
              Available balance
            </span>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '3rem', fontWeight: 900, color: 'var(--volt)', letterSpacing: '-.04em', lineHeight: 1.1 }}>
              {rupees(user?.walletBalance ?? data.balance)}
            </div>
          </div>
          <Link
            to="/loyalty"
            className="row gap-10"
            style={{ background: 'rgba(255,255,255,.1)', border: '2px solid rgba(255,255,255,.22)', borderRadius: 'var(--r)', padding: '12px 18px' }}
          >
            <IconSparkle style={{ width: 20, height: 20, color: 'var(--volt)' }} />
            <div>
              <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.4rem', fontWeight: 900, lineHeight: 1 }}>
                {data.loyalty?.points ?? 0}
              </div>
              <span style={{ fontSize: '.74rem', color: 'rgba(255,255,255,.65)' }}>
                {data.loyalty?.tier?.icon} {data.loyalty?.tier?.label} · view rewards
              </span>
            </div>
          </Link>
        </div>
      </div>

      {/* Top up */}
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 6 }}>Add money</h3>
        <p className="text-faint" style={{ marginBottom: 16 }}>
          Demo mode — no real payment is taken. Phase 4 swaps this for Razorpay.
        </p>
        <div className="row gap-10 wrap">
          {TOPUPS.map((amt) => (
            <button key={amt} className="btn btn-ghost" onClick={() => topUp(amt)} disabled={busy > 0}>
              {busy === amt ? <span className="spinner" style={{ width: 15, height: 15 }} /> : `+ ${rupees(amt)}`}
            </button>
          ))}
        </div>
      </div>

      {/* Ledger */}
      <div style={{ marginTop: 30 }}>
        <h3 style={{ marginBottom: 14 }}>Recent activity</h3>
        {loading ? (
          <div className="stack gap-10">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 62 }} />)}
          </div>
        ) : data.transactions.length ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            {data.transactions.map((t, i) => (
              <div
                key={t._id}
                className="between gap-12"
                style={{ padding: '15px 20px', borderTop: i ? '2px dashed var(--hairline)' : 'none' }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '.96rem' }}>
                    {LABELS[t.type] || t.type}
                  </strong>
                  <div className="text-faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.description}
                    {t.reference && ` · ${t.reference}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <strong
                    className="mono"
                    style={{ color: t.direction === 'credit' ? 'var(--success)' : 'var(--text)', fontSize: '1.02rem' }}
                  >
                    {t.direction === 'credit' ? '+' : '−'}{rupees(t.amount)}
                  </strong>
                  <div className="text-faint">bal {rupees(t.balanceAfter)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card card-pad empty">
            <div className="empty-icon">
              <IconWallet style={{ width: 52, height: 52, margin: '0 auto' }} />
            </div>
            <h3>No activity yet</h3>
            <p className="text-soft" style={{ marginTop: 6 }}>Top up above, then book your first slot.</p>
          </div>
        )}
      </div>
    </div>
  );
}
