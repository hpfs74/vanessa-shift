import { fileURLToPath } from 'node:url';
import process from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The two shapes live in `env-shapes.ts`, where a test can reach them
// without importing this file — see the comment there. Extensionless on
// purpose: vite bundles its own config with esbuild, which resolves `.ts`
// from a bare specifier but does not remap a written-out `.js` back to it.
import { CLIENT_ID_SHAPE, LOGIN_DOMAIN_SHAPE, versioneDelBuild } from './env-shapes';

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

/** Without this, an empty (or junk) `VITE_CLIENT_ID` builds clean, deploys
 *  clean, and only fails once she opens the app: the authorize URL goes out
 *  broken, and what she sees is an error page on Cognito's own domain,
 *  naming nothing. Only for `vite build`: `vite dev` calls `buildStart` too
 *  — this isn't tidiness, the `command === 'build'` gate below is the only
 *  thing stopping this plugin from also breaking `npm run dev` and the
 *  whole vitest run, neither of which has a real value to check anyway. */
function richiedeConfigAccesso(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    name: 'richiede-config-accesso',
    buildStart() {
      if (!LOGIN_DOMAIN_SHAPE.test(env.VITE_LOGIN_DOMAIN ?? '')) {
        this.error(
          `VITE_LOGIN_DOMAIN manca o non e' un'origine https senza percorso: "${env.VITE_LOGIN_DOMAIN ?? ''}".`,
        );
      }
      if (!CLIENT_ID_SHAPE.test(env.VITE_CLIENT_ID ?? '')) {
        this.error(
          `VITE_CLIENT_ID manca o non ha la forma di un client id Cognito (26 caratteri alfanumerici minuscoli): "${env.VITE_CLIENT_ID ?? ''}".`,
        );
      }
    },
  };
}

/** Installable on her phone's home screen, and the shell opens without a
 *  network. Only the app itself is precached: /api, /foto and /colleghe are
 *  never touched by the service worker, so data is always live (or fails
 *  the way it already did offline), never a stale copy.
 *
 *  `autoUpdate` with the plain registration script: a new deploy activates
 *  at once and is picked up on the next open, no "update?" prompt. There
 *  are no lazy chunks, so an already-open page never asks for a file the
 *  new worker has cleaned away. */
const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'script-defer',
  includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icona.svg'],
  manifest: {
    name: 'Turni di Vanessa',
    short_name: 'Turni',
    description: 'I turni, le presenze e la busta paga di Vanessa.',
    lang: 'it',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#1F3A5F',
    background_color: '#1F3A5F',
    icons: [
      { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    navigateFallback: '/index.html',
    // A navigation to any of these must reach CloudFront, not get the cached
    // shell back.
    navigateFallbackDenylist: [/^\/api\//, /^\/foto\//, /^\/colleghe\//],
    cleanupOutdatedCaches: true,
  },
});

export default defineConfig(({ command, mode }) => ({
  // The `command === 'build'` check is load-bearing, not tidiness: see the
  // comment on `richiedeConfigAccesso` above.
  plugins: [react(), pwa, ...(command === 'build' ? [richiedeConfigAccesso(mode)] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(versioneDelBuild(process.env)),
  },
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
}));
