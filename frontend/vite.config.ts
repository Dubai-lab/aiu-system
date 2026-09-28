import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // shared/pages.json is the page registry used by both the router and the assistant
      '@shared': path.resolve(import.meta.dirname, '../shared'),
    },
  },
  // Explicit empty PostCSS config: stops Vite from picking up a postcss.config.js
  // from a parent folder (Tailwind v4 runs through its Vite plugin instead).
  css: { postcss: {} },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
  },
});
