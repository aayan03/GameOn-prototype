import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The API client is the single chokepoint every screen goes through, so its
 * failure handling is what the user actually experiences when something is
 * wrong. These cover the paths that produce a message rather than a crash.
 */

let api, tokenStore, ApiError;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  ({ api, tokenStore, ApiError } = await import('../api/client.js'));
});

afterEach(() => vi.unstubAllGlobals());

/**
 * Minimal fetch stand-in.
 *
 * Both `text()` and `json()` are provided: the main request path reads the
 * body as text (so a non-JSON error page can be reported usefully), while
 * `attemptRefresh` uses `json()`. A stub with only one of them makes every
 * token refresh look like a failure.
 */
function mockFetch(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const spy = vi.fn(async () => {
    const r = queue.length > 1 ? queue.shift() : queue[0];
    if (r.throws) throw r.throws;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('token storage', () => {
  test('round-trips and clears both tokens', () => {
    tokenStore.set('access-1', 'refresh-1');
    expect(tokenStore.access).toBe('access-1');
    expect(tokenStore.refresh).toBe('refresh-1');

    tokenStore.clear();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  test('a null refresh does not wipe the stored one', () => {
    tokenStore.set('access-1', 'refresh-1');
    tokenStore.set('access-2', null);
    expect(tokenStore.access).toBe('access-2');
    expect(tokenStore.refresh).toBe('refresh-1');
  });
});

describe('requests', () => {
  test('attaches the bearer token when there is one', async () => {
    tokenStore.set('tok-abc', null);
    const spy = mockFetch({ status: 200, body: { success: true, data: {} } });

    await api.get('/venues');
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-abc');
  });

  test('omits the header when auth is off, even with a token stored', async () => {
    tokenStore.set('tok-abc', null);
    const spy = mockFetch({ status: 200, body: { success: true, data: {} } });

    await api.get('/config', undefined, { auth: false });
    expect(spy.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test('drops empty params instead of sending blanks', async () => {
    const spy = mockFetch({ status: 200, body: { success: true, data: [] } });
    await api.get('/venues', { sport: 'football', city: '', page: undefined, amenities: [] });

    const url = new URL(spy.mock.calls[0][0]);
    expect(url.searchParams.get('sport')).toBe('football');
    expect(url.searchParams.has('city')).toBe(false);
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('amenities')).toBe(false);
  });

  test('serialises array params as comma-separated', async () => {
    const spy = mockFetch({ status: 200, body: { success: true, data: [] } });
    await api.get('/venues', { amenities: ['parking', 'wifi'] });
    expect(new URL(spy.mock.calls[0][0]).searchParams.get('amenities')).toBe('parking,wifi');
  });
});

describe('error handling', () => {
  test('surfaces the API error message and status', async () => {
    mockFetch({ status: 409, body: { success: false, error: { message: 'That slot has just been taken.' } } });

    await expect(api.post('/bookings', {})).rejects.toMatchObject({
      message: 'That slot has just been taken.',
      status: 409,
    });
  });

  test('passes field-level validation details through', async () => {
    mockFetch({
      status: 400,
      body: { success: false, error: { message: 'Validation failed', details: { password: 'too short' } } },
    });

    await expect(api.post('/auth/register', {})).rejects.toMatchObject({
      details: { password: 'too short' },
    });
  });

  test('an HTML response is explained, not parsed into a cryptic error', async () => {
    // The real symptom of a missing VITE_API_URL: the host answers the SPA
    // fallback and the old code died with "Unexpected token '<'".
    mockFetch({ status: 200, body: '<!doctype html><html><body>Not found</body></html>' });

    const err = await api.get('/venues').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/did not answer|web page instead of data/i);
    expect(err.message).not.toMatch(/Unexpected token/);
  });

  test('a network failure names the likely cause', async () => {
    mockFetch({ throws: new TypeError('Failed to fetch') });

    const err = await api.get('/venues').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/cannot reach the server/i);
  });

  test('treats success:false as an error even on a 200', async () => {
    mockFetch({ status: 200, body: { success: false, error: { message: 'Nope' } } });
    await expect(api.get('/venues')).rejects.toMatchObject({ message: 'Nope' });
  });
});

describe('session expiry', () => {
  test('refreshes once on a 401 and replays the request', async () => {
    tokenStore.set('stale', 'refresh-1');

    const spy = mockFetch([
      { status: 401, body: { success: false, error: { message: 'expired' } } },
      { status: 200, body: { success: true, data: { accessToken: 'fresh' } } },
      { status: 200, body: { success: true, data: { ok: true } } },
    ]);

    const res = await api.get('/auth/me');
    expect(res.data).toEqual({ ok: true });
    expect(tokenStore.access).toBe('fresh');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test('clears the session and announces expiry when refresh fails', async () => {
    tokenStore.set('stale', 'refresh-1');
    mockFetch([
      { status: 401, body: { success: false, error: { message: 'expired' } } },
      { status: 401, body: { success: false, error: { message: 'refresh dead' } } },
    ]);

    const expired = vi.fn();
    window.addEventListener('gameon:session-expired', expired);

    await api.get('/auth/me').catch(() => {});

    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
    expect(expired).toHaveBeenCalled();
    window.removeEventListener('gameon:session-expired', expired);
  });

  test('does not attempt a refresh when there is no refresh token', async () => {
    tokenStore.set('stale', null);
    tokenStore.clear();
    const spy = mockFetch({ status: 401, body: { success: false, error: { message: 'nope' } } });

    await api.get('/auth/me').catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
