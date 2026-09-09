/**
 * The client error reporter.
 *
 * Two things are worth testing here and they are not the happy path. One: it
 * must send nothing at all when no DSN is configured, because that is the
 * default and a reporter that leaks in development is worse than none. Two: a
 * crash report travels to a third party, so what it carries matters — a query
 * string on this app can hold a password-reset token.
 */
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

const DSN = 'https://abc123@o1.ingest.sentry.io/42';

/** Re-imports the module with a given env, since the DSN is read at load. */
async function load({ dsn = '', release = '' } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', dsn);
  vi.stubEnv('VITE_RELEASE', release);
  return import('../utils/errorReporter.js');
}

/** The JSON body of the single call made to Sentry. */
const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('without a DSN', () => {
  it('is disabled and sends nothing', async () => {
    const { report, isEnabled } = await load();
    expect(isEnabled()).toBe(false);

    report(new Error('boom'), { tags: { kind: 'test' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('installs no global handlers', async () => {
    const spy = vi.spyOn(window, 'addEventListener');
    const { installGlobalHandlers } = await load();
    installGlobalHandlers();
    const kinds = spy.mock.calls.map(([k]) => k);
    expect(kinds).not.toContain('unhandledrejection');
  });
});

describe('with a DSN', () => {
  it('posts one report with the error on it', async () => {
    const { report, isEnabled } = await load({ dsn: DSN, release: 'abc1234' });
    expect(isEnabled()).toBe(true);

    report(new TypeError('cannot read x of undefined'));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://o1.ingest.sentry.io/api/42/store/');
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=abc123');

    const body = sentBody();
    expect(body.exception.values[0].type).toBe('TypeError');
    expect(body.exception.values[0].value).toMatch(/cannot read x/);
    expect(body.release).toBe('abc1234');
  });

  it('strips the query string off the reported URL', async () => {
    // /reset-password?token=… and /login?next=… both carry values that must
    // not leave the browser inside a crash report.
    const { report } = await load({ dsn: DSN });
    window.history.pushState({}, '', '/reset-password?token=super-secret-value');

    report(new Error('boom'));

    const body = sentBody();
    expect(body.request.url).not.toContain('super-secret-value');
    expect(body.request.url).not.toContain('?');
    expect(body.request.url).toContain('/reset-password');
  });

  it('redacts credential-shaped keys from context', async () => {
    const { report } = await load({ dsn: DSN });

    report(new Error('boom'), {
      extra: {
        password: 'hunter2',
        accessToken: 'ey.jwt.here',
        nested: { refreshToken: 'r.e.f', signature: 'zzsignedzz' },
        harmless: 'keep me',
      },
    });

    const raw = JSON.stringify(sentBody());
    // Distinctive values on purpose: a short one like "sig" also appears
    // inside the legitimate key name "signature", and the assertion would
    // fail on correctly-redacted output.
    for (const secret of ['hunter2', 'ey.jwt.here', 'r.e.f', 'zzsignedzz']) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain('keep me');
  });

  it('sends the user id but never their name or email', async () => {
    const { report } = await load({ dsn: DSN });
    report(new Error('boom'), { userId: '507f1f77bcf86cd799439011' });

    const body = sentBody();
    expect(body.user).toEqual({ id: '507f1f77bcf86cd799439011' });
  });

  it('reports a repeated error once, not once per throw', async () => {
    // A render loop can throw hundreds of times a minute. Without this the
    // first user to hit one exhausts the quota for everybody.
    const { report } = await load({ dsn: DSN });

    for (let i = 0; i < 50; i++) report(new Error('the same failure'));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('still reports a genuinely different error', async () => {
    const { report } = await load({ dsn: DSN });
    report(new Error('first'));
    report(new Error('second'));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('never throws, whatever it is handed', async () => {
    const { report } = await load({ dsn: DSN });
    const circular = {}; circular.self = circular;

    for (const bad of [null, undefined, 'a string', 42, circular, new Error()]) {
      expect(() => report(bad, { extra: { circular } })).not.toThrow();
    }
  });

  it('survives the network being down', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    const { report } = await load({ dsn: DSN });
    expect(() => report(new Error('boom'))).not.toThrow();
  });
});

describe('with a malformed DSN', () => {
  it('stays off rather than sending somewhere wrong', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { report, isEnabled } = await load({ dsn: 'not-a-url' });

    expect(isEnabled()).toBe(false);
    report(new Error('boom'));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
