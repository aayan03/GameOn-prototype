# Turning GameOn into a mobile app

The frontend was written so that this is a packaging step, not a rewrite. Every
decision that would normally block a mobile conversion has already been handled.

## What was done up front

| Concern | How it was handled |
| --- | --- |
| **API URLs** | Every request goes through `src/api/client.js`. Set `VITE_API_URL` at build time and the whole app points at your production API. No component contains a URL. |
| **Routing** | React Router with relative asset paths (`base: './'` in `vite.config.js`). A WebView loads files from disk, where absolute paths break. |
| **Token storage** | Isolated in the `tokenStore` object in `client.js`. Swap `localStorage` for `@capacitor/preferences` by editing that one object. |
| **Geolocation** | `useGeolocation` uses the standard `navigator.geolocation` API, which Capacitor's Geolocation plugin shims natively. Works unchanged. |
| **Navigation UX** | A bottom tab bar (`TabBar.jsx`) is already the primary navigation on small screens — the pattern native users expect. |
| **Safe areas** | `--safe-top` and `--safe-bottom` CSS variables read `env(safe-area-inset-*)`, so content clears the notch and home indicator. |
| **Viewport** | `user-scalable=no, viewport-fit=cover` in `index.html` stops the pinch-zoom that makes web apps feel like web apps. |
| **CORS** | The backend allows `capacitor://localhost` and requests with no origin, which is what a WebView sends. |
| **Touch feel** | Tap highlight removed, overscroll bounce disabled, buttons scale on `:active`. |

## Steps when you're ready

```bash
cd frontend

# 1. Install Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android @capacitor/ios
npm install @capacitor/geolocation @capacitor/preferences @capacitor/push-notifications

# 2. Point the build at your live API
echo "VITE_API_URL=https://api.gameon.app" > .env.production

# 3. Build and add the native projects
npm run build
npx cap add android
npx cap add ios          # macOS with Xcode only

# 4. Copy the build into the native shells
npx cap sync

# 5. Open in the native IDE
npx cap open android     # Android Studio
npx cap open ios         # Xcode
```

`capacitor.config.json` is already in the repo with the app id `app.gameon.mobile`,
the splash screen colour set to the brand navy, and the geolocation permission
declared.

After any frontend change, `npm run cap:sync` rebuilds and copies it across.

## Two changes worth making for the native build

**1. Secure token storage.** In `src/api/client.js`, replace the `tokenStore`
body with Capacitor Preferences (native keychain / encrypted prefs rather than
WebView localStorage).

**2. Native permission prompt.** In `src/hooks/useGeolocation.js`, call
`Geolocation.requestPermissions()` from `@capacitor/geolocation` before
`getCurrentPosition` so the OS dialog appears at a sensible moment rather than
on first map load.

Neither is required to ship — the app works without them — but both improve
the experience meaningfully.

## Alternative: ship as a PWA first

`public/manifest.webmanifest` is already configured. Deploy the frontend over
HTTPS and users can "Add to Home Screen" on both platforms today, with no app
store review. Adding a service worker (`vite-plugin-pwa`) gets you offline
support. This is a reasonable Phase 4.5 while the native builds go through review.
