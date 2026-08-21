import { useId, useMemo, useState } from 'react';

/**
 * Chart primitives — plain inline SVG, no charting library.
 *
 * Palette note: these six hues were validated with the dataviz palette checker
 * (lightness band, chroma floor, CVD separation, normal-vision floor, contrast
 * vs surface — all pass on the app's warm paper surface). They are NOT the raw
 * brand tokens; --volt and --sky are too light to carry a data mark and fail
 * contrast. Assign in fixed order and never cycle: a seventh category folds
 * into "Other" rather than inventing a hue.
 */
export const SERIES = ['#6C3CE9', '#FF3E7F', '#C2610B', '#0E8FBF', '#0E7C5A', '#8B5CF6'];
export const INK = '#16162B';
export const GRID = 'rgba(22,22,43,.10)';
export const MUTED = '#55506B';

const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Nice round upper bound so gridlines land on readable numbers. */
function niceMax(value) {
  if (value <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => value <= s * mag) || 10;
  return step * mag;
}

/* ═══════════════════════════════════════════════════════════════
   Area + line — revenue over time. One series, so no legend: the
   card title names it. Crosshair tooltip on hover.
   ═══════════════════════════════════════════════════════════════ */
export function TrendChart({ data, valueKey = 'revenue', height = 220, format = rupees, label = 'Revenue' }) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);

  const W = 720;
  const H = height;
  const PAD = { top: 18, right: 18, bottom: 28, left: 54 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { points, max, path, area } = useMemo(() => {
    const values = data.map((d) => d[valueKey] || 0);
    const m = niceMax(Math.max(...values, 1));
    const stepX = data.length > 1 ? plotW / (data.length - 1) : plotW;

    const pts = data.map((d, i) => ({
      ...d,
      x: PAD.left + i * stepX,
      y: PAD.top + plotH - ((d[valueKey] || 0) / m) * plotH,
      value: d[valueKey] || 0,
    }));

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const fill = `${line} L${pts[pts.length - 1]?.x.toFixed(1)},${PAD.top + plotH} L${pts[0]?.x.toFixed(1)},${PAD.top + plotH} Z`;
    return { points: pts, max: m, path: line, area: fill };
  }, [data, valueKey, plotW, plotH, PAD.left, PAD.top]);

  if (!data?.length) return <ChartEmpty height={height} />;

  const last = points[points.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let nearest = points[0];
    for (const p of points) if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
    setHover(nearest);
  };

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
        aria-label={`${label} over the last ${data.length} days`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.22" />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Recessive grid — present, never competing with the data */}
        {ticks.map((t) => {
          const y = PAD.top + plotH - t * plotH;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
              <text x={PAD.left - 10} y={y + 4} textAnchor="end" className="chart-tick">
                {format(Math.round(max * t))}
              </text>
            </g>
          );
        })}

        <path d={area} fill={`url(#g${gid})`} />
        <path d={path} fill="none" stroke={SERIES[0]} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />

        {/* Direct label on the latest point only — never a number per point */}
        {last && (
          <>
            <circle cx={last.x} cy={last.y} r="5" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />
            <text x={last.x} y={last.y - 14} textAnchor="end" className="chart-label">
              {format(last.value)}
            </text>
          </>
        )}

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + plotH}
                  stroke={INK} strokeWidth="1" strokeDasharray="3 3" opacity=".45" />
            <circle cx={hover.x} cy={hover.y} r="6" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />
          </g>
        )}

        {/* First and last x labels only — a label per day would collide */}
        <text x={PAD.left} y={H - 8} className="chart-tick">{shortDate(data[0].date)}</text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="chart-tick">
          {shortDate(data[data.length - 1].date)}
        </text>
      </svg>

      {hover && (
        <div className="chart-tip" style={{ left: `${(hover.x / W) * 100}%` }}>
          <strong>{format(hover.value)}</strong>
          <span>{shortDate(hover.date)}{hover.bookings != null && ` · ${hover.bookings} booking${hover.bookings === 1 ? '' : 's'}`}</span>
        </div>
      )}
    </figure>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Vertical bars — hourly demand. One series again, so no legend.
   ═══════════════════════════════════════════════════════════════ */
export function HourBars({ data, height = 190 }) {
  const [hover, setHover] = useState(null);
  if (!data?.length) return <ChartEmpty height={height} />;

  const W = 720;
  const H = height;
  const PAD = { top: 16, right: 10, bottom: 26, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = niceMax(Math.max(...data.map((d) => d.slots), 1));
  // 2px surface gap between adjacent bars, per the mark spec.
  const slotW = plotW / data.length;
  const barW = Math.max(4, slotW - 2);
  const busiest = Math.max(...data.map((d) => d.slots));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Bookings by hour of day">
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH}
              stroke={GRID} strokeWidth="1" />

        {data.map((d, i) => {
          const h = max ? (d.slots / max) * plotH : 0;
          const x = PAD.left + i * slotW;
          const y = PAD.top + plotH - h;
          const isPeak = d.slots === busiest && busiest > 0;
          return (
            <g key={d.hour} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
              {/* Full-height hit target, bigger than the mark */}
              <rect x={x} y={PAD.top} width={slotW} height={plotH} fill="transparent" />
              <rect
                x={x} y={y} width={barW} height={Math.max(h, d.slots ? 3 : 0)}
                rx="4" ry="4"
                fill={isPeak ? SERIES[1] : SERIES[0]}
                opacity={hover && hover.hour !== d.hour ? 0.45 : 1}
              />
            </g>
          );
        })}

        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={PAD.left + h * slotW + barW / 2} y={H - 8} textAnchor="middle" className="chart-tick">
            {h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
          </text>
        ))}
        <text x={PAD.left - 8} y={PAD.top + 5} textAnchor="end" className="chart-tick">{max}</text>
      </svg>

      {hover && (
        <div className="chart-tip static">
          <strong>{hover.slots} slot{hover.slots === 1 ? '' : 's'}</strong>
          <span>{hover.label} · {rupees(hover.revenue)}</span>
        </div>
      )}
    </figure>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Horizontal bars — ranked categories. Direct-labeled, so identity
   never rests on colour alone.
   ═══════════════════════════════════════════════════════════════ */
export function RankedBars({ data, labelKey, valueKey = 'revenue', format = rupees, colored = true, max: maxProp }) {
  if (!data?.length) return <ChartEmpty height={140} />;

  const max = maxProp ?? Math.max(...data.map((d) => d[valueKey] || 0), 1);

  return (
    <div className="ranked">
      {data.map((d, i) => {
        const pct = max ? ((d[valueKey] || 0) / max) * 100 : 0;
        return (
          <div className="ranked-row" key={`${d[labelKey]}-${i}`}>
            <span className="ranked-label" title={d[labelKey]}>{d[labelKey]}</span>
            <span className="ranked-track">
              <span
                className="ranked-fill"
                style={{
                  width: `${Math.max(pct, d[valueKey] ? 2 : 0)}%`,
                  background: colored ? SERIES[i % SERIES.length] : SERIES[0],
                }}
              />
            </span>
            <strong className="ranked-value mono">{format(d[valueKey])}</strong>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Stat tile — a hero number. No plot, so no hover layer.
   ═══════════════════════════════════════════════════════════════ */
export function StatTile({ label, value, delta, hint, accent = 0 }) {
  const up = delta > 0;
  const flat = delta === 0 || delta == null;

  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <strong className="stat-tile-value" style={{ color: INK }}>{value}</strong>
      <div className="stat-tile-foot">
        {!flat && (
          <span className={`delta ${up ? 'up' : 'down'}`}>
            {up ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="text-faint">{hint}</span>}
      </div>
      <span className="stat-tile-bar" style={{ background: SERIES[accent % SERIES.length] }} />
    </div>
  );
}

function ChartEmpty({ height }) {
  return (
    <div className="chart-empty" style={{ height }}>
      <span>No data for this period yet</span>
    </div>
  );
}

function shortDate(key) {
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
