import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { boardFixtures } from './board-fixtures.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), boardFixtures()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
