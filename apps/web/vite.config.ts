import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'codemirror',
      '@codemirror/view',
      '@codemirror/state',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lang-html',
      '@codemirror/lang-css',
      '@codemirror/lang-javascript',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Dev convenience: browser → same-origin /api → daemon
      '/api': {
        target: process.env.NEOS_SERVER_URL || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
