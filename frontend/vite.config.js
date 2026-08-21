import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
  },
  base: './',
});
