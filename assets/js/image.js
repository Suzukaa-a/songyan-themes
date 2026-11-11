// Turns a picture into the background image of an appearance file: crop to the keyboard's shape, blur, dim,
// brighten, shrink, encode. Browser APIs only (canvas / OffscreenCanvas, createImageBitmap). The geometry
// and the encoding ladder are plain functions so Node tests can check them; the drawing runs in a worker
// when the browser has OffscreenCanvas, otherwise on the page.

/** The area the background covers on Android, in dp: 411 wide, a 40 bar, 4 + 4 x 60 + 4 for the keys, 48 navigation bar. */
export const KEYBOARD_AREA = Object.freeze({ width: 411, height: 336 });
export const MAX_SIDE = 1600;
/** An image is kept under this so the same picture can sit in both modes inside the 2 MiB file limit. */
export const TARGET_BYTES = 700 * 1024;
export const QUALITIES = Object.freeze([0.85, 0.75, 0.65, 0.55, 0.45, 0.35]);
export const BLUR_MAX = 20;
export const DIM_MAX = 0.6;
export const BRIGHT_MAX = 0.6;
export const DEFAULT_PARAMS = Object.freeze({ position: 0.5, blur: 0, dim: 0, bright: 0 });

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/** Output size: the keyboard's shape, longest side at most MAX_SIDE, never larger than the source can fill. */
export function outputSize(sourceWidth, sourceHeight, scale = 1) {
  const aspect = KEYBOARD_AREA.width / KEYBOARD_AREA.height;
  const width = Math.max(8, Math.floor(Math.min(MAX_SIDE, sourceWidth, sourceHeight * aspect) * scale));
  return { width, height: Math.max(8, Math.round(width / aspect)) };
}

/**
 * Where the source lands on the output so it covers it: uniform scale, the free axis placed by `position`
 * (0 = top / left, 1 = bottom / right). `grow` enlarges the picture around the visible part so a blur has
 * pixels to pull from at the edges. Returns the destination rectangle for drawImage.
 */
export function coverPlacement(sourceWidth, sourceHeight, outWidth, outHeight, position, grow = 0) {
  const cover = Math.max(outWidth / sourceWidth, outHeight / sourceHeight);
  const scale = cover * (1 + grow);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const pos = clamp(position, 0, 1);
  // Position the un-grown cover rectangle, then centre the grown picture on the same point.
  const baseX = -(sourceWidth * cover - outWidth) * pos;
  const baseY = -(sourceHeight * cover - outHeight) * pos;
  const x = baseX + (sourceWidth * cover - width) / 2;
  const y = baseY + (sourceHeight * cover - height) / 2;
  return {
    x: clamp(x, outWidth - width, 0),
    y: clamp(y, outHeight - height, 0),
    width,
    height,
  };
}

/** Which way the picture can be dragged inside the keyboard-shaped frame: 'y', 'x' or null when it fits exactly. */
export function slackAxis(sourceWidth, sourceHeight) {
  const frame = KEYBOARD_AREA.width / KEYBOARD_AREA.height;
  const aspect = sourceWidth / sourceHeight;
  if (Math.abs(aspect - frame) < 0.002) return null;
  return aspect < frame ? 'y' : 'x';
}

/** The `align` for the file: the editor bakes the crop in, so the picture always matches and is centred. */
export const BAKED_ALIGN = 'center';

// ---------------------------------------------------------------------------------------------
// Drawing (needs a canvas)

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const canvasBlob = (canvas, type, quality) => (typeof canvas.convertToBlob === 'function'
  ? canvas.convertToBlob({ type, quality })
  : new Promise((resolve) => canvas.toBlob(resolve, type, quality)));

/** Draws the cropped, blurred and tinted picture onto a canvas of the given size. */
export function drawBaked(bitmap, params, width, height) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Blur is in dp of the keyboard, so it looks the same at any export size.
  const blurPx = (clamp(params.blur, 0, BLUR_MAX) * width) / KEYBOARD_AREA.width;
  const grow = blurPx > 0 ? (2.5 * blurPx) / width : 0;
  const rect = coverPlacement(bitmap.width, bitmap.height, width, height, params.position, grow);
  if (blurPx > 0 && typeof ctx.filter === 'string') {
    ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    ctx.filter = 'none';
  } else if (blurPx > 0) {
    // No canvas filters (older Safari): shrink and stretch back, which smooths the same way.
    const factor = Math.max(1, Math.round(blurPx));
    const small = makeCanvas(Math.max(2, Math.round(width / factor)), Math.max(2, Math.round(height / factor)));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(bitmap, rect.x / factor, rect.y / factor, rect.width / factor, rect.height / factor);
    ctx.drawImage(small, 0, 0, width, height);
  } else {
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
  }
  if (params.dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${clamp(params.dim, 0, DIM_MAX)})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (params.bright > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${clamp(params.bright, 0, BRIGHT_MAX)})`;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

/**
 * Bakes a picture into `{ blob, mime, width, height, quality }`: WebP when the browser can encode it (it
 * reports the type it really produced), otherwise JPEG; the quality steps down, then the size, until the
 * result is at most `limit` bytes.
 */
export async function bake(bitmap, params, limit = TARGET_BYTES) {
  let scale = 1;
  let last = null;
  for (let shrink = 0; shrink < 6; shrink += 1) {
    const { width, height } = outputSize(bitmap.width, bitmap.height, scale);
    const canvas = drawBaked(bitmap, { ...DEFAULT_PARAMS, ...params }, width, height);
    for (const type of ['image/webp', 'image/jpeg']) {
      for (const quality of QUALITIES) {
        const blob = await canvasBlob(canvas, type, quality);
        // A browser that cannot encode the type hands back a PNG; try the next type instead.
        if (!blob || blob.type !== type) break;
        last = { blob, mime: type, width, height, quality };
        if (blob.size <= limit) return last;
      }
      if (last && last.mime === type) break; // this type encodes; only a smaller size can help
    }
    scale *= 0.8;
  }
  if (!last) throw new Error('encode');
  return last;
}
