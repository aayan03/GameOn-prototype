/**
 * The phone menu, and the admin link at the bottom of it.
 *
 * The sheet used to render inside `.nav`. The nav is sticky with a z-index, so
 * it is a stacking context, and the bottom tab bar outranked the entire nav —
 * it painted straight across the bottom of the open sheet. The last item was
 * unreachable even scrolled to the end, and for an admin that is "Admin
 * dashboard".
 *
 * jsdom does no layout, so the overlap itself cannot be measured here. What
 * can be pinned is its cause: the sheet must not live inside the nav.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => globalThis.__auth }));

const { default: MobileMenu } = await import('../components/MobileMenu.jsx');

const ADMIN = { isAuthenticated: true, isOwner: true, user: { name: 'Asha Admin', role: 'admin' } };

function renderInNav(auth = ADMIN) {
  globalThis.__auth = auth;
  return render(
    <MemoryRouter>
      <header className="nav" data-testid="nav"><MobileMenu /></header>
    </MemoryRouter>
  );
}

const openMenu = async (user) => {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  return screen.getByRole('menu', { name: 'Menu' });
};

describe('MobileMenu', () => {
  test('opens outside the nav, where the tab bar cannot paint over it', async () => {
    const user = userEvent.setup();
    renderInNav();
    const sheet = await openMenu(user);

    expect(screen.getByTestId('nav').contains(sheet)).toBe(false);
    expect(sheet.closest('.sheet-backdrop').parentElement).toBe(document.body);
  });

  test('gives an admin the admin dashboard, as the last item', async () => {
    const user = userEvent.setup();
    renderInNav();
    const sheet = await openMenu(user);

    const items = within(sheet).getAllByRole('menuitem');
    const last = items[items.length - 1];
    expect(last).toHaveTextContent('Admin dashboard');
    expect(last).toHaveAttribute('href', '/admin');
  });

  test('does not show the admin link to an owner who is not an admin', async () => {
    const user = userEvent.setup();
    renderInNav({ isAuthenticated: true, isOwner: true, user: { name: 'Olu Owner', role: 'owner' } });
    const sheet = await openMenu(user);

    expect(within(sheet).queryByRole('menuitem', { name: /Admin dashboard/i })).toBeNull();
  });

  test('closes on Escape and hands focus back to the button', async () => {
    const user = userEvent.setup();
    renderInNav();
    await openMenu(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus();
  });

  test('closes on a tap outside the sheet, and leaves nothing behind in <body>', async () => {
    const user = userEvent.setup();
    renderInNav();
    await openMenu(user);
    expect(document.body.style.overflow).toBe('hidden');

    // The document-level listener checks DOM containment, which follows the
    // portal: the backdrop is outside the panel, so this must close it.
    fireEvent.mouseDown(document.querySelector('.sheet-backdrop'));

    expect(screen.queryByRole('menu', { name: 'Menu' })).toBeNull();
    expect(document.querySelectorAll('.sheet-backdrop')).toHaveLength(0);
    expect(document.body.style.overflow).toBe('');
  });

  test('a tap inside the sheet does not close it', async () => {
    const user = userEvent.setup();
    renderInNav();
    const sheet = await openMenu(user);

    fireEvent.mouseDown(within(sheet).getByText('Browse'));

    expect(screen.getByRole('menu', { name: 'Menu' })).toBeInTheDocument();
  });
});
