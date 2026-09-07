/**
 * Every operation on the site, as a jumpable list.
 *
 * This is the "all operations" half of the search box: the API can find a
 * venue called Zenith, but nothing on the server knows that typing "wallet"
 * should take you to /wallet. That mapping lives here, matched in the
 * browser, so it answers instantly and works offline.
 *
 * Kept as data rather than JSX so it can be filtered and tested without
 * rendering anything.
 */

/**
 * `keywords` exist because people search for the word in their head, not the
 * word we printed on the button. Someone looking to cancel a booking types
 * "cancel"; someone after their loyalty tier types "points".
 */
const ALL = [
  // ── Browsing ──────────────────────────────────────────────
  { id: 'venues', label: 'Find venues', to: '/venues', group: 'Browse', icon: 'search', keywords: 'turf ground court book play pitch' },
  { id: 'map', label: 'Map view', to: '/map', group: 'Browse', icon: 'map', keywords: 'near me nearby location' },
  { id: 'events', label: 'Events', to: '/events', group: 'Browse', icon: 'calendar', keywords: 'tournament match league fixture' },
  { id: 'parlors', label: 'Game parlours', to: '/parlors', group: 'Browse', icon: 'sparkle', keywords: 'snooker pool bowling arcade gaming cafe vr karting board games indoor' },
  { id: 'teamup', label: 'TeamUp — find players', to: '/teamup', group: 'Browse', icon: 'users', keywords: 'join game players squad team up need' },

  // ── Your account ─────────────────────────────────────────
  { id: 'bookings', label: 'My bookings', to: '/bookings', group: 'You', icon: 'ticket', auth: true, keywords: 'reservation cancel ticket upcoming past receipt' },
  { id: 'wallet', label: 'Wallet', to: '/wallet', group: 'You', icon: 'wallet', auth: true, keywords: 'money balance refund top up credit payment' },
  { id: 'loyalty', label: 'Loyalty & rewards', to: '/loyalty', group: 'You', icon: 'sparkle', auth: true, keywords: 'points tier rewards streak level' },
  { id: 'favorites', label: 'Saved venues', to: '/favorites', group: 'You', icon: 'heart', auth: true, keywords: 'favourites saved bookmark liked' },
  { id: 'teams', label: 'My teams', to: '/teams', group: 'You', icon: 'users', auth: true, keywords: 'squad roster members' },
  { id: 'notifications', label: 'Notifications', to: '/notifications', group: 'You', icon: 'info', auth: true, keywords: 'alerts updates messages' },
  { id: 'profile', label: 'Profile & settings', to: '/profile', group: 'You', icon: 'user', auth: true, keywords: 'account settings password email phone edit' },

  // ── Owner ────────────────────────────────────────────────
  { id: 'owner', label: 'Owner dashboard', to: '/owner', group: 'Manage', icon: 'home', owner: true, keywords: 'my venues earnings stats revenue' },
  { id: 'owner-requests', label: 'Booking requests', to: '/owner/requests', group: 'Manage', icon: 'ticket', owner: true, keywords: 'approve decline pending accept' },
  { id: 'owner-calendar', label: 'Venue calendar', to: '/owner/calendar', group: 'Manage', icon: 'calendar', owner: true, keywords: 'schedule slots block availability' },
  { id: 'owner-promos', label: 'Promo codes', to: '/owner/promos', group: 'Manage', icon: 'sparkle', owner: true, keywords: 'discount coupon offer voucher' },
  { id: 'owner-customers', label: 'Customers', to: '/owner/customers', group: 'Manage', icon: 'users', owner: true, keywords: 'players regulars visitors' },
  { id: 'owner-payouts', label: 'Payouts', to: '/owner/payouts', group: 'Manage', icon: 'wallet', owner: true, keywords: 'settlement bank money earnings withdraw' },
  { id: 'owner-events', label: 'My events', to: '/owner/events', group: 'Manage', icon: 'calendar', owner: true, keywords: 'host organise tournament create event' },
  { id: 'owner-new', label: 'Add a venue', to: '/owner/venues/new', group: 'Manage', icon: 'bolt', owner: true, keywords: 'list new create register turf' },

  // ── Admin ────────────────────────────────────────────────
  { id: 'admin', label: 'Admin dashboard', to: '/admin', group: 'Manage', icon: 'shield', admin: true, keywords: 'moderation approve users reports queue' },

  // ── Signed out ───────────────────────────────────────────
  { id: 'login', label: 'Log in', to: '/login', group: 'Account', icon: 'user', guest: true, keywords: 'sign in signin' },
  { id: 'register', label: 'Sign up', to: '/register', group: 'Account', icon: 'user', guest: true, keywords: 'register create account join signup' },

  // ── Help ─────────────────────────────────────────────────
  { id: 'contact', label: 'Contact support', to: '/contact', group: 'Help', icon: 'info', keywords: 'help support email problem complaint' },
  { id: 'refunds', label: 'Cancellation & refund policy', to: '/refunds', group: 'Help', icon: 'info', keywords: 'refund cancel money back policy' },
  { id: 'terms', label: 'Terms of service', to: '/terms', group: 'Help', icon: 'info', keywords: 'legal conditions' },
  { id: 'privacy', label: 'Privacy policy', to: '/privacy', group: 'Help', icon: 'info', keywords: 'data gdpr legal' },
];

/**
 * The actions a given person can actually perform. An owner-only route shown
 * to a player is not a shortcut, it is a redirect to the login page.
 */
export function actionsFor({ isAuthenticated = false, isOwner = false, isAdmin = false } = {}) {
  return ALL.filter((a) => {
    if (a.auth && !isAuthenticated) return false;
    if (a.guest && isAuthenticated) return false;
    if (a.owner && !(isOwner || isAdmin)) return false;
    if (a.admin && !isAdmin) return false;
    return true;
  });
}

/**
 * Ranked match. Prefix beats word-start beats anywhere, so typing "wall"
 * puts Wallet first rather than whatever happened to be earlier in the array.
 * Keyword hits always rank below label hits — the label is what they will
 * see, so a label match is the one that looks right.
 */
function score(action, q) {
  const label = action.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  // A word start, so "refund" ranks "Cancellation & refund policy" above
  // anything that merely contains those letters in the middle of a word.
  const wordStart = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (wordStart.test(label)) return 1;
  if (label.includes(q)) return 2;
  if ((action.keywords || '').includes(q)) return 3;
  return -1;
}

export function matchActions(actions, query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return actions
    .map((a) => ({ a, s: score(a, q) }))
    .filter(({ s }) => s >= 0)
    .sort((x, y) => x.s - y.s)
    .slice(0, limit)
    .map(({ a }) => a);
}

/** What the palette shows before anything is typed. */
export function defaultActions(actions, limit = 6) {
  return actions.slice(0, limit);
}

export default ALL;
