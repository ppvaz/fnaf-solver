/**
 * The Fusion engine's own vocabulary that the truth reader needs: object type
 * numbers, and the handful of condition, action and expression numbers that
 * decide whether an event reads or writes an alterable value, a flag, a counter
 * or an object's existence. These are properties of the Clickteam runtime
 * (build 296 for all four games, Plan 26), not of any game, and the names are
 * this reader's own descriptive words, not a copy of any tool's table.
 *
 * Everything else a dump holds is numbered, not named: an ACE this table does
 * not know comes back with `name: null` and its object type and number intact.
 */

/** Fusion object types by number; 32 and above are extensions. */
export const OBJECT_TYPES: Readonly<Record<number, string>> = Object.freeze({
  '-7': 'player', '-6': 'keyboard-mouse', '-5': 'create', '-4': 'timer', '-3': 'storyboard', '-2': 'sound', '-1': 'system',
  0: 'quick-backdrop', 1: 'backdrop', 2: 'active', 3: 'text', 4: 'question', 5: 'score', 6: 'lives', 7: 'counter',
  8: 'rich-text', 9: 'sub-application',
});
export const EXTENSION_TYPE = 32;
export const COUNTER_TYPE = 7;
export const CREATE_TYPE = -5;
export const SYSTEM_TYPE = -1;
/** Object types at or above this carry the common properties: alterable values, flags, destroy. */
export const COMMON_TYPE = 2;
/** An event handle with this bit set names a qualifier (a group of objects), not one object. */
export const QUALIFIER_BIT = 0x8000;

export const typeName = (type: number | null) =>
  type === null ? null : OBJECT_TYPES[type] ?? (type >= EXTENSION_TYPE ? 'extension' : null);

/** Conditions and actions shared by every object with common properties (ot >= 2, extensions included). */
/** An engine table by number: a number it does not list names nothing. */
type ByNumber = Readonly<Record<number, string>>;

const COMMON_CONDITIONS: ByNumber = Object.freeze({ '-24': 'flag-off', '-25': 'flag-on', '-27': 'compare-alterable-value',
  '-42': 'compare-alterable-value', '-43': 'compare-alterable-value' });
const COMMON_ACTIONS: ByNumber = Object.freeze({ 24: 'destroy', 26: 'hide', 27: 'show', 31: 'set-alterable-value',
  32: 'add-to-alterable-value', 33: 'subtract-from-alterable-value', 35: 'flag-on', 36: 'flag-off', 37: 'toggle-flag' });
const COUNTER_CONDITIONS: ByNumber = Object.freeze({ '-81': 'compare-counter' });
const COUNTER_ACTIONS: ByNumber = Object.freeze({ 80: 'set-counter', 81: 'add-to-counter', 82: 'subtract-from-counter' });
const CREATE_ACTIONS: ByNumber = Object.freeze({ 0: 'create-object', 1: 'create-object-by-name' });

export const FLAG_CONDITIONS = Object.freeze([-24, -25]);
export const FLAG_ACTIONS = Object.freeze([35, 36, 37]);
export const DESTROY_ACTION = 24;
export const CREATE_ACTION = 0;
export const CREATE_BY_NAME_ACTION = 1;
export const COUNTER_WRITES = Object.freeze([80, 81, 82]);

/** Expression items: the common alterable-value and flag reads, the counter's value and the global value. */
export const EXPRESSIONS = Object.freeze({ getFlag: 13, alterableValue: 16, alterableValueIndexed: 30, counterValue: 80, globalValue: 24 });

/**
 * This reader's name for an ACE, or null where it names none.
 */
export function aceName(kind: 'condition' | 'action', type: number | null, num: number | null) {
  if (type === null || num === null) return null;
  if (type === CREATE_TYPE && kind === 'action') return CREATE_ACTIONS[num] ?? null;
  if (type === COUNTER_TYPE) {
    const own = (kind === 'condition' ? COUNTER_CONDITIONS : COUNTER_ACTIONS)[num];
    if (own) return own;
  }
  // Numbers from 80 up (conditions from -80 down) belong to the object's own type, not the common set.
  if (type >= COMMON_TYPE && (kind === 'condition' ? num > -80 : num < 80))
    return (kind === 'condition' ? COMMON_CONDITIONS : COMMON_ACTIONS)[num] ?? null;
  return null;
}
