// Optional user-supplied audio.
//
// The trainer ships with synthesised cues only. If you own FNaF 2 you can load
// sounds from your own copy into these slots: they are stored in IndexedDB on
// this device, are never bundled into the page, and are never uploaded
// anywhere. Clearing them restores the synthesised defaults.
export const SLOTS = [
  { id: 'laugh',    label: 'Balloon Boy laugh',   why: 'The cue that starts the clock on an attack.' },
  { id: 'ventBang', label: 'Vent bang',           why: 'The single most important sound in the strategy.' },
  { id: 'ambience', label: 'Hall ambience',       why: 'Tells you whether Foxy is actually there.' },
  { id: 'boxTick',  label: 'Music box tick',      why: 'Your 0.5s metronome.' },
  { id: 'gf',       label: 'Golden Freddy',       why: 'Office appearance cue.' },
];

const DB = 'm7-assets', STORE = 'sounds';

function open() {
  return new Promise<any>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise<any>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export async function putSlot(id, file) {
  const buf = await file.arrayBuffer();
  await tx('readwrite', (s) => s.put({ buf, name: file.name, type: file.type }, id));
}
export async function getSlot(id) { return tx('readonly', (s) => s.get(id)); }
export async function clearSlot(id) { return tx('readwrite', (s) => s.delete(id)); }
export async function clearAll() { return tx('readwrite', (s) => s.clear()); }

export async function listSlots() {
  const out = {};
  for (const s of SLOTS) {
    try { const v = await getSlot(s.id); if (v) out[s.id] = v.name; } catch { /* ignore */ }
  }
  return out;
}

// Decode whatever is stored into AudioBuffers the Audio class can play.
export async function loadInto(audio) {
  if (!audio.ctx) return {};
  const loaded = {};
  for (const s of SLOTS) {
    try {
      const rec = await getSlot(s.id);
      if (!rec) continue;
      const buf = await audio.ctx.decodeAudioData(rec.buf.slice(0));
      audio.samples[s.id] = buf;
      loaded[s.id] = rec.name;
    } catch { /* a bad file just falls back to synthesis */ }
  }
  return loaded;
}
