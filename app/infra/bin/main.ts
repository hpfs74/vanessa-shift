#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';

import { AppStack } from '../lib/app-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { CertificateStack } from '../lib/certificate-stack.js';

const DOMAIN = 'vanessa.matteo.cool';

export const CONFIG = {
  account: '495133941005',
  region: 'eu-south-1',
  domain: DOMAIN,
  zoneDomain: 'matteo.cool',
  zoneId: 'Z2T8X72UH7FONU',
  // Managed login, on a hostname of ours. This is also the passkey's relying
  // party id — Cognito requires the two to be the same string once the pool
  // has a custom domain — so it is the name every credential gets bound to,
  // and moving it later means re-enrolling every device. Written under
  // `DOMAIN` because it must be a name we control: Cognito's own
  // `*.amazoncognito.com` would satisfy Cognito and bind the passkeys to
  // someone else's domain.
  loginDomain: `auth.${DOMAIN}`,
} as const;

const app = new App();

// The certificates must live in us-east-1: neither CloudFront nor a Cognito
// custom domain accepts one from anywhere else.
// Stack names stay as they are: renaming one would create a second stack
// and leave the first behind.
const cert = new CertificateStack(app, 'VanessaCertificato', {
  env: { account: CONFIG.account, region: 'us-east-1' },
  domain: CONFIG.domain,
  loginDomain: CONFIG.loginDomain,
  zoneDomain: CONFIG.zoneDomain,
  zoneId: CONFIG.zoneId,
});

const auth = new AuthStack(app, 'VanessaAccesso', {
  env: { account: CONFIG.account, region: CONFIG.region },
  domain: CONFIG.domain,
  loginDomain: CONFIG.loginDomain,
  loginCertificateArn: cert.loginCertificateArn,
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
  userPoolId: auth.userPoolId,
  userPoolClientId: auth.userPoolClientId,
  // On the first deploy the frontend is not built yet: it ships afterwards.
  webDist: existsSync(join(webDist, 'index.html')) ? webDist : undefined,
});
