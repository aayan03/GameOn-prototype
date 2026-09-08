import {
  IconSearch, IconMap, IconCalendar, IconPin, IconUsers, IconShield,
  IconHome, IconTicket, IconClock, IconSparkle, IconWallet, IconChevron,
} from './Icons.jsx';

/**
 * Resolves the icon NAME held in config/nav.js to a component.
 *
 * The config stays a plain data file so it can be read — by the desktop bar,
 * the mobile sheet, or a test — without dragging a component tree in behind
 * it. The mapping lives here, at the point of rendering.
 */
const MAP = {
  search: IconSearch, map: IconMap, calendar: IconCalendar, pin: IconPin,
  users: IconUsers, shield: IconShield, home: IconHome, ticket: IconTicket,
  clock: IconClock, sparkle: IconSparkle, wallet: IconWallet,
};

export default function NavIcon({ name, size = 17, ...rest }) {
  const Art = MAP[name] || IconChevron;
  return <Art style={{ width: size, height: size, flexShrink: 0 }} {...rest} />;
}
