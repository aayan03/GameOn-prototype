/**
 * The action list behind the global search box.
 *
 * Two things matter here. First, ranking: a shortcut that puts the right
 * answer third is a shortcut nobody trusts. Second, and more importantly,
 * visibility — the palette must never offer somebody a page that will bounce
 * them to the login screen, and must never hint at admin tooling to a player.
 */
import { describe, it, expect } from 'vitest';
import ALL, { actionsFor, matchActions, defaultActions } from '../utils/actions.js';

const guest = actionsFor({ isAuthenticated: false });
const player = actionsFor({ isAuthenticated: true });
const owner = actionsFor({ isAuthenticated: true, isOwner: true });
const admin = actionsFor({ isAuthenticated: true, isAdmin: true });

const ids = (rows) => rows.map((r) => r.id);

describe('who sees what', () => {
  it('offers a signed-out visitor nothing that needs an account', () => {
    expect(ids(guest)).not.toContain('wallet');
    expect(ids(guest)).not.toContain('bookings');
    expect(ids(guest)).toContain('login');
    expect(ids(guest)).toContain('venues');
  });

  it('stops offering log in and sign up once you are signed in', () => {
    expect(ids(player)).not.toContain('login');
    expect(ids(player)).not.toContain('register');
    expect(ids(player)).toContain('wallet');
  });

  it('keeps owner tools away from players', () => {
    expect(ids(player)).not.toContain('owner-payouts');
    expect(ids(owner)).toContain('owner-payouts');
  });

  it('keeps the admin dashboard away from owners', () => {
    expect(ids(owner)).not.toContain('admin');
    expect(ids(admin)).toContain('admin');
  });

  it('lets an admin reach the owner tooling too', () => {
    // Admins moderate venues, so the owner screens are part of their job.
    expect(ids(admin)).toContain('owner-requests');
  });

  it('never exposes a gated route to a guest, whatever the flag', () => {
    const gated = ALL.filter((a) => a.auth || a.owner || a.admin).map((a) => a.id);
    expect(gated.length).toBeGreaterThan(5);
    for (const id of gated) expect(ids(guest)).not.toContain(id);
  });
});

describe('matching', () => {
  it('puts an exact prefix first', () => {
    expect(matchActions(player, 'wall')[0].id).toBe('wallet');
    expect(matchActions(player, 'prof')[0].id).toBe('profile');
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(matchActions(player, '  WALLET ')[0].id).toBe('wallet');
  });

  it('finds a page by a word people actually use for it', () => {
    // None of these words appear in the label they should match.
    expect(ids(matchActions(player, 'snooker'))).toContain('parlors');
    expect(ids(matchActions(player, 'points'))).toContain('loyalty');
    expect(ids(matchActions(owner, 'discount'))).toContain('owner-promos');
    expect(ids(matchActions(player, 'turf'))).toContain('venues');
  });

  it('ranks a label match above a keyword match', () => {
    // "Events" is a label; several other rows carry it as a keyword.
    const hits = matchActions(player, 'events');
    expect(hits[0].id).toBe('events');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(matchActions(player, '')).toEqual([]);
    expect(matchActions(player, '   ')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(matchActions(player, 'e', 3).length).toBeLessThanOrEqual(3);
  });

  it('treats regex metacharacters as text', () => {
    // The matcher builds a RegExp from the query; an unescaped '(' would throw
    // and take the whole palette down with it.
    expect(() => matchActions(player, '(')).not.toThrow();
    expect(() => matchActions(player, 'a+*[')).not.toThrow();
    expect(matchActions(player, '.*')).toEqual([]);
  });

  it('only ever returns actions the caller was given', () => {
    // Matching cannot reintroduce something actionsFor filtered out.
    const hits = matchActions(guest, 'wallet');
    expect(hits).toEqual([]);
  });
});

describe('the empty state', () => {
  it('suggests somewhere to go before anything is typed', () => {
    const shown = defaultActions(player, 6);
    expect(shown.length).toBe(6);
    expect(ids(shown)).toContain('venues');
    expect(ids(shown)).toContain('parlors');
  });
});

describe('the list itself', () => {
  it('has no duplicate ids', () => {
    expect(new Set(ALL.map((a) => a.id)).size).toBe(ALL.length);
  });

  it('points every action at an absolute route', () => {
    for (const a of ALL) {
      expect(a.to.startsWith('/')).toBe(true);
      expect(a.label.length).toBeGreaterThan(2);
      expect(a.group).toBeTruthy();
    }
  });

  it('covers the parlour locator, which is the thing people could not find', () => {
    const parlor = ALL.find((a) => a.id === 'parlors');
    expect(parlor.to).toBe('/parlors');
    for (const word of ['snooker', 'bowling', 'arcade']) {
      expect(parlor.keywords).toContain(word);
    }
  });
});
