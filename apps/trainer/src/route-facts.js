// Every statement the trainer makes about a route's results, with its evidence
// label and the committed record that holds it. The labels never promote one
// another: a number from the model is not a number from the phone. A quantity
// nobody has measured is UNKNOWN with its reason, never a guess.
//
// `values` are the numbers a fact's text shows and `from` names where each one
// sits in its record. apps/trainer/test/route-facts.test.mjs reads every record
// and fails on a fact whose label differs from the record's own claimLevel or
// whose value differs from the record's field, so a record that moves takes
// the page with it instead of leaving it quoting a stale number.

/** @typedef {'MODEL_ONLY' | 'FIXTURE' | 'DEVICE_MEASURED'} ClaimLevel */
/** @typedef {string | number | {id: string}} PathStep */
/**
 * @typedef {{id: string, label: ClaimLevel, text: string, record?: string,
 *   values?: Record<string, number>, from?: Record<string, PathStep[]>, unknown?: string}} RouteFact
 */

const EVIDENCE = 'docs/evidence/';
export const REPOSITORY = 'https://github.com/ppvaz/fnaf-solver/blob/master/';

/** @type {readonly RouteFact[]} */
export const ROUTE_FACTS = Object.freeze([
  {
    id: 'bot-cohort',
    label: 'DEVICE_MEASURED',
    text: 'With Minus Toys, {wins} of {counted} predeclared 10/20 nights reached 6 AM on the phone.',
    record: `${EVIDENCE}night7-cohort-k3-result-20260918.json`,
    values: { wins: 8, counted: 10 },
    from: { wins: ['wins'], counted: ['counted'] },
  },
  {
    id: 'bot-lateness',
    label: 'MODEL_ONLY',
    text: 'That schedule is built for a machine: in the model it survives each press running up to ' +
      '{late} ms late, and a person’s ±60 ms on {human} of {n} seeds.',
    record: `${EVIDENCE}night7-robustness-20260925.json`,
    values: { late: 50, human: 1, n: 500 },
    from: {
      late: ['schedules', { id: 'k3' }, 'lateness', 'maxAllWinMs'],
      human: ['schedules', { id: 'k3' }, 'human', 'wins'],
      n: ['schedules', { id: 'k3' }, 'human', 'n'],
    },
  },
  {
    id: 'preset-margin',
    label: 'MODEL_ONLY',
    text: 'The widest timing margin the model has found at 10/20 is a preset Minus Toys schedule: ' +
      'presses up to {late} ms late on all {n} held-out seeds, and ±60 ms on {human} of {n}. ' +
      'It has never been played on the phone.',
    record: `${EVIDENCE}night7-robustness-20260925.json`,
    values: { late: 100, n: 500, human: 257 },
    from: {
      late: ['schedules', { id: 'preset' }, 'lateness', 'maxAllWinMs'],
      n: ['schedules', { id: 'preset' }, 'human', 'n'],
      human: ['schedules', { id: 'preset' }, 'human', 'wins'],
    },
  },
  {
    id: 'mask-gate',
    label: 'MODEL_ONLY',
    text: 'The game takes the mask off only once it is fully on, {frames} frames after the press. ' +
      'The flick this trainer taught until 2026-09-30 came sooner, and the model refused it.',
    record: `${EVIDENCE}policy-baseline-mask-animation-20260927.json`,
    values: { frames: 12 },
    from: { frames: ['sourceRule', 'maskPutOnFrames'] },
  },
  {
    id: 'minus7-1020',
    label: 'MODEL_ONLY',
    text: 'Whether this Minus 7 pass clears a whole 10/20 night in the model: UNKNOWN. {unknown}.',
    unknown: 'No committed census has played it; the drills show only that the model takes every ' +
      'press of it on its cue',
  },
]);

/** What a fact says, with its values in place. @param {RouteFact} fact */
export function factText(fact) {
  return fact.text.replace(/\{(\w+)\}/g, (_, key) => {
    if (key === 'unknown' && fact.unknown) return fact.unknown;
    if (!fact.values || !(key in fact.values)) throw new Error(`route fact ${fact.id} names {${key}} and holds no value for it`);
    return String(fact.values[key]);
  });
}

/** The field a path names inside a record; `{id}` picks the array element with that id. */
export function pick(record, path) {
  let here = record;
  for (const step of path) {
    if (here == null) return undefined;
    here = typeof step === 'object'
      ? (Array.isArray(here) ? here.find(item => item?.id === step.id) : undefined)
      : here[step];
  }
  return here;
}

/** @param {string} id */
export const factById = id => ROUTE_FACTS.find(fact => fact.id === id);
