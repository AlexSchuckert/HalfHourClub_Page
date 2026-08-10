/**
 * Shrink a photo, in the browser, to at most 3 MB of JPEG.
 *
 * Phone photos are 5-12 MB and 4000 px wide; nothing on this site displays
 * larger than about 1200 px. Doing the work here rather than after upload keeps
 * the content repo small and the upload quick on a holiday 3G connection.
 *
 * Strategy: scale the long edge down to MAX_EDGE, then walk the JPEG quality
 * ladder until the result fits. If even the lowest quality is too big (a very
 * large panorama, say), shrink the pixels by 20% and walk the ladder again.
 *
 * Re-encoding as JPEG also drops the EXIF block, which quietly removes the GPS
 * coordinates phones stamp into photos — worth having on a family archive.
 */

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB, as specified
const MAX_EDGE = 2560; // plenty for a 2x retina display at full width
const QUALITY_LADDER = [0.85, 0.75, 0.65, 0.55, 0.45];
const MIN_EDGE = 640; // never degrade past this trying to hit the target

/** HEIC/HEIF — what iPhones produce when "Keep Originals" is on. */
const HEIC_PATTERN = /\.(heic|heif)$/i;
const isHeic = (file) =>
  HEIC_PATTERN.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';

/**
 * Decode to an ImageBitmap.
 *
 * Safari can decode HEIC natively; Chrome and Firefox cannot, and throw. Only
 * in that case do we pull in the heic-to decoder — it's a large WASM payload, so
 * loading it eagerly would tax everyone for a case most uploads never hit.
 */
async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch (error) {
    if (!isHeic(file)) throw error;

    const { heicTo } = await import('/assets/vendor/heic-to.min.js');
    const converted = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
    return await createImageBitmap(converted);
  }
}

/** Draw at a given size and encode as JPEG. */
async function encode(bitmap, width, height, quality) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });

  const context = canvas.getContext('2d');
  // A white ground: JPEG has no alpha, and without this a transparent PNG's
  // background comes out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * @param {File} file
 * @param {(message: string) => void} [onProgress]
 * @returns {Promise<{blob: Blob, extension: string, width: number, height: number}>}
 */
export async function processImage(file, onProgress = () => {}) {
  onProgress('Reading photo…');
  const bitmap = await decode(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  let width = Math.round(bitmap.width * scale);
  let height = Math.round(bitmap.height * scale);

  while (true) {
    for (const quality of QUALITY_LADDER) {
      onProgress(`Shrinking photo (${width}×${height})…`);
      const blob = await encode(bitmap, width, height, quality);
      if (blob.size <= MAX_BYTES) {
        bitmap.close?.();
        return { blob, extension: 'jpg', width, height };
      }
    }

    // Even the lowest quality overshot: give up some pixels and try again.
    if (Math.max(width, height) <= MIN_EDGE) {
      const blob = await encode(bitmap, width, height, QUALITY_LADDER.at(-1));
      bitmap.close?.();
      return { blob, extension: 'jpg', width, height };
    }

    width = Math.max(1, Math.round(width * 0.8));
    height = Math.max(1, Math.round(height * 0.8));
  }
}
