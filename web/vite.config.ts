import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { boardFixtures } from './board-fixtures.ts';

export default defineConfig(({ command }) => ({
  // The developer gallery exists only under the dev server. This is decided by the command, not
  // by NODE_ENV, so no build can include it (spec §3.1, issue #53).
  define: { __UI_GALLERY__: command === 'serve' },
  plugins: [react(), tailwindcss(), boardFixtures()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
}));
