import { Link } from 'react-router-dom';
import { IconCheck } from '../components/Icons.jsx';

/**
 * Placeholder for features scheduled in later phases. Rather than a dead
 * end, each one lays out exactly what will be built there — so the roadmap
 * is visible inside the product itself.
 */
export default function ComingSoon({ phase, title, tagline, icon, features, cta }) {
  return (
    <div className="container section fade-in" style={{ maxWidth: 720 }}>
      <div className="soon-card">
        <span className="soon-icon">{icon}</span>
        <span className="badge badge-volt">Phase {phase}</span>
        <h1 style={{ fontSize: '2rem', marginTop: 14 }}>{title}</h1>
        <p className="text-soft" style={{ marginTop: 10, fontSize: '1.02rem' }}>{tagline}</p>

        <div className="soon-list">
          {features.map((f) => (
            <div key={f} className="soon-item">
              <IconCheck style={{ width: 17, height: 17, color: 'var(--violet)', flexShrink: 0 }} />
              <span>{f}</span>
            </div>
          ))}
        </div>

        {cta && <Link to={cta.to} className="btn btn-primary btn-lg" style={{ marginTop: 26 }}>{cta.label}</Link>}
      </div>
    </div>
  );
}
