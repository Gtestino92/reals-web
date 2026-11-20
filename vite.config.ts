import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { validateBuildEnvironment } from './src/config/environment.ts';
import { androidTunnelPlugin } from './tools/android-tunnel-monitor.ts';

export default defineConfig({
  plugins: [
    {
      name: 'reals-environment',
      apply: 'build',
      configResolved({ env }) {
        // Cloudflare metadata comes from the host process, outside Vite's mode-specific env files.
        validateBuildEnvironment(env, process.env);
      },
    },
    react(),
    androidTunnelPlugin(),
  ],
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
    env: { VITE_REALS_ENVIRONMENT: 'local', VITE_API_BASE_URL: '' },
    // Exercise browser persistence in jsdom; Firebase's Node build uses memory.
    alias: { 'firebase/auth': fileURLToPath(new URL('./node_modules/@firebase/auth/dist/esm/index.js', import.meta.url)) },
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    reporters: ['dot'],
  },
});
