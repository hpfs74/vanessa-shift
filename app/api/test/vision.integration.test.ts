/** Le due foto vere contro Bedrock vero.
 *
 * Fuori dalla CI di proposito: costa, servono credenziali AWS, e le foto non
 * stanno nel repository — riportano nome e cognome di quattordici colleghe.
 * Serve a verificare una modifica al prompt con un comando invece che a occhio.
 *
 *   PROVA_BEDROCK=1 \
 *   FOTO_LUGLIO=~/vanessa-foto/luglio.jpeg \
 *   FOTO_AGOSTO=~/vanessa-foto/agosto.jpeg \
 *   npx vitest run --root api api/test/vision.integration.test.ts
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { validateReading, entriesFromReading } from '@vanessa/core';

import { createVision } from '../src/vision.js';

const enabled =
  process.env.PROVA_BEDROCK === '1' && !!process.env.FOTO_LUGLIO && !!process.env.FOTO_AGOSTO;

const JULY = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'];
const AUGUST = [
  'L','M','M','M','P','L','M','L','M','P1','L','M','P','M','P','M1',
  'L','M','P','L','M','P','M','P','L','M','P','M','P','L','M',
];

function base64(percorso: string): string {
  return readFileSync(percorso).toString('base64');
}

describe.runIf(enabled)('reading the real photos', () => {
  const vision = createVision();

  it('august: the whole month', { timeout: 180_000 }, async () => {
    const e = validateReading(await vision(base64(process.env.FOTO_AGOSTO!)), 2026);
    expect(e.month).toBe(8);
    expect(e.year).toBe(2026);
    expect(entriesFromReading(e).map((v) => v.code)).toEqual(AUGUST);
  });

  it('july: the x cells up to the 16th, then fifteen shifts', { timeout: 180_000 }, async () => {
    const e = validateReading(await vision(base64(process.env.FOTO_LUGLIO!)), 2026);
    expect(e.month).toBe(7);
    const entries = entriesFromReading(e);
    expect(entries[0].day).toBe(17);
    expect(entries.map((v) => v.code)).toEqual(JULY);
  });
});
