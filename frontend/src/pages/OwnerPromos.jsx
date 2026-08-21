import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ownerApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { rupees } from '../utils/format.js';
import { IconArrowLeft, IconClose, IconSparkle } from '../components/Icons.jsx';

const blank = {
  code: '', type: 'percent', value: 10, maxDiscount: 200,
  minAmount: 0, maxUsesPerUser: 1, totalUseLimit: null,
  validTo: '', description: '',
};

function PromoModal({ onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: Number(form.value),
        minAmount: Number(form.minAmount) || 0,
        maxUsesPerUser: Number(form.maxUsesPerUser) || 1,
      };
      if (form.type === 'percent' && form.maxDiscount) payload.maxDiscount = Number(form.maxDiscount);
      if (form.totalUseLimit) payload.totalUseLimit = Number(form.totalUseLimit);
      if (form.validTo) payload.validTo = new Date(form.validTo).toISOString();
      if (form.description.trim()) payload.description = form.description.trim();

      await ownerApi.createPromo(payload);
      toast.success(`${payload.code} is live.`);
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>New promo code</h3>
          <button className="icon-btn bare" onClick={onClose} disabled={busy} aria-label="Close">
            <IconClose style={{ width: 20, height: 20 }} />
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'contents' }}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="field">
              <label className="label" htmlFor="p-code">Code</label>
              <input
                id="p-code" className="input" required minLength={4} maxLength={20}
                placeholder="MONSOON20" value={form.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              />
              <span className="text-faint">Letters and numbers only. It cannot be renamed later.</span>
            </div>

            <div className="field">
              <span className="label">Discount type</span>
              <div className="row gap-8 wrap">
                <button type="button" className={`pill${form.type === 'percent' ? ' active' : ''}`}
                        onClick={() => set({ type: 'percent', value: 10 })}>Percentage</button>
                <button type="button" className={`pill${form.type === 'flat' ? ' active' : ''}`}
                        onClick={() => set({ type: 'flat', value: 100 })}>Flat amount</button>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="p-val">
                  {form.type === 'percent' ? 'Percent off' : 'Rupees off'}
                </label>
                <input
                  id="p-val" type="number" className="input" required min={1}
                  max={form.type === 'percent' ? 100 : 100000}
                  value={form.value} onChange={(e) => set({ value: e.target.value })}
                />
              </div>
              {form.type === 'percent' && (
                <div className="field">
                  <label className="label" htmlFor="p-cap">Cap the discount at</label>
                  <input id="p-cap" type="number" className="input" min={1}
                         value={form.maxDiscount || ''} onChange={(e) => set({ maxDiscount: e.target.value })} />
                </div>
              )}
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="p-min">Minimum booking</label>
                <input id="p-min" type="number" className="input" min={0}
                       value={form.minAmount} onChange={(e) => set({ minAmount: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="p-per">Uses per customer</label>
                <input id="p-per" type="number" className="input" min={1} max={50}
                       value={form.maxUsesPerUser} onChange={(e) => set({ maxUsesPerUser: e.target.value })} />
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="p-total">Total claims (optional)</label>
                <input id="p-total" type="number" className="input" min={1} placeholder="Unlimited"
                       value={form.totalUseLimit || ''} onChange={(e) => set({ totalUseLimit: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="p-until">Runs until (optional)</label>
                <input id="p-until" type="date" className="input"
                       value={form.validTo} onChange={(e) => set({ validTo: e.target.value })} />
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="p-desc">Description shown to players</label>
              <input id="p-desc" className="input" maxLength={200} placeholder="20% off monsoon bookings"
                     value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 17, height: 17 }} /> : 'Create code'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OwnerPromos() {
  const toast = useToast();
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = () => {
    ownerApi.promos()
      .then(({ data }) => setPromos(data))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (p) => {
    try {
      await ownerApi.updatePromo(p._id, { isActive: !p.isActive });
      toast.success(p.isActive ? `${p.code} paused.` : `${p.code} is live again.`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 980 }}>
      <Link to="/owner" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Dashboard
      </Link>

      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Offers</span>
          <h1 style={{ marginTop: 8 }}>Promo codes</h1>
          <p className="text-soft">Run your own discounts. These apply on top of the platform's codes.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => setShowNew(true)}>
          <IconSparkle style={{ width: 18, height: 18 }} /> New code
        </button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : promos.length ? (
        <div className="table-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Code</th><th>Discount</th><th>Conditions</th>
                <th className="num">Claimed</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p._id}>
                  <td>
                    <strong style={{ fontFamily: 'Outfit, sans-serif', letterSpacing: '.05em' }}>{p.code}</strong>
                    {p.description && <div className="text-faint">{p.description}</div>}
                  </td>
                  <td>{p.type === 'percent' ? `${p.value}%${p.maxDiscount ? ` up to ${rupees(p.maxDiscount)}` : ''}` : rupees(p.value)}</td>
                  <td className="text-faint">
                    {p.minAmount > 0 && <div>Min {rupees(p.minAmount)}</div>}
                    <div>{p.maxUsesPerUser} per customer</div>
                    {p.validTo && <div>Until {new Date(p.validTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>}
                  </td>
                  <td className="num">{p.usedCount}{p.totalUseLimit ? ` / ${p.totalUseLimit}` : ''}</td>
                  <td>
                    <span className={`badge ${p.isLive ? 'badge-instant' : 'badge-soft'}`}>
                      {p.isLive ? 'Live' : p.isActive ? 'Expired' : 'Paused'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggle(p)}>
                      {p.isActive ? 'Pause' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">🎟️</div>
          <h3>No promo codes yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 22 }}>
            A well-timed discount fills your quiet hours. Try one for weekday mornings.
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => setShowNew(true)}>Create your first code</button>
        </div>
      )}

      {showNew && <PromoModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}
