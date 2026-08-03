/** The values `bin/config.ts` holds, and the wiring `bin/app.ts` does with
 *  them, checked against the graph the deploy actually builds.
 *
 *  The other files here build a stack and assert on the template, which
 *  proves the stack class right and says nothing about what is handed to it.
 *  They import the same `CONFIG` this file does, so a wrong value in it moves
 *  every stack-side copy at once and they go on agreeing with each other. The
 *  two mistakes below both synthesize cleanly, leave the whole suite green,
 *  and fail only on a real deploy — or, worse, after one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { costruisci } from '../bin/app.js';
import { CONFIG } from '../bin/config.js';

/** The login host the built frontend will send her to. Read from the file
 *  that gets compiled into the bundle, not from a literal here: a literal
 *  would be a fourth copy of the same name, with the same problem. */
function hostAccessoDelFrontend(): string {
  const path = join(import.meta.dirname, '..', '..', 'web', '.env.production');
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^VITE_LOGIN_DOMAIN=(.+)$/.exec(line.trim());
    if (m) return new URL(m[1]).host;
  }
  throw new Error('VITE_LOGIN_DOMAIN non e nel .env.production del frontend');
}

let auth: Template;
let cert: Template;

beforeAll(() => {
  // The real graph, from the real constants — the same call `bin/main.ts`
  // makes. Nothing here is re-declared.
  const { auth: a, cert: c } = costruisci(new App());
  auth = Template.fromStack(a);
  cert = Template.fromStack(c);
});

describe('CONFIG.loginDomain', () => {
  it('is the one name the pool, its login page and the frontend all agree on', () => {
    // The same hostname is written three times: `passkeyRelyingPartyId` on the
    // pool, the pool's custom domain, and `VITE_LOGIN_DOMAIN` in the bundle.
    // The first two come from `CONFIG.loginDomain`; the third is committed by
    // hand. Change `CONFIG.loginDomain` alone and both stack-side copies move
    // together and go on matching each other, so `auth-stack.test.ts` — which
    // imports the same constant — stays green, and so does
    // `web/test/config.test.ts`, which asserts a literal and never looks at
    // the stack. Meanwhile the deployed bundle sends her to a hostname the
    // pool no longer serves, which resolves to nothing.
    const frontend = hostAccessoDelFrontend();

    const [pool] = Object.values(auth.findResources('AWS::Cognito::UserPool'));
    const [dominio] = Object.values(auth.findResources('AWS::Cognito::UserPoolDomain'));

    expect(dominio.Properties.Domain).toBe(frontend);
    expect(pool.Properties.WebAuthnRelyingPartyID).toBe(frontend);
    // And that it is a name we control, which is why the pool has a custom
    // domain instead of Cognito's free one.
    expect(frontend.endsWith(`.${CONFIG.domain}`)).toBe(true);
  });
});

describe('the wiring in bin/app.ts', () => {
  it('gives the pool domain the certificate issued for the login host, not the app one', () => {
    // Two ARNs are in scope at that line, both us-east-1, both valid strings.
    // Passing `cert.certificateArn` instead of `cert.loginCertificateArn`
    // synthesizes without a murmur and fails minutes into `cdk deploy --all`,
    // on `AWS::Cognito::UserPoolDomain`, with a certificate that does not
    // cover `auth.…`.
    //
    // Cross-region, so the ARN reaches this stack as an SSM read whose
    // parameter name carries the producing construct's logical id. Both
    // logical ids are looked up from the certificate stack rather than typed
    // out, since they end in a hash CDK computes.
    const certificati = cert.findResources('AWS::CertificateManager::Certificate');
    const idPerDominio = (dominio: string): string => {
      const trovato = Object.entries(certificati).find(
        ([, r]) => r.Properties.DomainName === dominio,
      );
      if (!trovato) throw new Error(`nessun certificato per ${dominio}`);
      return trovato[0];
    };
    const idAccesso = idPerDominio(CONFIG.loginDomain);
    // Not an assertion about the stack: it keeps the one below from being
    // vacuous. If the two lookups ever returned the same construct, matching
    // on the login one would prove nothing.
    expect(idAccesso).not.toBe(idPerDominio(CONFIG.domain));

    const [dominio] = Object.values(auth.findResources('AWS::Cognito::UserPoolDomain'));
    const [, parametro] = dominio.Properties.CustomDomainConfig.CertificateArn['Fn::GetAtt'] as [
      string,
      string,
    ];

    expect(parametro).toContain(`Ref${idAccesso}`);
  });
});
