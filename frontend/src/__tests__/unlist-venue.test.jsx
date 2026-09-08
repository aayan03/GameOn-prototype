/**
 * The confirmation an owner sees before removing a venue.
 *
 * The point of this dialog is that removal is NOT a deletion and NOT a
 * cancellation, and both are easy to assume. So what is asserted here is
 * mostly language: that it never promises to delete anything, and that an
 * owner with fixtures still to play is told those fixtures survive.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const remove = vi.fn();
vi.mock('../api/endpoints.js', () => ({ venueApi: { remove: (...a) => remove(...a) } }));

const success = vi.fn();
vi.mock('../context/ToastContext.jsx', () => ({ useToast: () => ({ success, error: vi.fn() }) }));

const { default: UnlistVenueModal } = await import('../components/UnlistVenueModal.jsx');

const venue = { _id: 'v1', name: 'Turf Nation', upcomingBookings: 0 };

beforeEach(() => {
  remove.mockReset().mockResolvedValue({ data: { deactivated: true, upcomingBookings: 0 } });
  success.mockReset();
});

describe('what it says', () => {
  test('never claims anything is deleted', () => {
    render(<UnlistVenueModal venue={venue} onClose={() => {}} onDone={() => {}} />);
    const text = document.body.textContent;
    expect(text).toMatch(/Nothing is deleted/i);
    expect(text).toMatch(/list it again/i);
    // The destructive button says what it does, not "Delete".
    expect(screen.getByRole('button', { name: /Remove listing/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete/i })).toBeNull();
  });

  test('stays quiet about bookings when there are none', () => {
    render(<UnlistVenueModal venue={venue} onClose={() => {}} onDone={() => {}} />);
    expect(document.body.textContent).not.toMatch(/will not be cancelled/i);
  });

  test('warns, with the number, when fixtures are still owed', () => {
    render(
      <UnlistVenueModal
        venue={{ ...venue, upcomingBookings: 3 }}
        onClose={() => {}}
        onDone={() => {}}
      />
    );
    const text = document.body.textContent;
    expect(text).toMatch(/3 upcoming bookings will not be cancelled/i);
    expect(text).toMatch(/refunded/i);
  });

  test('says "booking", not "bookings", for exactly one', () => {
    render(
      <UnlistVenueModal
        venue={{ ...venue, upcomingBookings: 1 }}
        onClose={() => {}}
        onDone={() => {}}
      />
    );
    expect(document.body.textContent).toMatch(/1 upcoming booking will not be cancelled/i);
  });
});

describe('what it does', () => {
  test('removes the venue and reports back', async () => {
    const onDone = vi.fn();
    render(<UnlistVenueModal venue={venue} onClose={() => {}} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: /Remove listing/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('v1'));
    expect(onDone).toHaveBeenCalled();
  });

  test('the success message repeats the bookings that still stand', async () => {
    remove.mockResolvedValue({ data: { deactivated: true, upcomingBookings: 2 } });
    render(<UnlistVenueModal venue={venue} onClose={() => {}} onDone={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /Remove listing/i }));

    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(success.mock.calls[0][0]).toMatch(/2 bookings still stand/i);
  });

  test('"Keep it listed" closes without touching anything', async () => {
    const onClose = vi.fn();
    render(<UnlistVenueModal venue={venue} onClose={onClose} onDone={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /Keep it listed/i }));

    expect(onClose).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test('a failure is shown and the dialog stays open to retry', async () => {
    remove.mockRejectedValue(new Error('Network is down'));
    const onDone = vi.fn();
    render(<UnlistVenueModal venue={venue} onClose={() => {}} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: /Remove listing/i }));

    await waitFor(() => expect(screen.getByText('Network is down')).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
    // Re-enabled, so the owner is not stuck staring at a dead button.
    expect(screen.getByRole('button', { name: /Remove listing/i }).disabled).toBe(false);
  });
});
