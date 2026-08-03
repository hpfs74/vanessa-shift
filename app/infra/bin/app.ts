/** The three stacks, and the wires between them.
 *
 * Separate from `main.ts` so a test can build the same graph the deploy
 * builds. Whatever lives in the entry point instead of here is deployed and
 * never asserted, by construction — which is how `loginCertificateArn` came
 * to be a wire nothing checked: both certificate ARNs exist, both are
 * us-east-1 strings, and swapping one for the other synthesizes cleanly and
 * fails minutes into a deploy, on `AWS::Cognito::UserPoolDomain`.
 */

import type { App } from 'aws-cdk-lib';

import { AppStack } from '../lib/app-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { CertificateStack } from '../lib/certificate-stack.js';
import { CONFIG } from './config.js';

export interface OpzioniCostruzione {
  /** The built frontend, when there is one: on the first deploy there is not,
   *  and the site ships on the next push. */
  readonly webDist?: string;
}

export function costruisci(app: App, opzioni: OpzioniCostruzione = {}) {
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
    // The certificate issued for `loginDomain`, not the one serving the app:
    // the pool domain is `auth.…` and a certificate for the apex does not
    // cover it.
    loginCertificateArn: cert.loginCertificateArn,
    zoneDomain: CONFIG.zoneDomain,
    zoneId: CONFIG.zoneId,
  });

  const sito = new AppStack(app, 'VanessaApp', {
    env: { account: CONFIG.account, region: CONFIG.region },
    domain: CONFIG.domain,
    zoneDomain: CONFIG.zoneDomain,
    zoneId: CONFIG.zoneId,
    certificateArn: cert.certificateArn,
    userPoolId: auth.userPoolId,
    userPoolClientId: auth.userPoolClientId,
    webDist: opzioni.webDist,
  });

  return { cert, auth, sito };
}
