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

/** Without this, an empty `VITE_CLIENT_ID` builds clean, deploys clean, and
 *  only fails once she opens the app: the authorize URL goes out with
 *  `client_id=` empty, and what she sees is an error page on Cognito's own
 *  domain, naming nothing. Only for `vite build` — `vite dev` and the test
 *  runner both go through `command: 'serve'`, and neither has a real value
 *  to check, so neither should be stopped by its absence. */
function richiedeConfigAccesso(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    name: 'richiede-config-accesso',
    buildStart() {
      if (!env.VITE_LOGIN_DOMAIN || !env.VITE_CLIENT_ID) {
        this.error(
          'VITE_LOGIN_DOMAIN o VITE_CLIENT_ID mancante: build fermata prima di spedire un app che lei non potrebbe piu aprire.',
        );
      }
    },
  };
}

export default defineConfig(({ command, mode }) => ({
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
