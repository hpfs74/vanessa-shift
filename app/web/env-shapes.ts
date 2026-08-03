/** The shapes the build guard in `vite.config.ts` demands of the two
 *  settings baked into the bundle. Neither is a secret; both being wrong is
 *  invisible until she opens the app.
 *
 *  Their own file, rather than exports from `vite.config.ts`, so that a test
 *  can check them against the committed `.env` values without importing that
 *  config: doing so drags in `vite` and `@vitejs/plugin-react`, which puts
 *  two copies of vite's types in one program (web pins v6, vitest hoists v7)
 *  and fails `tsc --noEmit` on a plugin-type mismatch that has nothing to do
 *  with either setting — and drags esbuild into a jsdom worker, where it
 *  refuses to load at all.
 */

/** Cognito's own shape, not a guess: 26 lowercase alphanumeric characters.
 *  Checking for *some* value isn't enough — it stops the blank
 *  `VITE_CLIENT_ID=` that actually took the app down, but not a typo, a
 *  truncated paste, or a placeholder typed in to make the build go green. */
export const CLIENT_ID_SHAPE = /^[a-z0-9]{26}$/;

/** An https origin: a multi-label host, no path, no trailing slash.
 *
 *  This used to demand `https://<prefix>.auth.<region>.amazoncognito.com`,
 *  the shape of a Cognito prefix domain — which stopped being true the day
 *  the pool got a custom domain of its own, and the guard then refused the
 *  only correct value there is. Pinning a hostname buys nothing anyway: the
 *  value that broke production was empty, and an origin check catches an
 *  empty or mistyped one just as well without going stale when the domain
 *  moves. */
export const LOGIN_DOMAIN_SHAPE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
