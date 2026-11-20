import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/health': {
        target: process.env.API_PROXY ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
