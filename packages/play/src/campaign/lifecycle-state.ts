/**
 * The screens the lifecycle observer names. lifecycle-observe.py prints one
 * line: `state=<name>` for a screen it recognised, or `unknown=<reason>` when
 * it refuses (packages/play/src/sensors/screencap/lifecycle-observe.py).
 */
import { isOneOf } from '@sixam/kernel';

const LIFECYCLE_STATES = Object.freeze([
  'night', 'gameover', 'sixam', 'intro', 'newspaper', 'static', 'options', 'title', 'titleDialog',
] as const);
export type LifecycleState = typeof LIFECYCLE_STATES[number];

/**
 * The state one observer line names, or null for a refusal. A name outside
 * the vocabulary throws: a renamed or misspelled state is not a screen, and
 * read as one it would count as a positive non-night vote.
 */
export function parseLifecycleLine(line: string): LifecycleState | null {
  if (!line.startsWith('state=')) return null;
  const name = line.slice('state='.length);
  if (!isOneOf(LIFECYCLE_STATES, name)) throw new Error(`unknown lifecycle state "${name}"`);
  return name;
}
