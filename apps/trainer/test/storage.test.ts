// What the trainer reads back from this device's storage is checked before it
// is used. Until 2026-10-02 lesson progress and the settings were whatever
// JSON.parse returned: a stored `null` made markPassed throw at the moment a
// lesson was passed, and a stored speed that was not a number made every
// frame's clock NaN. A save that failed was dropped without a word.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadProgress, markPassed, parseProgress, saveProgress } from '../src/curriculum.ts';
import { DEFAULT_SETTINGS, parseSettings, takeStoredRects } from '../src/settings.ts';

/** This device's localStorage, in memory; `full` makes every write throw as a full or blocked store does. */
class MemoryStorage implements Storage {
  items = new Map<string, string>();
  full = false;
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) {
    if (this.full) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
}
const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
afterEach(() => { storage.clear(); storage.full = false; });

test('progress keeps only well-formed lesson entries', () => {
  assert.deepEqual(parseProgress(null), {});
  assert.deepEqual(parseProgress('null'), {});
  assert.deepEqual(parseProgress('[1, 2]'), {});
  assert.deepEqual(parseProgress('{not json'), {});
  assert.deepEqual(parseProgress(JSON.stringify({
    beat: { passed: true, best: 3 }, sweep: null, wind: { passed: 'yes', best: 1 }, office: { passed: false, best: 'x' },
  })), { beat: { passed: true, best: 3 } });
});

test('passing a lesson over stored null progress records the pass', () => {
  storage.setItem('m7.progress', 'null');
  const progress = markPassed('beat', 4);
  assert.deepEqual(progress.beat, { passed: true, best: 4 });
  assert.deepEqual(loadProgress().beat, { passed: true, best: 4 }, 'and it is saved');
});

test('a progress save that fails says so', () => {
  storage.full = true;
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  try {
    assert.equal(saveProgress({ beat: { passed: true, best: 1 } }), false);
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 1, 'one warning names the lost save');
  assert.match(String(warnings[0]), /progress/);
});

test('settings keep the defaults wherever the stored value is not one', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('{not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('"loud"'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(JSON.stringify({ sound: false, coach: 'no', speed: 'fast', haptics: 0, metronome: false })),
    { ...DEFAULT_SETTINGS, sound: false, metronome: false });
  for (const speed of [0, -1, Number.MAX_VALUE * 10, null])
    assert.equal(parseSettings(JSON.stringify({ speed })).speed, 1, `speed ${String(speed)} is not a rate`);
  assert.equal(parseSettings(JSON.stringify({ speed: 0.5 })).speed, 0.5);
});

test('a stored layout gives each rectangle only its finite numbers', () => {
  const into = { 1: { x: 0, y: 0, w: 0.1, h: 0.1 }, 2: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } };
  takeStoredRects({ 1: { x: 0.5, y: '0.3', w: null, h: Number.NaN, space: 'feed' }, 2: 'wide', 13: { x: 1, y: 1, w: 1, h: 1 } }, into);
  assert.deepEqual(into, { 1: { x: 0.5, y: 0, w: 0.1, h: 0.1 }, 2: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
    'a string, a null, a NaN and an extra field are not taken, and no camera is added');
  const widget = { wind: { space: 'feed', x: 0, y: 0, w: 0.2, h: 0.2 } };
  takeStoredRects({ wind: { space: 'stage', x: 0.4 } }, widget);
  assert.deepEqual(widget, { wind: { space: 'feed', x: 0.4, y: 0, w: 0.2, h: 0.2 } }, 'a widget keeps its space');
  for (const stored of [null, [], 'map']) {
    const untouched = { 1: { x: 0, y: 0, w: 0.1, h: 0.1 } };
    takeStoredRects(stored, untouched);
    assert.deepEqual(untouched, { 1: { x: 0, y: 0, w: 0.1, h: 0.1 } });
  }
});
