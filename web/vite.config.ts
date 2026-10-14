import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
