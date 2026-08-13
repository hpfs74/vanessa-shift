import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DayEntry, IsoDate } from '@vanessa/core';

import { esportaMese } from '../src/esportaTurni.js';

// jsdom's Blob has no `.text()` in this jsdom version, so the assertions
// below that read back what we handed the browser have nothing to call.
// Polyfilled here, scoped to this file, via the FileReader jsdom does
// implement. Checked through an unknown-typed view of the prototype: `lib.dom`
// already declares `text` as always present, so a plain `in` check would
// narrow the missing branch to `never` under TypeScript.
const protoBlob = Blob.prototype as unknown as { text?: () => Promise<string> };
if (typeof protoBlob.text !== 'function') {
  protoBlob.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

const ORA = new Date('2026-08-13T10:15:00.000Z');

const mese = (giorni: Record<string, DayEntry>): ReadonlyMap<IsoDate, DayEntry> =>
  new Map(Object.entries(giorni) as [IsoDate, DayEntry][]);

/** jsdom has no object URLs and does not navigate, so the two browser calls
 *  are stubbed and inspected. What is being tested is what we hand the
 *  browser, which is the only part we control. */
function browserFinto() {
  const creati: Blob[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (b: Blob) => {
      creati.push(b);
      return 'blob:finto';
    },
    revokeObjectURL: () => {},
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { creati, click };
}

describe('esportaMese', () => {
  beforeEach(() => localStorage.clear());
  afterEach(async () => {
    // esportaMese defers URL.revokeObjectURL to the next tick; flush that
    // tick before restoring the stub, or it fires against the real
    // (unstubbed) URL, which jsdom does not implement.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands the browser a calendar file named for the month', async () => {
    const { creati, click } = browserFinto();
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);

    expect(click).toHaveBeenCalledOnce();
    expect(creati).toHaveLength(1);
    expect(creati[0]!.type).toContain('text/calendar');
    expect(await creati[0]!.text()).toContain('UID:turno-2026-08-13@');
  });

  it('names the file after the month, so two months do not collide', () => {
    browserFinto();
    const a = document.createElement('a');
    const creaElemento = vi.spyOn(document, 'createElement').mockReturnValue(a);
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);
    creaElemento.mockRestore();
    expect(a.download).toBe('turni-2026-08.ics');
  });

  it('starts the sequence at zero and raises it on every export', async () => {
    // The one monotonic number available without a server, and what a client
    // uses to tell a newer version of an event from a new event.
    const { creati } = browserFinto();
    const giorni = mese({ '2026-08-13': { code: 'M' } });

    esportaMese(2026, 8, giorni, ORA);
    esportaMese(2026, 8, giorni, ORA);

    expect(await creati[0]!.text()).toContain('SEQUENCE:0');
    expect(await creati[1]!.text()).toContain('SEQUENCE:1');
  });

  it('counts each month separately', async () => {
    const { creati } = browserFinto();
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);
    esportaMese(2026, 9, mese({ '2026-09-10': { code: 'M' } }), ORA);
    expect(await creati[1]!.text()).toContain('SEQUENCE:0');
  });

  it('survives a counter that something else scribbled on', async () => {
    // localStorage is a string store: whatever is in there might not be a
    // number, and starting over at zero beats crashing the export.
    localStorage.setItem('ics:2026-08', 'non-un-numero');
    const { creati } = browserFinto();
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);
    expect(await creati[0]!.text()).toContain('SEQUENCE:0');
  });
});
