#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';

import { StackApp } from '../lib/stack-app.js';
import { StackCertificato } from '../lib/stack-web.js';

export const CONFIG = {
  account: '495133941005',
  regione: 'eu-south-1',
  dominio: 'vanessa.matteo.cool',
  zonaDominio: 'matteo.cool',
  zonaId: 'Z2T8X72UH7FONU',
} as const;

const app = new App();

// Il certificato deve stare in us-east-1: CloudFront non ne accetta altri.
const cert = new StackCertificato(app, 'VanessaCertificato', {
  env: { account: CONFIG.account, region: 'us-east-1' },
  dominio: CONFIG.dominio,
  zonaDominio: CONFIG.zonaDominio,
  zonaId: CONFIG.zonaId,
});

const web = join(import.meta.dirname, '..', '..', 'web', 'dist');

new StackApp(app, 'VanessaApp', {
  env: { account: CONFIG.account, region: CONFIG.regione },
  dominio: CONFIG.dominio,
  zonaDominio: CONFIG.zonaDominio,
  zonaId: CONFIG.zonaId,
  certificatoArn: cert.certificatoArn,
  // Al primo deploy il frontend non e' ancora compilato: si distribuisce dopo.
  cartellaWeb: existsSync(join(web, 'index.html')) ? web : undefined,
});
