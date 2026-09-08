/**
 * Sport icons, drawn rather than typed.
 *
 * These replace the emoji the site used everywhere (⚽ 🏏 🏸 …). Emoji were
 * quick but they are not ours: every platform draws them differently, so the
 * same chip was a flat vector on Android, a glossy 3D bubble on iOS and a
 * fifth thing on Windows. They also ignore font-size in surprising ways, sit
 * on their own baseline, and cannot take a colour.
 *
 * Pickleball was 🥒. A cucumber. There is no pickleball emoji, so the closest
 * thing to a pickle got used instead.
 *
 * ── Why the art is stored as markup strings ──────────────────────────
 * Leaflet builds its map pins from an HTML STRING (L.divIcon), so it cannot
 * take a React element. The choice was to write every icon twice — once as
 * JSX and once as a string — or to keep one copy and hand it to both. Two
 * copies of eight icons drift the moment anybody edits one, so there is a
 * single ART map here, injected into a <svg> either way. It is a fixed
 * constant in this file, never user input, which is what makes the
 * innerHTML safe.
 *
 * ── House style ──────────────────────────────────────────────────────
 * 32×32, flat filled shapes, no hairline strokes. Thin outlines disappear
 * below about 20px and fight the chunky borders this design is built on, so
 * contrast comes from the shapes themselves: a light ball carries dark seams,
 * a dark object carries light ones. One icon therefore works on a white tile,
 * on a violet tile, and on a dark-mode surface without a per-theme variant.
 *
 * Colours are the sport's own, not the app palette — a basketball that is not
 * orange stops being a basketball — so they are literals and do not re-theme.
 *
 * Every ball carries a dark contour. It looks redundant on a white chip, and
 * it is the only reason the football survives on the white hero tile and the
 * basketball on the orange one: a shape filled the same colour as what is
 * behind it has no silhouette at all.
 */

const INK = '#16162B';
/*
 * Grips are LIGHT with a dark outline, not solid ink.
 * The hero tiles are black, and a near-black bat handle on a black tile
 * is a bat with no handle. A cream grip carrying an outline reads on a
 * white chip and on a black tile alike, which is the whole point of
 * having one icon rather than a per-surface variant.
 */
const GRIP = '#F4F1E8';

export const ART = {
  football:
    `<circle cx="16" cy="16" r="13" fill="#FFFFFF"/>`
    + `<path d="M16 10.4 21.3 14.3 19.3 20.5 12.7 20.5 10.7 14.3Z" fill="${INK}"/>`
    + `<g stroke="${INK}" stroke-width="1.9" stroke-linecap="round">`
    + `<path d="M16 10.4V3.4"/><path d="m21.3 14.3 6.6-2.2"/><path d="m19.3 20.5 4.1 5.6"/>`
    + `<path d="m12.7 20.5-4.1 5.6"/><path d="m10.7 14.3-6.6-2.2"/></g>`
    + `<circle cx="16" cy="16" r="13" fill="none" stroke="${INK}" stroke-width="1.6"/>`,

  basketball:
    `<circle cx="16" cy="16" r="13" fill="#F0812F"/>`
    + `<g stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round">`
    + `<path d="M16 3v26M3 16h26"/>`
    + `<path d="M7.2 6.6c3.4 2.6 5.1 5.7 5.1 9.4s-1.7 6.8-5.1 9.4"/>`
    + `<path d="M24.8 6.6c-3.4 2.6-5.1 5.7-5.1 9.4s1.7 6.8 5.1 9.4"/></g>`
    + `<circle cx="16" cy="16" r="13" fill="none" stroke="${INK}" stroke-width="1.6"/>`,

  tennis:
    `<circle cx="16" cy="16" r="13" fill="#C8F02F"/>`
    + `<g stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round">`
    + `<path d="M5.4 9.2c3.9 2.2 6 5.9 6 10.4 0 2.6-.7 5-2 7"/>`
    + `<path d="M26.6 9.2c-3.9 2.2-6 5.9-6 10.4 0 2.6.7 5 2 7"/></g>`
    + `<circle cx="16" cy="16" r="13" fill="none" stroke="${INK}" stroke-width="1.6"/>`,

  volleyball:
    `<circle cx="16" cy="16" r="13" fill="#FFFFFF"/>`
    + `<g stroke="#6C3CE9" stroke-width="2.1" fill="none" stroke-linecap="round">`
    + `<path d="M16 3c-4 4.6-5.4 9.3-4.2 14.2"/>`
    + `<path d="M27.5 12.2c-5.9-1.4-10.7-.2-14.4 3.6"/>`
    + `<path d="M9.6 27.1c2.9-5.4 6.7-8.5 11.6-9.4"/></g>`
    + `<circle cx="16" cy="16" r="13" fill="none" stroke="${INK}" stroke-width="1.6"/>`,

  // Cork base, flared feather skirt.
  badminton:
    `<path d="M12.4 12.6h7.2l4.9 12.1a1.6 1.6 0 0 1-1.5 2.2H9a1.6 1.6 0 0 1-1.5-2.2Z" fill="#FFFFFF"/>`
    + `<g stroke="${INK}" stroke-width="1.6" stroke-linecap="round">`
    + `<path d="M16 13v13.9M13.1 13 9.7 26.9M18.9 13l3.4 13.9"/></g>`
    + `<path d="M12.4 12.6a3.6 3.6 0 0 1 7.2 0 6 6 0 0 1-.5 2.4h-6.2a6 6 0 0 1-.5-2.4Z" fill="#D8352A"/>`
    + `<path d="M12.4 12.6h7.2" stroke="${INK}" stroke-width="1.6"/>`,

  // Bat across the diagonal, ball tucked into the corner.
  cricket:
    `<g transform="rotate(-38 16 16)">`
    + `<rect x="13.2" y="3.4" width="5.6" height="9" rx="2.4" fill="${GRIP}" stroke="${INK}" stroke-width="1.4"/>`
    + `<rect x="11.2" y="11.4" width="9.6" height="17.2" rx="4" fill="#D8A15C"/>`
    + `<path d="M16 12.6v14.8" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" opacity=".45"/></g>`
    + `<circle cx="24.6" cy="23.6" r="6" fill="#D8352A"/>`
    + `<path d="M21.2 18.7a6 6 0 0 1 0 9.8" stroke="#FFFFFF" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  tabletennis:
    `<g transform="rotate(-28 16 16)">`
    + `<rect x="13.4" y="19.6" width="4.6" height="9.6" rx="2.3" fill="${GRIP}" stroke="${INK}" stroke-width="1.4"/>`
    + `<circle cx="15.7" cy="13.4" r="9.4" fill="#D8352A"/>`
    + `<circle cx="15.7" cy="13.4" r="9.4" fill="none" stroke="${INK}" stroke-width="1.6"/></g>`
    + `<circle cx="25.4" cy="8.2" r="4.1" fill="#FFFFFF" stroke="${INK}" stroke-width="1.6"/>`,

  // Square-ish paddle, and the ball's characteristic perforations.
  pickleball:
    `<g transform="rotate(-24 16 16)">`
    + `<rect x="13.5" y="20.4" width="4.4" height="9" rx="2.2" fill="${GRIP}" stroke="${INK}" stroke-width="1.4"/>`
    + `<rect x="6.4" y="2.6" width="18.6" height="19.4" rx="6.4" fill="#3BB3E8"/>`
    + `<rect x="6.4" y="2.6" width="18.6" height="19.4" rx="6.4" fill="none" stroke="${INK}" stroke-width="1.7"/></g>`
    + `<circle cx="24.6" cy="24" r="6.1" fill="#C8F02F" stroke="${INK}" stroke-width="1.6"/>`
    + `<g fill="${INK}"><circle cx="22.6" cy="22.3" r="1"/><circle cx="26.5" cy="22.6" r="1"/>`
    + `<circle cx="23" cy="26.1" r="1"/><circle cx="26.7" cy="26" r="1"/></g>`,

  /** A generic pitch, for a sport we have no art for. */
  fallback:
    `<rect x="3" y="7" width="26" height="18" rx="3" fill="#1FA85C"/>`
    + `<g stroke="#FFFFFF" stroke-width="1.7" fill="none">`
    + `<path d="M16 7v18"/><circle cx="16" cy="16" r="4"/>`
    + `<path d="M3 12h4v8H3M29 12h-4v8h4"/></g>`,
};

const artFor = (sport) => ART[sport] || ART.fallback;

/**
 * `size` is pixels (or any CSS length); everything else passes through.
 * Decorative by default — these sit beside a text label almost everywhere,
 * and a screen reader announcing "football football" is noise. Pass `title`
 * where the icon stands alone.
 */
export default function SportIcon({ sport, size = 20, title, ...rest }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
      /*
        inline-block, not block. These replaced inline emoji, and a good few
        of the places they landed are plain text containers rather than flex
        rows — a block-level SVG there pushes the label onto its own line,
        which is what happened to the sport tags on the venue cards. Sitting
        inline keeps the old flow behaviour; flex parents are unaffected.
      */
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: '-0.15em' }}
      {...rest}
      dangerouslySetInnerHTML={{
        __html: (title ? `<title>${title}</title>` : '') + artFor(sport),
      }}
    />
  );
}

/** The same icon as an HTML string, for Leaflet's `L.divIcon`. */
export function sportIconMarkup(sport, size = 20) {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" `
    + `focusable="false" style="display:block">${artFor(sport)}</svg>`;
}
