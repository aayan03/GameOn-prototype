import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `base` is the single most load-bearing setting in this file.
 *
 * A relative base ('./') makes index.html reference `./assets/index-xxx.js`.
 * That is correct for Capacitor, which loads the app off the filesystem with
 * no server in front of it. On the web it is fatal: an SPA serves the SAME
 * index.html for every route, so a visitor landing on /venues/some-turf
 * resolves `./assets/...` against `/venues/` and asks for
 * /venues/assets/index-xxx.js. The host answers with the SPA fallback — HTML —
 * and the browser refuses to execute it as a module. The result is a blank
 * white page on every deep link, refresh and shared URL, with only a MIME
 * error in the console.
 *
 * So: absolute for the web, relative only when explicitly building for the
 * native shell (`VITE_BUILD_TARGET=capacitor npm run build`).
 */
const isCapacitorBuild = process.env.VITE_BUILD_TARGET === 'capacitor';

/**
 * The canonical public URL of this deployment.
 *
 * `https://gameon.app` was hardcoded into index.html, robots.txt and
 * sitemap.xml. If you do not own that domain — and nobody deploying this
 * repository does — the canonical tag tells Google your content belongs to
 * someone else's site, and the sitemap advertises URLs that are not yours.
 * Set VITE_SITE_URL to your real origin at build time.
 */
const SITE_URL = (process.env.VITE_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');

/**
 * Rewrites the `__SITE_URL__` placeholder in index.html and in anything copied
 * out of public/.
 *
 * Deliberately NOT Vite's own `%VAR%` syntax. Vite runs `decodeURI` over every
 * href and src while parsing index.html, and `%SI` is not a valid percent
 * escape — so a `%SITE_URL%` inside `<link rel="canonical" href>` failed the
 * whole build with "URI malformed" and a stack trace pointing at nothing
 * useful. Underscores survive that pass untouched.
 *
 * `order: 'pre'` so the substitution happens before Vite processes the URLs.
 */
function siteUrlPlugin() {
  return {
    name: 'gameon-site-url',
    transformIndexHtml: {
      order: 'pre',
      handler(html) { return html.replaceAll('__SITE_URL__', SITE_URL); },
    },
    /**
     * robots.txt and sitemap.xml live in public/, which Vite copies verbatim
     * to the output directory rather than passing through the bundle — so
     * `generateBundle` never sees them and they shipped with the placeholder
     * still in, advertising `__SITE_URL__/venues` to search engines.
     *
     * `closeBundle` runs after the copy, so rewrite them on disk there.
     */
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist');
      for (const name of ['robots.txt', 'sitemap.xml', 'manifest.webmanifest']) {
        const file = resolve(outDir, name);
        if (!existsSync(file)) continue;
        const text = readFileSync(file, 'utf8');
        if (text.includes('__SITE_URL__')) {
          writeFileSync(file, text.replaceAll('__SITE_URL__', SITE_URL));
        }
      }

      if (!process.env.VITE_SITE_URL && process.env.NODE_ENV !== 'test') {
        // Loud, because the consequence is invisible until Google has already
        // indexed the wrong domain.
        console.warn(
          `\n⚠️  VITE_SITE_URL is not set, so canonical URLs and the sitemap point at ${SITE_URL}.`
          + '\n   Set it to your real origin before a public deploy.\n'
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
  base: isCapacitorBuild ? './' : '/',
  server: {
    port: 5173,
    // Talk to the API through /api so the same code works in the browser
    // and inside the Capacitor WebView later.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Capacitor loads assets from the filesystem — relative paths are required.
    assetsDir: 'assets',
    // Source maps for production debugging without shipping readable source.
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * Split the vendor libraries out of the app bundle.
         *
         * Leaflet is ~150 KB and is needed by exactly two routes, but a single
         * chunk made every first-time visitor download it before the home page
         * could paint. Splitting it also means an app-code deploy no longer
         * invalidates the cached React/Leaflet chunks.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          leaflet: ['leaflet', 'react-leaflet'],
        },
      },
    },
    // The route-level chunks below are small; only warn on something genuinely large.
    chunkSizeWarningLimit: 700,
  },
});
