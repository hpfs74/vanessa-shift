import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
