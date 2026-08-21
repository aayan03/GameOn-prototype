import { NavLink } from 'react-router-dom';
import { IconHome, IconSearch, IconUsers, IconTicket, IconUser } from './Icons.jsx';

/**
 * Bottom tab bar — hidden on desktop, always visible on mobile.
 * This is the navigation pattern the native app will keep verbatim.
 */
const TABS = [
  { to: '/',        label: 'Home',    Icon: IconHome,   end: true },
  { to: '/venues',  label: 'Explore', Icon: IconSearch },
  { to: '/teamup',  label: 'TeamUp',  Icon: IconUsers },
  { to: '/bookings',label: 'Tickets', Icon: IconTicket },
  { to: '/profile', label: 'You',     Icon: IconUser },
];

export default function TabBar() {
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
