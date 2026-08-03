#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';

import { costruisci } from './app.js';

const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist');

// Everything that could be got wrong lives in `app.ts` and `config.ts`, both
// of which a test can import. What is left here is the one thing a test
// cannot have: the entry point that actually runs.
costruisci(new App(), {
  // On the first deploy the frontend is not built yet: it ships afterwards.
  webDist: existsSync(join(webDist, 'index.html')) ? webDist : undefined,
});
