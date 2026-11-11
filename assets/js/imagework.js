// Page-side access to the picture work: a module worker when the browser can draw with OffscreenCanvas,
// the page's own thread otherwise (or when the worker fails). One decoded source is kept per slot.
import { bake } from './image.js';

const files = new Map();
const locals = new Map();
const pending = new Map();
let worker = null;
let broken = typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined';
let jobs = 0;

function failAll(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.type === 'error') job.reject(new Error(data.message)); else job.resolve(data);
  };
  worker.onerror = () => { broken = true; worker = null; failAll(new Error('worker')); };
  return worker;
}

function ask(message) {
  return new Promise((resolve, reject) => {
    jobs += 1;
    pending.set(jobs, { resolve, reject });
    try {
      startWorker().postMessage({ ...message, id: jobs });
    } catch {
      broken = true;
      pending.delete(jobs);
      reject(new Error('worker'));
    }
  });
}

async function localBitmap(slot) {
  if (!locals.has(slot)) locals.set(slot, await createImageBitmap(files.get(slot)));
  return locals.get(slot);
}

/** Decodes the picture. Resolves `{ width, height }`; rejects when the browser cannot read the file. */
export async function loadSource(slot, file) {
  files.set(slot, file);
  locals.get(slot)?.close?.();
  locals.delete(slot);
  if (!broken) {
    try {
      const { width, height } = await ask({ type: 'load', slot, file });
      return { width, height };
    } catch (error) {
      if (error.message !== 'worker') throw error;
    }
  }
  const bitmap = await localBitmap(slot);
  return { width: bitmap.width, height: bitmap.height };
}

/** Bakes the slot's picture with the settings. Resolves `{ blob, mime, width, height }`. */
export async function bakeSource(slot, params) {
  if (!broken) {
    try {
      return await ask({ type: 'bake', slot, params });
    } catch (error) {
      if (error.message !== 'worker') throw error;
    }
  }
  return bake(await localBitmap(slot), params);
}

export function dropSource(slot) {
  files.delete(slot);
  locals.get(slot)?.close?.();
  locals.delete(slot);
  if (worker) worker.postMessage({ type: 'drop', slot });
}
