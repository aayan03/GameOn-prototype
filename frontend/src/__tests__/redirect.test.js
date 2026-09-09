/**
 * The post-login redirect guard.
 *
 * `/login?next=…` is the only navigation target in the app that comes from a
 * URL, so it is the only place an open redirect could live. react-router has
 * an open advisory for the backslash variant specifically, which is why the
 * awkward-looking cases below are all here.
 */
import { describe, it, expect } from 'vitest';
import { safeRedirect } from '../utils/redirect.js';

describe('safeRedirect', () => {
  it('allows ordinary internal paths', () => {
    for (const p of [
      '/',
      '/bookings',
      '/playgrounds/new',
      '/venues/turf-nation-1?date=2026-09-11',
      '/bookings/GRP1234#ticket',
    ]) {
      expect(safeRedirect(p)).toBe(p);
    }
  });

  it('refuses anything that would leave the site', () => {
    for (const p of [
      '//evil.com',              // protocol-relative
      '//evil.com/path',
      '/\\evil.com',             // browsers normalise \ to / — this is //evil.com
      '\\\\evil.com',
      '/path\\to\\evil',         // a backslash anywhere at all
      'https://evil.com',
      'http://evil.com',
      '//' ,
      'javascript:alert(1)',     // eslint-disable-line no-script-url
      'data:text/html,<script>alert(1)</script>',
    ]) {
      expect(safeRedirect(p)).toBe('/');
    }
  });

  it('refuses relative paths that are not rooted', () => {
    for (const p of ['bookings', './bookings', '../admin', '']) {
      expect(safeRedirect(p)).toBe('/');
    }
  });

  it('refuses anything that is not a string', () => {
    for (const v of [null, undefined, 42, {}, [], true]) {
      expect(safeRedirect(v)).toBe('/');
    }
  });

  it('honours a caller-supplied fallback', () => {
    expect(safeRedirect('//evil.com', '/venues')).toBe('/venues');
    expect(safeRedirect(null, '/venues')).toBe('/venues');
  });
});
