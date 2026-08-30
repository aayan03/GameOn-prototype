import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { act } from '@testing-library/react';

import ErrorBoundary from '../components/ErrorBoundary.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import VenueCard from '../components/VenueCard.jsx';
import useCountUp from '../hooks/useCountUp.js';
import { rupees, distanceLabel, initials } from '../utils/format.js';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

// Unconditional: a test that fails before restoring timers would otherwise
// leave them faked, and every later `waitFor` would hang until timeout.
afterEach(() => vi.useRealTimers());

/* ── ErrorBoundary ───────────────────────────────────────────── */

describe('ErrorBoundary', () => {
  const Boom = ({ error }) => { throw error; };

  test('catches a render error instead of blanking the app', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    wrap(<ErrorBoundary><Boom error={new Error('kaboom')} /></ErrorBoundary>);

    expect(screen.getByText(/something broke on this page/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  test('recognises a stale chunk after a deploy and says so plainly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What a browser throws when index.html references chunks a new deploy
    // has already replaced. It is not a crash — a reload fixes it — so it
    // must not be presented as one.
    const stale = new Error('Failed to fetch dynamically imported module: /assets/Venues-abc.js');
    wrap(<ErrorBoundary><Boom error={stale} /></ErrorBoundary>);

    expect(screen.getByText(/new version of gameon is available/i)).toBeInTheDocument();
    expect(screen.queryByText(/something broke/i)).not.toBeInTheDocument();
    spy.mockRestore();
  });

  test('renders children untouched when nothing throws', () => {
    wrap(<ErrorBoundary><p>all good</p></ErrorBoundary>);
    expect(screen.getByText('all good')).toBeInTheDocument();
  });
});

/* ── ProtectedRoute ──────────────────────────────────────────── */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => globalThis.__auth,
}));

describe('ProtectedRoute', () => {
  test('waits rather than bouncing a user whose session is still loading', () => {
    globalThis.__auth = { user: null, loading: true };
    wrap(<ProtectedRoute><p>secret</p></ProtectedRoute>);

    // Redirecting here would log out anyone with a valid token on every
    // refresh, before /auth/me has had a chance to answer.
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  test('renders the page for a signed-in user', () => {
    globalThis.__auth = { user: { role: 'player' }, loading: false };
    wrap(<ProtectedRoute><p>secret</p></ProtectedRoute>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  test('refuses a player on an owner-only route', () => {
    globalThis.__auth = { user: { role: 'player' }, loading: false };
    wrap(<ProtectedRoute roles={['owner', 'admin']}><p>owner stuff</p></ProtectedRoute>);

    expect(screen.queryByText('owner stuff')).not.toBeInTheDocument();
    expect(screen.getByText(/not available for your account/i)).toBeInTheDocument();
  });

  test('admits an owner to an owner route', () => {
    globalThis.__auth = { user: { role: 'owner' }, loading: false };
    wrap(<ProtectedRoute roles={['owner', 'admin']}><p>owner stuff</p></ProtectedRoute>);
    expect(screen.getByText('owner stuff')).toBeInTheDocument();
  });
});

/* ── VenueCard ───────────────────────────────────────────────── */

describe('VenueCard', () => {
  const venue = {
    _id: 'v1', slug: 'turf-nation', name: 'Turf Nation',
    sports: ['football'], rating: 4.7, reviewCount: 214,
    startingPrice: 700, bookingMode: 'automated',
    address: { area: 'Koramangala', city: 'Bengaluru' },
  };

  test('shows the name, price and rating', () => {
    wrap(<VenueCard venue={venue} />);
    expect(screen.getByText('Turf Nation')).toBeInTheDocument();
    expect(screen.getByText('₹700')).toBeInTheDocument();
    expect(screen.getByText('4.7')).toBeInTheDocument();
  });

  test('links by slug so the URL is readable', () => {
    wrap(<VenueCard venue={venue} />);
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/venues/turf-nation');
  });

  test('distinguishes instant from on-request booking', () => {
    const { unmount } = wrap(<VenueCard venue={venue} />);
    expect(screen.getByText(/instant/i)).toBeInTheDocument();
    unmount();

    wrap(<VenueCard venue={{ ...venue, bookingMode: 'manual' }} />);
    expect(screen.getByText(/on request/i)).toBeInTheDocument();
  });

  test('flags an unclaimed listing, since its details are unverified', () => {
    wrap(<VenueCard venue={{ ...venue, isClaimed: false }} />);
    expect(screen.getByText(/unclaimed/i)).toBeInTheDocument();
  });

  test('calls back with the venue id when the heart is tapped', async () => {
    const onToggle = vi.fn();
    wrap(<VenueCard venue={venue} onToggleFavorite={onToggle} isFavorite={false} />);

    await userEvent.click(screen.getByRole('button', { name: /save venue/i }));
    expect(onToggle).toHaveBeenCalledWith('v1');
  });

  test('a brand new venue is labelled, not shown as zero stars', () => {
    wrap(<VenueCard venue={{ ...venue, rating: 0, reviewCount: 0 }} />);
    expect(screen.getByText(/new venue/i)).toBeInTheDocument();
  });
});

/* ── useCountUp ──────────────────────────────────────────────── */

describe('useCountUp', () => {
  // The hook hands back a ref that has to be attached to a real element —
  // its effect bails out immediately if there is nothing to observe. A bare
  // renderHook would test nothing at all.
  function Counter({ target }) {
    const [value, ref] = useCountUp(target);
    return <span ref={ref} data-testid="count">{value}</span>;
  }

  test('lands on the real number even when IntersectionObserver never fires', async () => {
    // jsdom's stub never invokes the callback, which is exactly the situation
    // that left "0 venues listed" on the landing page forever once the figure
    // became real data rather than decoration.
    vi.useFakeTimers();
    render(<Counter target={34} />);

    expect(screen.getByTestId('count')).toHaveTextContent('0');
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId('count')).toHaveTextContent('34');
  });

  test('shows the value immediately when reduced motion is preferred', () => {
    const original = window.matchMedia;
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });

    render(<Counter target={12} />);
    expect(screen.getByTestId('count')).toHaveTextContent('12');

    window.matchMedia = original;
  });
});

/* ── formatting ──────────────────────────────────────────────── */

describe('formatting', () => {
  test('formats rupees in the Indian grouping', () => {
    expect(rupees(700)).toBe('₹700');
    expect(rupees(140000)).toBe('₹1,40,000');
  });

  test('treats missing money as zero rather than NaN', () => {
    expect(rupees(undefined)).toBe('₹0');
    expect(rupees(null)).toBe('₹0');
  });

  test('switches to metres under a kilometre', () => {
    expect(distanceLabel(0.4)).toBe('400 m away');
    expect(distanceLabel(2.35)).toBe('2.4 km away');
    expect(distanceLabel(null)).toBe('');
  });

  test('builds initials from a name', () => {
    expect(initials('Aayan Ahmed')).toBe('AA');
  });
});

/* ── Async guard ─────────────────────────────────────────────── */

describe('ProtectedRoute transition', () => {
  test('renders the page once loading resolves', async () => {
    globalThis.__auth = { user: null, loading: true };
    const { rerender } = wrap(<ProtectedRoute><p>secret</p></ProtectedRoute>);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();

    globalThis.__auth = { user: { role: 'player' }, loading: false };
    rerender(<MemoryRouter><ProtectedRoute><p>secret</p></ProtectedRoute></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('secret')).toBeInTheDocument());
  });
});
