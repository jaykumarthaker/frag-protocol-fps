import { defineConfig } from 'vite';

// Static-only build (no game server in the offline milestone).
// `base: './'` keeps asset paths relative so the bundle works from any
// sub-path host (GitHub Pages project sites, itch.io, etc.).
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
