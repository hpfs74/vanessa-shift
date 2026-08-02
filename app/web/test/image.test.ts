import { describe, expect, it } from 'vitest';

import { MAX_EDGE, scaleFor } from '../src/image.js';

describe('scaleFor', () => {
  it('never enlarges a photo that is already small', () => {
    expect(scaleFor(800, 600)).toBe(1);
  });

  it('brings the long edge to the max, whether horizontal or vertical', () => {
    expect(scaleFor(4032, 3024) * 4032).toBeCloseTo(MAX_EDGE);
    expect(scaleFor(3024, 4032) * 4032).toBeCloseTo(MAX_EDGE);
  });

  it('is exactly the max when the photo is already that size', () => {
    expect(scaleFor(MAX_EDGE, 1000)).toBe(1);
  });
});
