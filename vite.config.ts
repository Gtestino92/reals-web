import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { androidTunnelPlugin } from './tools/android-tunnel-monitor.ts';

export default defineConfig({
  plugins: [react(), androidTunnelPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Exercise browser persistence in jsdom; Firebase's Node build uses memory.
    alias: { 'firebase/auth': fileURLToPath(new URL('./node_modules/@firebase/auth/dist/esm/index.js', import.meta.url)) },
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    reporters: ['dot'],
  },
});
