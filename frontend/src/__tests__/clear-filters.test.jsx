/**
 * "Clear filters" on the four pages you can search.
 *
 * What each page is held to:
 *   - the control appears for ANY narrowing, including search text on its own
 *     (Find venues never offered one for that), and not for nothing;
 *   - clearing empties the search box as well as the URL (Events' old button
 *     left the words in the box above an unfiltered list);
 *   - text cleared mid-debounce is not sent back to the URL afterwards.
 *
 * Every page reads its filters from the URL, so a probe renders the query
 * string beside the page and the assertions read that.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const empty = { data: [], meta: { total: 0, page: 1, pages: 1 } };

vi.mock('../api/endpoints.js', () => ({
  venueApi: { list: vi.fn(), cities: vi.fn(), toggleFav: vi.fn() },
  eventApi: { list: vi.fn(), cities: vi.fn() },
  playgroundApi: { list: vi.fn(), cities: vi.fn() },
  teamupApi: { list: vi.fn(), join: vi.fn(), withdraw: vi.fn() },
}));
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: null, setUser: () => {}, isAuthenticated: false }),
}));
vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
// Leaflet has nothing to draw into under jsdom, and no test here needs a map.
vi.mock('../components/VenueMap.jsx', () => ({ default: () => null }));

const api = await import('../api/endpoints.js');
const { default: Venues } = await import('../pages/Venues.jsx');
const { default: Events } = await import('../pages/Events.jsx');
const { default: Playgrounds } = await import('../pages/Playgrounds.jsx');
const { default: TeamUp } = await import('../pages/TeamUp.jsx');

beforeEach(() => {
  api.venueApi.list.mockResolvedValue(empty);
  api.venueApi.cities.mockResolvedValue({ data: [] });
  api.eventApi.list.mockResolvedValue({ data: [] });
  api.eventApi.cities.mockResolvedValue({ data: [] });
  api.playgroundApi.list.mockResolvedValue({ data: [] });
  api.playgroundApi.cities.mockResolvedValue({ data: [] });
  api.teamupApi.list.mockResolvedValue(empty);
});

function Probe() {
  return <output data-testid="query">{useLocation().search}</output>;
}

function renderAt(Page, url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Page />
      <Probe />
    </MemoryRouter>
  );
}

const query = () => screen.getByTestId('query').textContent;
// The ClearFilters row, not a button of the same name inside an empty state.
const rowButton = () => screen.queryAllByRole('button', { name: 'Clear filters' })
  .find((b) => !b.closest('.empty')) || null;
// Inside act, because the debounce timer sets state while we wait for it.
const pastTheDebounce = () => act(() => new Promise((r) => { setTimeout(r, 600); }));

/* ── Find venues ─────────────────────────────────────────────── */

describe('Find venues', () => {
  test('is not offered when nothing is filtered, and a page number is not a filter', async () => {
    renderAt(Venues, '/venues?page=2');
    await waitFor(() => expect(api.venueApi.list).toHaveBeenCalled());
    expect(rowButton()).toBeNull();
  });

  test('is offered for search text alone, and clears the box and the URL', async () => {
    const user = userEvent.setup();
    renderAt(Venues, '/venues');

    await user.type(screen.getByRole('textbox', { name: 'Search venues' }), 'turf');
    // Before the debounce: typed text already counts.
    expect(rowButton()).not.toBeNull();
    await waitFor(() => expect(query()).toContain('q=turf'));

    await user.click(rowButton());

    expect(screen.getByRole('textbox', { name: 'Search venues' })).toHaveValue('');
    expect(query()).toBe('');
    expect(rowButton()).toBeNull();
  });

  test('text cleared before the debounce fires is not sent back to the URL', async () => {
    const user = userEvent.setup();
    renderAt(Venues, '/venues');

    await user.type(screen.getByRole('textbox', { name: 'Search venues' }), 'kora');
    await user.click(rowButton());
    await pastTheDebounce();

    expect(query()).toBe('');
    expect(screen.getByRole('textbox', { name: 'Search venues' })).toHaveValue('');
  });

  test('sort order alone brings back "Clear all" in the filter drawer', async () => {
    renderAt(Venues, '/venues?sort=price_low');
    await waitFor(() => expect(api.venueApi.list).toHaveBeenCalled());
    // The drawer header is hidden by CSS on desktop, but it is rendered; this
    // is the button a phone sees once Filters is open.
    expect(within(document.querySelector('.filters-head')).getByRole('button', { name: 'Clear all' }))
      .toBeInTheDocument();
  });
});

/* ── Events ──────────────────────────────────────────────────── */

describe('Events', () => {
  test('"Any time" is the default, not a filter', async () => {
    renderAt(Events, '/events?when=all');
    await waitFor(() => expect(api.eventApi.list).toHaveBeenCalled());
    expect(rowButton()).toBeNull();
  });

  test('clearing from the empty state empties the search box too', async () => {
    const user = userEvent.setup();
    renderAt(Events, '/events?q=run&type=marathon');

    const box = screen.getByRole('textbox', { name: 'Search events' });
    expect(box).toHaveValue('run');

    // The row button renders at once; the empty-state one waits for the list.
    const inEmptyState = () => screen.queryAllByRole('button', { name: /Clear filters/ })
      .find((b) => b.closest('.empty'));
    await waitFor(() => expect(inEmptyState()).toBeTruthy());

    await user.click(inEmptyState());
    await pastTheDebounce();

    expect(box).toHaveValue('');
    expect(query()).toBe('');
  });
});

/* ── Free grounds ────────────────────────────────────────────── */

describe('Free grounds', () => {
  test('clears search and sport, and leaves the remembered location alone', async () => {
    // Home sorts venues by this too; clearing a filter here must not forget it.
    localStorage.setItem('gameon_last_location', JSON.stringify({ lat: 12.97, lng: 77.59, ts: Date.now() }));
    const user = userEvent.setup();
    renderAt(Playgrounds, '/playgrounds?sport=football');

    await user.type(screen.getByRole('textbox', { name: 'Search public grounds' }), 'park');
    await waitFor(() => expect(query()).toContain('q=park'));

    await user.click(rowButton());
    await pastTheDebounce();

    expect(query()).toBe('');
    expect(screen.getByRole('textbox', { name: 'Search public grounds' })).toHaveValue('');
    expect(localStorage.getItem('gameon_last_location')).not.toBeNull();
  });

  test('a remembered location on its own does not offer to clear anything', async () => {
    localStorage.setItem('gameon_last_location', JSON.stringify({ lat: 12.97, lng: 77.59, ts: Date.now() }));
    renderAt(Playgrounds, '/playgrounds');
    await waitFor(() => expect(api.playgroundApi.list).toHaveBeenCalled());
    expect(rowButton()).toBeNull();
  });
});

/* ── TeamUp ──────────────────────────────────────────────────── */

describe('TeamUp', () => {
  test('a shared "near me" link counts, and clearing turns it off with everything else', async () => {
    const user = userEvent.setup();
    renderAt(TeamUp, '/teamup?lat=12.97&lng=77.59&radiusKm=25&when=today');

    expect(rowButton()).not.toBeNull();
    expect(screen.getByRole('button', { name: /Near me · on/ })).toBeInTheDocument();

    await user.click(rowButton());

    expect(query()).toBe('');
    expect(screen.getByRole('button', { name: /^Near me$/ })).toBeInTheDocument();
    expect(rowButton()).toBeNull();
  });
});
