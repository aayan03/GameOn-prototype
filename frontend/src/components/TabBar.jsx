import { NavLink } from 'react-router-dom';
import { IconHome, IconSearch, IconUsers, IconTicket, IconUser, IconPin } from './Icons.jsx';

/**
 * Bottom tab bar — hidden on desktop, always visible on mobile.
 * This is the navigation pattern the native app will keep verbatim.
 */
/**
 * Six, not five.
 *
 * The desktop link bar is hidden below 900px, so anything not in here is
 * reachable on a phone only by typing the URL. Free grounds was exactly that
 * — a whole feature with no way in on the device most people use — which is
 * how a nav that is a fixed list goes wrong when a feature is added beside it.
 */
const TABS = [
  { to: '/',            label: 'Home',    Icon: IconHome,   end: true },
  { to: '/venues',      label: 'Explore', Icon: IconSearch },
  { to: '/playgrounds', label: 'Free',    Icon: IconPin },
  { to: '/teamup',      label: 'TeamUp',  Icon: IconUsers },
  { to: '/bookings',    label: 'Tickets', Icon: IconTicket },
  { to: '/profile',     label: 'You',     Icon: IconUser },
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
