#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';

import { AppStack } from '../lib/app-stack.js';
import { CertificateStack } from '../lib/certificate-stack.js';

export const CONFIG = {
  account: '495133941005',
  region: 'eu-south-1',
  domain: 'vanessa.matteo.cool',
  zoneDomain: 'matteo.cool',
  zoneId: 'Z2T8X72UH7FONU',
} as const;

const app = new App();

// The certificate must live in us-east-1: CloudFront accepts no others.
// Stack names stay as they are: renaming one would create a second stack
// and leave the first behind.
const cert = new CertificateStack(app, 'VanessaCertificato', {
  env: { account: CONFIG.account, region: 'us-east-1' },
  domain: CONFIG.domain,
  zoneDomain: CONFIG.zoneDomain,
  zoneId: CONFIG.zoneId,
});

const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist');

new AppStack(app, 'VanessaApp', {
  env: { account: CONFIG.account, region: CONFIG.region },
  domain: CONFIG.domain,
  zoneDomain: CONFIG.zoneDomain,
  zoneId: CONFIG.zoneId,
  certificateArn: cert.certificateArn,
  // On the first deploy the frontend is not built yet: it ships afterwards.
  webDist: existsSync(join(webDist, 'index.html')) ? webDist : undefined,
});
