import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react()],
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
