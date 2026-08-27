import { defineConfig } from 'vite';

// Orbit is a plain ES-module project: Vite is only used as a dev server and
// bundler. No framework plugins, no transpiling magic.
export default defineConfig({
  server: {
    port: 5173,
    // Print the URL instead of hijacking a browser window.
    open: false,
    host: 'localhost',
  },
  preview: {
    port: 4173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
