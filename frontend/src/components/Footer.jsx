import { Link, useLocation } from 'react-router-dom';

const LINKS = {
  Play: [
    { to: '/venues', label: 'Find venues' },
    { to: '/map', label: 'Explore the map' },
    { to: '/events', label: 'Sports events' },
    { to: '/parlors', label: 'Game parlours' },
    { to: '/teamup', label: 'TeamUp' },
    { to: '/bookings', label: 'My bookings' },
  ],
  Venues: [
    { to: '/register?role=owner', label: 'List your venue' },
    { to: '/owner', label: 'Owner dashboard' },
    { to: '/owner/requests', label: 'Booking requests' },
  ],
  // Razorpay's onboarding checks these are reachable from the site itself,
  // not just by URL — and a user should not have to guess the path to a
  // refund policy.
  Legal: [
    { to: '/terms', label: 'Terms of Service' },
    { to: '/privacy', label: 'Privacy Policy' },
    { to: '/refunds', label: 'Cancellations & Refunds' },
    { to: '/contact', label: 'Contact us' },
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
          <span>© {new Date().getFullYear()} GameOn. All rights reserved.</span>
          <span>Maps © OpenStreetMap contributors</span>
        </div>
      </div>
    </footer>
  );
}
