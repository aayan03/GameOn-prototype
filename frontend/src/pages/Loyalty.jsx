import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loyaltyApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Confetti from '../components/Confetti.jsx';
import useReveal from '../hooks/useReveal.js';
import { rupees } from '../utils/format.js';
import { IconSparkle, IconCheck, IconArrowLeft, IconWallet } from '../components/Icons.jsx';

const QUICK = [200, 500, 1000, 2000];

export default function Loyalty() {
  const { user, setUser } = useAuth();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(0);
  const [custom, setCustom] = useState('');
  const [celebrate, setCelebrate] = useState(false);

  const tiersRef = useReveal();

  const load = () => {
    loyaltyApi.summary()
      .then(({ data: d }) => setData(d))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const redeem = async (points) => {
    setRedeeming(points);
    try {
      const { data: res } = await loyaltyApi.redeem(points);
      setUser({
        ...user,
        loyaltyPoints: res.loyaltyPoints,
        walletBalance: res.walletBalance,
      });
      toast.success(res.message);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 3600);
      setCustom('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRedeeming(0);
    }
  };

  if (loading || !data) {
    return (
      <div className="container section" style={{ maxWidth: 880 }}>
        <div className="skeleton" style={{ height: 220 }} />
        <div className="skeleton" style={{ height: 140, marginTop: 18 }} />
      </div>
    );
  }

  const { tier, nextTier, points, lifetimePoints, redeemableRupees, minRedeemPoints, allTiers } = data;
  const canRedeem = points >= minRedeemPoints;

  return (
    <div className="container section fade-in" style={{ maxWidth: 880 }}>
      <Confetti active={celebrate} pieces={50} />

      <Link to="/wallet" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Wallet
      </Link>

      <div className="page-head">
        <span className="eyebrow">Rewards</span>
        <h1 style={{ marginTop: 8 }}>GameOn Loyalty</h1>
        <p className="text-soft">
          Earn points every time you play. Points cut your fees, unlock perks, and
          convert straight to wallet credit.
        </p>
      </div>

      {/* ── Tier card ─────────────────────────────────────────── */}
      <div className="tier-card">
        <div className="tier-card-inner">
          <div className="between gap-16 wrap">
            <div>
              <span className="tier-eyebrow">Your tier</span>
              <div className="row gap-10" style={{ marginTop: 6 }}>
                <span style={{ fontSize: '2.6rem', lineHeight: 1 }}>{tier.icon}</span>
                <div>
                  <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: '2.1rem', fontWeight: 900, lineHeight: 1, letterSpacing: '-.03em' }}>
                    {tier.label}
                  </div>
                  <span className="text-faint">{lifetimePoints.toLocaleString('en-IN')} lifetime points</span>
                </div>
              </div>
            </div>

            <div className="tier-points">
              <span>Spendable</span>
              <strong>{points.toLocaleString('en-IN')}</strong>
              <span className="text-faint">= {rupees(redeemableRupees)}</span>
            </div>
          </div>

          {nextTier ? (
            <div className="tier-progress-block">
              <div className="between" style={{ marginBottom: 8 }}>
                <span className="text-soft">
                  <strong>{nextTier.pointsNeeded.toLocaleString('en-IN')}</strong> points to {nextTier.icon} {nextTier.label}
                </span>
                <strong>{nextTier.progressPercent}%</strong>
              </div>
              <div className="tier-progress">
                <div className="tier-progress-fill" style={{ width: `${nextTier.progressPercent}%` }} />
              </div>
            </div>
          ) : (
            <div className="tier-progress-block">
              <div className="alert alert-success" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'rgba(255,255,255,.3)' }}>
                <IconSparkle style={{ width: 18, height: 18, flexShrink: 0 }} />
                <span>You're at the top tier. Every perk is unlocked.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Your current perks ───────────────────────────────── */}
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 14 }}>What {tier.label} gets you</h3>
        <div className="perk-list">
          {tier.perks.map((p) => (
            <div key={p} className="perk">
              <IconCheck style={{ width: 17, height: 17, color: 'var(--success)', flexShrink: 0 }} />
              <span>{p}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Redeem ───────────────────────────────────────────── */}
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="between gap-12 wrap" style={{ marginBottom: 6 }}>
          <h3>Redeem points</h3>
          <span className="badge badge-soft">{data.pointsPerRupee} points = ₹1</span>
        </div>
        <p className="text-faint" style={{ marginBottom: 16 }}>
          Points become wallet credit instantly. Minimum {minRedeemPoints} points,
          in multiples of {data.pointsPerRupee}.
        </p>

        {!canRedeem ? (
          <div className="alert alert-info">
            <IconSparkle style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>
              You need {(minRedeemPoints - points).toLocaleString('en-IN')} more points before you can redeem.
              Book a slot to earn {data.pointsPer100} points per ₹100.
            </span>
          </div>
        ) : (
          <>
            <div className="row gap-10 wrap">
              {QUICK.filter((q) => q <= points).map((q) => (
                <button
                  key={q} className="btn btn-ghost"
                  onClick={() => redeem(q)} disabled={redeeming > 0}
                >
                  {redeeming === q ? <span className="spinner" style={{ width: 15, height: 15 }} />
                    : `${q} pts → ${rupees(q / data.pointsPerRupee)}`}
                </button>
              ))}
            </div>

            <div className="row gap-10" style={{ marginTop: 16 }}>
              <input
                className="input grow" type="number" inputMode="numeric"
                placeholder={`Custom amount (multiple of ${data.pointsPerRupee})`}
                min={minRedeemPoints} max={points} step={data.pointsPerRupee}
                value={custom} onChange={(e) => setCustom(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={redeeming > 0 || !custom || Number(custom) < minRedeemPoints || Number(custom) > points}
                onClick={() => redeem(Number(custom))}
              >
                Redeem
              </button>
            </div>
          </>
        )}

        <Link to="/wallet" className="link-btn row gap-6" style={{ marginTop: 16 }}>
          <IconWallet style={{ width: 15, height: 15 }} /> Wallet balance: {rupees(user?.walletBalance || 0)}
        </Link>
      </div>

      {/* ── All tiers ────────────────────────────────────────── */}
      <div style={{ marginTop: 34 }} ref={tiersRef}>
        <h2 style={{ marginBottom: 16 }}>All tiers</h2>
        <div className="tier-grid">
          {allTiers.map((t, i) => {
            const isCurrent = t.key === tier.key;
            const isUnlocked = lifetimePoints >= t.minLifetimePoints;
            return (
              <div
                key={t.key}
                className={`tier-tile will-reveal${isCurrent ? ' current' : ''}${isUnlocked ? ' unlocked' : ''}`}
                style={{ '--i': i }}
              >
                <div className="between">
                  <span style={{ fontSize: '1.8rem' }}>{t.icon}</span>
                  {isCurrent && <span className="badge badge-volt">You</span>}
                  {!isCurrent && isUnlocked && <span className="badge badge-success">Unlocked</span>}
                </div>
                <h4 style={{ marginTop: 10 }}>{t.label}</h4>
                <span className="text-faint">
                  {t.minLifetimePoints === 0 ? 'From the start' : `${t.minLifetimePoints.toLocaleString('en-IN')} lifetime points`}
                </span>
                <ul className="tier-perks">
                  {t.perks.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Points history ───────────────────────────────────── */}
      {data.history?.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <h2 style={{ marginBottom: 14 }}>Points activity</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            {data.history.map((h, i) => (
              <div
                key={h._id}
                className="between gap-12"
                style={{ padding: '14px 20px', borderTop: i ? '2px dashed var(--hairline)' : 'none' }}
              >
                <span style={{ fontWeight: 600 }}>{h.description}</span>
                <span className="text-faint" style={{ flexShrink: 0 }}>
                  {new Date(h.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
