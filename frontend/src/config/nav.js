/**
 * The site's navigation, in one place.
 *
 * It used to live inline in Navbar.jsx, inside a `.nav-links` bar that is
 * `display: none` below 900px. So every link that was not also in the bottom
 * tab bar simply did not exist on a phone: Map and Events were reachable only
 * from the footer, and an owner on mobile could not reach their calendar,
 * promos, customers, payouts or events at all — nor an admin the moderation
 * queue. Adding a feature to the desktop bar silently shipped it hidden on
 * the device most people use.
 *
 * Both the desktop bar and the mobile sheet read from here now, so the two
 * cannot disagree.
 */

/**
 * `group` is what the desktop bar uses to draw its dividers and the mobile
 * sheet uses for its headings — the same structure, told twice.
 */
export function navSections({ isAuthenticated = false, isOwner = false, isAdmin = false } = {}) {
  const sections = [
    {
      key: 'browse',
      label: 'Browse',
      links: [
        { to: '/venues', label: 'Find venues' },
        { to: '/map', label: 'Map' },
        { to: '/events', label: 'Events' },
        { to: '/playgrounds', label: 'Free grounds' },
        { to: '/teamup', label: 'TeamUp' },
        ...(isAuthenticated ? [{ to: '/teams', label: 'Teams' }] : []),
      ],
    },
  ];

  if (isOwner || isAdmin) {
    sections.push({
      key: 'manage',
      label: 'Manage',
      links: [
        { to: '/owner', label: 'My venues' },
        { to: '/owner/requests', label: 'Requests' },
        // "My events", not "Events" — an owner otherwise sees the word twice,
        // once meaning "browse what's on" and once "the ones I run".
        { to: '/owner/events', label: 'My events' },
        { to: '/owner/calendar', label: 'Calendar' },
        { to: '/owner/promos', label: 'Promo codes' },
        { to: '/owner/customers', label: 'Customers' },
        { to: '/owner/payouts', label: 'Payouts' },
      ],
    });
  }

  if (isAdmin) {
    sections.push({
      key: 'admin',
      label: 'Admin',
      links: [{ to: '/admin', label: 'Admin dashboard' }],
    });
  }

  return sections;
}

/**
 * What the desktop bar shows.
 *
 * Narrower than the sheet on purpose: seven owner links would not fit beside
 * the logo, so the bar carries the three an owner opens daily and the sheet
 * carries all of them. The bar is a shortcut; the sheet is the map.
 */
const DESKTOP_ONLY = new Set([
  '/owner/calendar', '/owner/promos', '/owner/customers', '/owner/payouts',
]);

export function desktopNavGroups(roles) {
  return navSections(roles).map((section) => ({
    ...section,
    links: section.links.filter((l) => !DESKTOP_ONLY.has(l.to)),
  }));
}
