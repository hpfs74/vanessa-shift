/** Resizing the photo, before sending it.
 *
 * 2576 px on the long edge is the max the model uses anyway: sending a twelve
 * megapixel photo doesn't add a single detail read, it only adds bytes to
 * upload over the phone's network.
 *
 * The scale calculation is kept separate from the canvas drawing because it's
 * the only part that can be tested without a real browser: jsdom has neither
 * canvas nor createImageBitmap.
 */

export const MAX_EDGE = 2576;

export function scaleFor(larghezza: number, altezza: number): number {
  return Math.min(1, MAX_EDGE / Math.max(larghezza, altezza));
}

/** The photo as base64, without the data: prefix. */
export async function resize(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = scaleFor(bitmap.width, bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Non riesco a preparare la foto su questo telefono.');
    ctx.drawImage(bitmap, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  } finally {
    bitmap.close();
  }
}
