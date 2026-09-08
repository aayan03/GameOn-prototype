/**
 * The site's navigation, in one place.
 *
 * It used to be written out by hand inside Navbar.jsx, in a `.nav-links` bar
 * that is `display: none` below 900px. So every link not also in the bottom
 * tab bar simply did not exist on a phone: Map and Events were footer-only,
 * and an owner could not reach their calendar, promos, customers or payouts
 * at all. Adding a feature to the desktop bar silently shipped it hidden on
 * the device most people use.
 *
 * The desktop bar and the mobile sheet both read from here, so the two
 * cannot drift apart.
 */

/**
 * The FLAT list — every destination, no grouping.
 * The mobile sheet uses this, because a sheet has room to just list things.
 */
export function navSections({ isAuthenticated = false, isOwner = false, isAdmin = false } = {}) {
  const sections = [
    {
      key: 'browse',
      label: 'Browse',
      links: [
        { to: '/venues', label: 'Find venues', icon: 'search' },
        { to: '/map', label: 'Map', icon: 'map' },
        { to: '/events', label: 'Events', icon: 'calendar' },
        { to: '/playgrounds', label: 'Free grounds', icon: 'pin' },
        { to: '/teamup', label: 'TeamUp', icon: 'users' },
        ...(isAuthenticated ? [{ to: '/teams', label: 'Teams', icon: 'shield' }] : []),
      ],
    },
  ];

  if (isOwner || isAdmin) {
    sections.push({
      key: 'manage',
      label: 'Manage',
      links: [
        { to: '/owner', label: 'My venues', icon: 'home' },
        { to: '/owner/requests', label: 'Requests', icon: 'ticket' },
        // "My events", not "Events" — an owner otherwise sees the word twice,
        // once meaning "browse what's on" and once "the ones I run".
        { to: '/owner/events', label: 'My events', icon: 'calendar' },
        { to: '/owner/calendar', label: 'Calendar', icon: 'clock' },
        { to: '/owner/promos', label: 'Promo codes', icon: 'sparkle' },
        { to: '/owner/customers', label: 'Customers', icon: 'users' },
        { to: '/owner/payouts', label: 'Payouts', icon: 'wallet' },
      ],
    });
  }

  if (isAdmin) {
    sections.push({
      key: 'admin',
      label: 'Admin',
      links: [{ to: '/admin', label: 'Admin dashboard', icon: 'shield' }],
    });
  }

  return sections;
}

/**
 * The GROUPED list — what the desktop bar draws.
 *
 * Nine flat links beside a logo is a wall of words, and it got worse with
 * every feature: an owner was reading Find venues / Map / Events / Free
 * grounds / TeamUp / Teams / My venues / Requests / My events across one
 * line. Four or five headings with the detail one click down is the same
 * information at a glance-able size.
 *
 * An entry with `to` is a plain link; one with `links` opens a menu. Events
 * stays a link because a menu holding one item is a worse version of a link.
 */
export function navMenus({ isAuthenticated = false, isOwner = false, isAdmin = false } = {}) {
  const menus = [
    {
      key: 'play',
      label: 'Play',
      links: [
        { to: '/venues', label: 'Find venues', icon: 'search', hint: 'Book a turf or court' },
        { to: '/map', label: 'Map', icon: 'map', hint: 'Everything near you' },
        { to: '/playgrounds', label: 'Free grounds', icon: 'pin', hint: 'Public parks, no charge' },
      ],
    },
    { key: 'events', label: 'Events', to: '/events', icon: 'calendar' },
    {
      key: 'players',
      label: 'Players',
      links: [
        { to: '/teamup', label: 'TeamUp', icon: 'users', hint: 'Find people for a game' },
        ...(isAuthenticated ? [{ to: '/teams', label: 'My teams', icon: 'shield', hint: 'Squads you belong to' }] : []),
      ],
    },
  ];

  if (isOwner || isAdmin) {
    menus.push({
      key: 'manage',
      label: 'Manage',
      links: [
        { to: '/owner', label: 'My venues', icon: 'home', hint: 'Performance and listings' },
        { to: '/owner/requests', label: 'Requests', icon: 'ticket', hint: 'Approve or decline' },
        { to: '/owner/calendar', label: 'Calendar', icon: 'clock', hint: 'Slots and blackouts' },
        { to: '/owner/events', label: 'My events', icon: 'calendar', hint: 'Ones you host' },
        { to: '/owner/promos', label: 'Promo codes', icon: 'sparkle', hint: 'Discounts and offers' },
        { to: '/owner/customers', label: 'Customers', icon: 'users', hint: 'Who plays at yours' },
        { to: '/owner/payouts', label: 'Payouts', icon: 'wallet', hint: 'What you are owed' },
      ],
    });
  }

  if (isAdmin) menus.push({ key: 'admin', label: 'Admin', to: '/admin', icon: 'shield' });

  return menus;
}

/**
 * Icon name -> component, resolved where it is rendered.
 *
 * The config stays a plain data file — no JSX — so it can be read by
 * anything, including a test, without pulling a component tree in behind it.
 */
export const NAV_ICON_NAMES = [
  'search', 'map', 'calendar', 'pin', 'users', 'shield',
  'home', 'ticket', 'clock', 'sparkle', 'wallet',
];
