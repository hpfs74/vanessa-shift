import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

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

// Cognito's own shapes, not a guess: an app client id is 26 lowercase
// alphanumeric characters, and the managed-login domain is always
// "https://<prefix>.auth.<region>.amazoncognito.com". Checking for *some*
// value isn't enough — it stops the blank `VITE_CLIENT_ID=` that actually
// took the app down, but not a typo, a truncated paste, or a placeholder
// typed in just to make the build go green.
const CLIENT_ID_SHAPE = /^[a-z0-9]{26}$/;
const LOGIN_DOMAIN_SHAPE = /^https:\/\/[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/;

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
          `VITE_LOGIN_DOMAIN manca o non ha la forma di un dominio Cognito: "${env.VITE_LOGIN_DOMAIN ?? ''}".`,
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

export default defineConfig(({ command, mode }) => ({
  // The `command === 'build'` check is load-bearing, not tidiness: see the
  // comment on `richiedeConfigAccesso` above.
  plugins: [react(), ...(command === 'build' ? [richiedeConfigAccesso(mode)] : [])],
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
