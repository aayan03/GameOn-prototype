import { Link, useLocation } from 'react-router-dom';

const LINKS = {
  Play: [
    { to: '/venues', label: 'Find venues' },
    { to: '/map', label: 'Explore the map' },
    { to: '/teamup', label: 'TeamUp' },
    { to: '/bookings', label: 'My bookings' },
  ],
  Venues: [
    { to: '/register?role=owner', label: 'List your venue' },
    { to: '/owner', label: 'Owner dashboard' },
    { to: '/owner/requests', label: 'Booking requests' },
  ],
  Sports: [
    { to: '/venues?sport=football', label: 'Football' },
    { to: '/venues?sport=cricket', label: 'Cricket' },
    { to: '/venues?sport=badminton', label: 'Badminton' },
    { to: '/venues?sport=basketball', label: 'Basketball' },
  ],
};

export default function Footer() {
  const { pathname } = useLocation();
  // The map fills the viewport — a footer under it would just create dead scroll.
  if (pathname === '/map') return null;

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link to="/" className="logo" style={{ marginBottom: 14 }}>
              <span className="logo-mark">GO</span> GameOn
            </Link>
            <p style={{ maxWidth: '34ch', fontSize: '.92rem' }}>
              Find. Book. Play. India's sports venue platform — built for weekend
              warriors, college teams and local leagues.
            </p>
          </div>

          {Object.entries(LINKS).map(([heading, links]) => (
            <div key={heading}>
              <h4>{heading}</h4>
              {links.map((l) => (
                <Link key={l.to} to={l.to} className="footer-link">{l.label}</Link>
              ))}
            </div>
          ))}
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} GameOn. Built from the GameOn investor deck.</span>
          <span>Maps © OpenStreetMap contributors</span>
        </div>
      </div>
    </footer>
  );
}
