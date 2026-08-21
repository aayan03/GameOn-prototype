# GameOn web app

React 18 + Vite + React Router + Leaflet. No UI framework — the design system is
about 900 lines of CSS built from the investor deck's palette.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the production build
```

`npm run dev` proxies `/api` to `http://localhost:5000`, so start the backend first.

## Layout

```
src/
├── api/          HTTP client + endpoint definitions (the only place URLs live)
├── components/   Navbar, TabBar, VenueCard, VenueMap, Icons, route guards
├── context/      AuthContext — session state for the whole app
├── hooks/        useGeolocation, useDebounce
├── pages/        One file per route
├── styles/       theme.css (design tokens) + app.css (components)
└── utils/        Formatting helpers
```

## Things worth knowing

**Filters live in the URL.** `Venues.jsx` reads every filter from the query
string, so a filtered search is a shareable link and the back button works.

**One HTTP client.** `api/client.js` handles the base URL, auth headers, silent
token refresh on a 401, and error normalisation. Parallel 401s collapse into a
single refresh call. Components never touch `fetch`.

**Maps are free.** Leaflet with OpenStreetMap tiles — no API key, no billing
account, no usage caps to worry about. To switch to Google Maps later, change
the `TileLayer` url in `VenueMap.jsx`; nothing else references a map provider.

**Design tokens.** Colours, radii, shadows and spacing are CSS custom properties
in `theme.css`, taken from the deck: `--ink` `#16162B`, `--volt` `#D6FF3F`,
`--magenta` `#FF3E7F`, `--violet` `#6C3CE9`. The shape language is chunky on
purpose — `--bw` thick outlines and `--sh-*` hard offset shadows with no blur.
Change those two token groups and the whole app changes character.

**Motion.** `useReveal` adds a class via IntersectionObserver when an element
scrolls into view; `useCountUp` animates numbers the same way. `Confetti` is
pure CSS on absolutely-positioned divs, no canvas and no library. Everything
collapses to no-ops under `prefers-reduced-motion`.

**Toasts.** `useToast()` from `ToastContext` — `toast.success(...)`,
`toast.error(...)`. It falls back to `console` outside the provider so a
component rendered in isolation still works.

**Built for the app shell.** Bottom tab bar on mobile, safe-area insets, no
pinch-zoom, no tap highlight, buttons that scale on press. See `../MOBILE.md`.

## Environment

```
VITE_API_URL=            # empty in dev (proxied); full origin in production
VITE_MAP_PROVIDER=osm    # "osm" or "carto" — both free
```
