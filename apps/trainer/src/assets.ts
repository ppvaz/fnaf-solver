// Optional user-supplied audio.
//
// The trainer ships with synthesised cues only. If you own FNaF 2 you can load
// sounds from your own copy into these slots: they are stored in IndexedDB on
// this device, are never bundled into the page, and are never uploaded
// anywhere. Clearing them restores the synthesised defaults.
import type { Audio } from './audio.ts';

export const SLOTS = [
  { id: 'laugh',    label: 'Balloon Boy laugh',   why: 'The cue that starts the clock on an attack.' },
  { id: 'ventBang', label: 'Vent bang',           why: 'The single most important sound in the strategy.' },
  { id: 'ambience', label: 'Hall ambience',       why: 'Tells you whether Foxy is actually there.' },
  { id: 'boxTick',  label: 'Music box tick',      why: 'Your 0.5s metronome.' },
  { id: 'gf',       label: 'Golden Freddy',       why: 'Office appearance cue.' },
];

const DB = 'm7-assets', STORE = 'sounds';

/** A sound as putSlot stores it. */
interface StoredSound { readonly buf: ArrayBuffer, readonly name: string, readonly type: string }

function open() {
  return new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// Resolves with the request's result, or with the request itself where the result is empty: a
// missing key, a delete, a clear.
async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T | IDBRequest<T>>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export async function putSlot(id: string, file: File) {
  const buf = await file.arrayBuffer();
  await tx('readwrite', (s) => s.put({ buf, name: file.name, type: file.type }, id));
}
// What putSlot stored under the id, if anything.
export async function getSlot(id: string) { return tx('readonly', (s) => s.get(id) as IDBRequest<StoredSound | undefined>); }
export async function clearSlot(id: string) { return tx('readwrite', (s) => s.delete(id)); }
export async function clearAll() { return tx('readwrite', (s) => s.clear()); }

export async function listSlots() {
  const out: Record<string, string | undefined> = {};
  for (const s of SLOTS) {
    // An empty slot resolves with its request, which has no name.
    try { const v = await getSlot(s.id); if (v) out[s.id] = 'name' in v ? v.name : undefined; } catch { /* ignore */ }
  }
  return out;
}

// Decode whatever is stored into AudioBuffers the Audio class can play.
export async function loadInto(audio: Audio) {
  if (!audio.ctx) return {};
  const loaded: Record<string, string> = {};
  for (const s of SLOTS) {
    try {
      const rec = await getSlot(s.id);
      // An empty slot resolves with its request, which holds no sound; reading one threw here, caught below.
      if (!rec || !('buf' in rec)) continue;
      const buf = await audio.ctx.decodeAudioData(rec.buf.slice(0));
      audio.samples[s.id] = buf;
      loaded[s.id] = rec.name;
    } catch { /* a bad file just falls back to synthesis */ }
  }
  return loaded;
}
