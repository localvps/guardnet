import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.GUARDNET_BACKEND || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/files': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
