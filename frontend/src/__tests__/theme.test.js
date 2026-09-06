/**
 * The palette, measured rather than eyeballed.
 *
 * A dark theme is easy to get subtly wrong in a way nobody notices until a
 * user with a dim screen or ordinary eyesight cannot read a price. It is also
 * easy to get STRUCTURALLY wrong in this particular design, which is built on
 * outlines and hard offset shadows: the first attempt here kept the near-black
 * outline in dark mode and it measured 1.36:1 against the card surface, i.e.
 * invisible. Every card lost its edge and the whole sticker language collapsed
 * into flat rectangles.
 *
 * So the numbers are asserted. The values are read out of theme.css rather
 * than duplicated here, so the test fails if somebody edits the palette
 * without re-checking it.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as joinPath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  joinPath(dirname(fileURLToPath(import.meta.url)), '../styles/theme.css'),
  'utf8',
);

/**
 * Pulls the token values out of one CSS block.
 *
 * Captures `var(--other)` aliases as well as literal hex, because several
 * tokens are defined by reference — `--stroke: var(--ink)` in the light theme
 * being the important one. Reading only hex silently dropped them and the
 * assertions below passed on `undefined`.
 */
function tokensIn(blockStart) {
  const start = css.indexOf(blockStart);
  if (start === -1) throw new Error(`block not found: ${blockStart}`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const out = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6}|var\(--[\w-]+\))/g)) {
    out[name] = value;
  }
  return out;
}

const rawLight = tokensIn(':root {');
const rawDark = tokensIn(":root[data-theme='dark'] {");

/** Follows `var(--x)` aliases until a literal colour falls out. */
function resolveToken(raw, fallback, name, depth = 0) {
  const value = raw[name] ?? fallback[name];
  if (value === undefined) throw new Error(`unknown token --${name}`);
  const alias = /^var\(--([\w-]+)\)$/.exec(value);
  if (!alias) return value;
  if (depth > 5) throw new Error(`circular alias at --${name}`);
  return resolveToken(raw, fallback, alias[1], depth + 1);
}

const light = (name) => resolveToken(rawLight, rawLight, name);
// Anything the dark block does not redefine falls through to light.
const inDark = (name) => resolveToken(rawDark, rawLight, name);

/* ── WCAG 2.1 relative luminance ─────────────────────────────── */

const channels = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const linear = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (h) => {
  const [r, g, b] = channels(h).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ['light', light],
  ['dark', inDark],
])('%s theme', (_name, t) => {
  /* ── Readability ──────────────────────────────────────────── */

  test('body text clears AA on both surfaces', () => {
    expect(contrast(t('text'), t('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t('text'), t('surface'))).toBeGreaterThanOrEqual(4.5);
  });

  test('secondary text clears AA', () => {
    expect(contrast(t('text-soft'), t('surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t('text-soft'), t('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  test('faint text clears AA-large, which is all it is used for', () => {
    expect(contrast(t('text-faint'), t('surface'))).toBeGreaterThanOrEqual(3);
  });

  test('the primary button is legible', () => {
    // Volt fill, ink label — the most-clicked thing on the site.
    expect(contrast(t('ink'), t('volt'))).toBeGreaterThanOrEqual(4.5);
  });

  test('white text on the dark slabs is legible', () => {
    // The hero, loyalty strip and owner CTA are all `--ink` with #fff on top,
    // in BOTH themes. In dark, --ink goes darker rather than lighter, which is
    // what keeps this true.
    expect(contrast('#FFFFFF', t('ink'))).toBeGreaterThanOrEqual(4.5);
  });

  /* ── Structure: this design is its outlines ───────────────── */

  test('the outline is visible against the surface it encloses', () => {
    // 3:1 is the WCAG threshold for a meaningful non-text boundary, and a card
    // with no visible edge is not this design.
    expect(contrast(t('stroke'), t('surface'))).toBeGreaterThanOrEqual(3);
  });

  test('the outline is visible against the page too', () => {
    expect(contrast(t('stroke'), t('bg'))).toBeGreaterThanOrEqual(3);
  });

  test('the hard shadow reads against the page', () => {
    // Lower bar than an outline: a shadow only has to be perceptible.
    expect(contrast(t('sh-color'), t('bg'))).toBeGreaterThanOrEqual(1.8);
  });

  test('a card is distinguishable from the page', () => {
    // Not by its fill — white on warm paper is 1.05:1 by design, and that is
    // the point of the whole outlined aesthetic. The edge does the work, so
    // assert the edge and only sanity-check that the fill is not identical.
    expect(contrast(t('stroke'), t('bg'))).toBeGreaterThanOrEqual(3);
    expect(contrast(t('surface'), t('bg'))).toBeGreaterThan(1.01);
  });

  test('a dark slab is distinct from the page behind it', () => {
    // The hero sits on the body background. If those converge the section
    // boundary disappears — which is exactly what happens if --ink is allowed
    // to drift towards --bg in the dark theme.
    expect(contrast(t('ink'), t('bg'))).toBeGreaterThanOrEqual(1.15);
  });

  /* ── Accents ──────────────────────────────────────────────── */

  test('soft accent backgrounds carry body text', () => {
    // Badges and alerts put --text on a --*-soft fill. In light these are
    // pastels; in dark they have to become deep tints or the page strobes.
    for (const hue of ['volt', 'magenta', 'violet', 'orange', 'sky']) {
      expect(
        contrast(t('text'), t(`${hue}-soft`)),
        `${hue}-soft`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('status colours are legible on their own soft fills', () => {
    for (const s of ['success', 'warning', 'danger']) {
      expect(contrast(t(s), t(`${s}-soft`)), s).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('theme wiring', () => {
  test('the dark block is mirrored into the prefers-color-scheme fallback', () => {
    // The two blocks are duplicated by hand because a media query cannot join
    // a selector list. Drift between them shows up as a theme that behaves
    // differently depending on whether the user chose it or inherited it.
    const media = tokensIn(":root:not([data-theme='light']) {");
    for (const [name, value] of Object.entries(rawDark)) {
      expect(media[name], `--${name} differs between the two dark blocks`).toBe(value);
    }
  });

  test('an explicit light choice can override a dark system preference', () => {
    expect(css).toContain(":root:not([data-theme='light'])");
  });

  test('color-scheme is declared for both, so native controls follow', () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/\[data-theme='dark'\]\s*\{[^}]*color-scheme:\s*dark/);
  });
});
