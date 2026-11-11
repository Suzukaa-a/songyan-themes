// Runs the picture work off the page's main thread. Keeps each decoded source until it is replaced.
import { bake } from './image.js';

const sources = new Map();

self.onmessage = async ({ data }) => {
  const { id, type, slot } = data;
  try {
    if (type === 'load') {
      sources.get(slot)?.close?.();
      const bitmap = await createImageBitmap(data.file);
      sources.set(slot, bitmap);
      self.postMessage({ id, type: 'loaded', width: bitmap.width, height: bitmap.height });
    } else if (type === 'bake') {
      const bitmap = sources.get(slot);
      if (!bitmap) throw new Error('no source');
      self.postMessage({ id, type: 'baked', ...(await bake(bitmap, data.params)) });
    } else if (type === 'drop') {
      sources.get(slot)?.close?.();
      sources.delete(slot);
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String(error?.message ?? error) });
  }
};
