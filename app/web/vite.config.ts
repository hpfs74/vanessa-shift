import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Node's own global `localStorage` (behind `--experimental-webstorage` on
// some Node versions, unflagged on newer ones) shadows jsdom's per-window
// one inside the worker pool, leaving it `undefined` unless a
// `--localstorage-file` was given. auth.ts and its tests need jsdom's
// version, scoped to the fake window, not a file on disk. Feature-detected,
// so it is a no-op on a Node build that never registered the flag.
const noNodeWebStorage = process.allowedNodeEnvironmentFlags.has(
  '--no-experimental-webstorage',
)
  ? ['--no-experimental-webstorage']
  : [];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vanessa/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    poolOptions: {
      threads: { execArgv: noNodeWebStorage },
      forks: { execArgv: noNodeWebStorage },
    },
  },
  // `npm run dev` serves the page from localhost, where /api and /foto have
  // nobody behind them: forward both to the deployed origins. In production
  // CloudFront does this, and neither address appears in the bundle.
  server: {
    proxy: {
      '/api': {
        target: 'https://sp99qts2me.execute-api.eu-south-1.amazonaws.com',
        changeOrigin: true,
      },
      '/foto': {
        target: 'https://yogkdmcpt4kdfochgr5vq4k6u40hsjuj.lambda-url.eu-south-1.on.aws',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/foto/, ''),
      },
    },
  },
});
