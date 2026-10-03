// What the player set on this device -- the settings and the calibrated control
// layout -- read back field by field: a field that is missing or not of its kind
// keeps its default. Until 2026-10-02 the stored settings were merged in whole,
// so a speed that was not a number made the run's clock NaN, and a stored
// camera rectangle was copied into the layout whatever its fields held.
import { isRecord } from '@sixam/kernel';

/** The sound, coach, haptics and metronome switches, and the game clock's rate. */
interface Settings { sound: boolean, coach: boolean, speed: number, haptics: boolean, metronome: boolean }

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ sound: true, coach: true, speed: 1, haptics: true, metronome: true });
const SWITCHES = ['sound', 'coach', 'haptics', 'metronome'] as const;

/** Settings from their stored JSON text (null when nothing is stored). */
export function parseSettings(text: string | null): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  let stored: unknown;
  try { stored = JSON.parse(text || '{}'); } catch { return settings; }
  if (!isRecord(stored)) return settings;
  for (const name of SWITCHES) {
    const value = stored[name];
    if (typeof value === 'boolean') settings[name] = value;
  }
  // A rate the clock can run at: positive and finite.
  if (typeof stored.speed === 'number' && Number.isFinite(stored.speed) && stored.speed > 0) settings.speed = stored.speed;
  return settings;
}

/** A control's rectangle, as fractions of its space. */
interface Rect { x: number, y: number, w: number, h: number }
const EDGES = ['x', 'y', 'w', 'h'] as const;

/**
 * Copy into each rectangle of `into` the numbers stored for it, where they are
 * finite numbers. `stored` is what the layout save wrote under `map` or
 * `widgets`; a rectangle it does not name, and any other field (a widget's
 * `space` is structural, never the player's), keeps the default.
 */
export function takeStoredRects(stored: unknown, into: Record<string, Rect>) {
  if (!isRecord(stored)) return;
  for (const key of Object.keys(into)) {
    const saved = stored[key];
    if (!isRecord(saved)) continue;
    for (const edge of EDGES) {
      const value = saved[edge];
      if (typeof value === 'number' && Number.isFinite(value)) into[key][edge] = value;
    }
  }
}
