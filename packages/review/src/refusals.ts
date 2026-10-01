// The four refusals Plan 28's table found missing, as pure checkers.
//
// Each mistake-register entry is a way a competent reader reaches a confident wrong answer, and
// prose has not stopped the next one. These checkers refuse the known-bad move with the rule, the
// reason, where the rule is written, and the remedy (a claim-envelope-v1 refusal). They read no
// file and write nothing, so the MCP server, the review CLI and any later door apply the same
// rule:
//
//   seed-floor          a win rate quoted under 3000 seeds (plans/ROADMAP.md keeps "the 3000-seed
//                       rule with a held-out block"; packages/propose/bin/census/census.ts defaults to it)
//   directional-reuse   a constant measured in one direction reused in another (CLAUDE.md mistake 10)
//   capabilities-first  an instrument proposed before the phone's capabilities were read, or one the
//                       report says the phone cannot feed (CLAUDE.md mistake 8)
//   unknown-as-number   an UNKNOWN (or missing) value consumed as a number (ADR 0002 principle 2;
//                       CLAUDE.md: "UNKNOWN for missing or ambiguous measurements")
//
// A checker returns a refusal envelope, or {refused: false, notMeasured} naming what passing the
// rule does not establish. Passing a rule is never evidence for the statement it guarded.
import { isUnknown, refusalEnvelope } from '@sixam/kernel';

/** The census floor: no win rate below this many seeds is quoted. */
export const SEED_FLOOR = 3000;
/** The 16-bit RNG's whole seed space: a census over it is exhaustive. */
export const SEED_SPACE = 65536;

/**
 * The mistake-register entries these refusals enforce, by number, with each entry's bold lead as
 * CLAUDE.md writes it: a test reads CLAUDE.md for `N. **lead**`, so a citation cannot drift from
 * the register it points at.
 */
export const MISTAKE_ENTRIES = Object.freeze({
  8: 'Ask the phone what it offers before proposing an instrument.',
  10: 'A number measured in one direction does not transfer to the other.',
});

/** Where each rule is written. Each cite is a path, and a `#anchor` names the entry in it. */
export const RULE_CITES = Object.freeze({
  'seed-floor': Object.freeze(['plans/ROADMAP.md', 'packages/propose/bin/census/census.ts']),
  'directional-reuse': Object.freeze(['CLAUDE.md#mistake-10']),
  'capabilities-first': Object.freeze(['CLAUDE.md#mistake-8', 'packages/play/bin/phone/capabilities.ts']),
  'unknown-as-number': Object.freeze(['docs/decisions/0002-kernel-contexts-vocabulary.md#principles',
    'CLAUDE.md#repository-operating-contract']),
  'not-a-number': Object.freeze(['docs/decisions/0002-kernel-contexts-vocabulary.md#the-kernel']),
});

/**
 * The text each cite resolves to: a test reads each file for it. A rule whose source is edited
 * away fails that test instead of citing nothing.
 */
export const RULE_SOURCES = Object.freeze({
  'seed-floor': Object.freeze([['plans/ROADMAP.md', 'the 3000-seed rule with a held-out block'],
    ['packages/propose/bin/census/census.ts', 'no win rate below 3000 seeds may be']]),
  'directional-reuse': Object.freeze([['CLAUDE.md', `10. **${MISTAKE_ENTRIES[10]}**`]]),
  'capabilities-first': Object.freeze([['CLAUDE.md', `8. **${MISTAKE_ENTRIES[8]}**`],
    ['packages/play/bin/phone/capabilities.ts', "export const SCHEMA = 'device-capabilities-v1'"]]),
  'unknown-as-number': Object.freeze([['docs/decisions/0002-kernel-contexts-vocabulary.md', 'UNKNOWN is a value with a reason, never a default.'],
    ['CLAUDE.md', '`UNKNOWN` for missing or ambiguous measurements']]),
  'not-a-number': Object.freeze([['docs/decisions/0002-kernel-contexts-vocabulary.md', '`Interval{lo, hi}`']]),
});

const refuse = (rule, because, remedy) => refusalEnvelope({ rule, because, cite: [...RULE_CITES[rule]], remedy });
const passed = notMeasured => Object.freeze({ refused: false, notMeasured: Object.freeze([...notMeasured]) });
const UNKNOWN_TEXT = /^UNKNOWN(?:\((.*)\))?$/s;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * What a value is, when it is not a finite number: UNKNOWN (with its reason, if it has one),
 * missing, an interval, or something else.
 */
export function numberKind(value: any): {kind: 'number'} | {kind: 'unknown', reason: string | null} | {kind: 'missing'} | {kind: 'interval'} | {kind: 'other', type: string} {
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number' };
  if (isUnknown(value)) return { kind: 'unknown', reason: value.reason };
  if (isRecord(value) && value.kind === 'UNKNOWN') return { kind: 'unknown', reason: null };
  if (typeof value === 'string' && UNKNOWN_TEXT.test(value)) {
    const reason = value.match(UNKNOWN_TEXT)?.[1];
    return { kind: 'unknown', reason: reason && reason.trim() ? reason : null };
  }
  if (value === undefined || value === null) return { kind: 'missing' };
  if (isRecord(value) && Object.keys(value).length === 2 && Number.isFinite(value.lo) && Number.isFinite(value.hi))
    return { kind: 'interval' };
  return { kind: 'other', type: typeof value === 'number' ? String(value) : Array.isArray(value) ? 'a list' : typeof value };
}

/**
 * unknown-as-number: every operand an arithmetic step consumes must be a finite number. An
 * UNKNOWN or a missing value is refused under `unknown-as-number`; an interval or any other
 * non-number under `not-a-number`.
 * @param operands name -> value
 * @param context what the numbers were going to be used for
 */
export function checkUnknownAsNumber(operands: Record<string, any>, { operation = 'this arithmetic' }: {operation?: string} = {}) {
  if (!isRecord(operands) || !Object.keys(operands).length)
    return refuse('not-a-number', `${operation} names no operands`, 'name each operand and its value');
  const kinds = Object.entries(operands).map(([name, value]) => ({ name, ...numberKind(value) }));
  const unknowns = kinds.filter(item => item.kind === 'unknown' || item.kind === 'missing');
  if (unknowns.length) {
    const what = unknowns.map(item => item.kind === 'missing' ? `${item.name}, which is missing (written nowhere, not even as UNKNOWN)`
      : `${item.name}, which is UNKNOWN${item.reason ? ` (${item.reason})` : ' with no reason'}`);
    return refuse('unknown-as-number', `${operation} would consume ${what.join('; ')} as a number`,
      'carry each as UNKNOWN(reason) into the answer and list it under notMeasured, or measure it first; ' +
      'never substitute 0, a default or a neighbouring value');
  }
  const others = kinds.filter(item => item.kind !== 'number');
  if (others.length)
    return refuse('not-a-number', `${operation} would consume ${others.map(item => item.kind === 'interval'
      ? `${item.name}, an Interval{lo, hi}` : `${item.name} (${'type' in item ? item.type : item.kind})`).join('; ')} as one number`,
    'carry an interval as both bounds, and convert text to a number only where its unit and source are named');
  return passed([]);
}

/**
 * seed-floor: a win rate may be quoted only over at least SEED_FLOOR seeds.
 */
export function checkSeedFloor(quote: {seeds: any, wins?: any, heldOut?: any}) {
  const operands = { seeds: quote?.seeds, ...(quote && 'wins' in quote ? { wins: quote.wins } : {}) };
  const numbers = checkUnknownAsNumber(operands, { operation: 'a quoted win rate' });
  if (numbers.refused) return numbers;
  const { seeds } = operands;
  if (!Number.isInteger(seeds) || seeds < 1)
    return refuse('not-a-number', `a win rate over ${seeds} seeds names no whole seed count`, 'quote the census seed count');
  if ('wins' in operands && (!Number.isInteger(operands.wins) || operands.wins < 0 || operands.wins > seeds))
    return refuse('not-a-number', `${operands.wins} wins is not a count of seeds in 0..${seeds}`, 'quote the census win count');
  if (seeds < SEED_FLOOR)
    return refuse('seed-floor', `a win rate is quoted over ${seeds} seeds; no win rate below ${SEED_FLOOR} seeds is quoted`,
      `run the census over at least ${SEED_FLOOR} seeds (packages/propose/bin/census/census.ts --seeds ${SEED_FLOOR} for FNaF 1, 3 and 4; ` +
      `packages/propose/bin/census/winner-census.ts for a FNaF 2 winner; ${SEED_SPACE} is exhaustive for the 16-bit RNG), then confirm it on a ` +
      `held-out block (census.ts --start ${SEED_FLOOR})`);
  const heldOut = quote?.heldOut;
  return passed([
    ...(heldOut === undefined || heldOut === null ? ['a held-out seed block: none was named, and a swept setting can lose on a fresh block'] : []),
    'the device: a census is a model result, never a phone measurement',
    ...(seeds < SEED_SPACE ? [`the ${SEED_SPACE - seeds} seeds outside the census`] : []),
  ]);
}

/**
 * Constants measured in one direction: which press came first, which second, and where that is
 * written. `marker` is text the source file holds, so a test can tell the citation still stands.
 */
export const DIRECTIONAL_CONSTANTS = Object.freeze({
  SEAM_BANDS: Object.freeze({ first: 'mask', then: 'monitor', source: 'packages/play/bin/phone/actuator.ts',
    marker: 'under 140 ms after the mask press 5 of 7 monitor', measures: 'monitor presses lost after a mask press, by gap' }),
  SEAM_SAFE_MS: Object.freeze({ first: 'mask', then: 'monitor', source: 'packages/play/bin/phone/actuator.ts',
    marker: 'export const SEAM_SAFE_MS = 180', measures: 'the mask-to-monitor gap past which no monitor press was lost (0 of 17)' }),
  maskButtonFullyVisibleAfterMonitorDownMs: Object.freeze({ first: 'monitor-down', then: 'mask', source: 'packages/propose/bin/plans/artifact-commands.ts',
    marker: 'maskButtonFullyVisibleAfterMonitorDownMs', measures: 'the mask button fully drawn after monitor-down, native frame trace' }),
  monitorMaskReadyMs: Object.freeze({ first: 'monitor-down', then: 'mask', source: 'packages/propose/bin/plans/artifact-commands.ts',
    marker: 'monitorMaskReadyMs: MONITOR_MASK_READY_MS', measures: 'the floor on a mask press after monitor-down' }),
  monitorReadyCameraMs: Object.freeze({ first: 'monitor-up', then: 'camera', source: 'packages/propose/bin/plans/artifact-commands.ts',
    marker: 'monitorReadyCameraMs: MONITOR_READY_CAMERA_MS', measures: 'the floor on a camera select after the monitor raise' }),
  monitorReadyWindMs: Object.freeze({ first: 'monitor-up', then: 'wind', source: 'packages/propose/bin/plans/artifact-commands.ts',
    marker: 'monitorReadyWindMs: MONITOR_READY_WIND_MS', measures: 'the floor on a wind hold after the monitor raise' }),
});

const direction = value => isRecord(value) && typeof value.first === 'string' && value.first && typeof value.then === 'string' && value.then
  ? { first: value.first, then: value.then } : null;
const arrow = ({ first, then }) => `${first} -> ${then}`;

/**
 * directional-reuse: a constant measured as `first` then `then` is used only in that order. The
 * direction comes from DIRECTIONAL_CONSTANTS for a registered constant (a caller's `measured`
 * that disagrees is refused), or from the caller's `measured` for any other.
 */
export function checkDirectionalReuse(reuse: {constant: string, use: {first: string, then: string}, measured?: {first: string, then: string}}) {
  const constant = typeof reuse?.constant === 'string' && reuse.constant ? reuse.constant : null;
  const use = direction(reuse?.use);
  if (!constant || !use)
    return refuse('directional-reuse', 'a reuse names no constant, or no direction {first, then} it is used in',
      'name the constant and the order of the two presses it is about to govern');
  const registered = Object.hasOwn(DIRECTIONAL_CONSTANTS, constant) ? DIRECTIONAL_CONSTANTS[constant] : null;
  const claimed = direction(reuse.measured);
  if (registered && claimed && arrow(claimed) !== arrow(registered))
    return refuse('directional-reuse', `${constant} was measured ${arrow(registered)} (${registered.source}), not ${arrow(claimed)}`,
      `read ${registered.source} before reusing it`);
  const measured = registered ?? claimed;
  if (!measured)
    return refuse('directional-reuse', `the direction ${constant} was measured in is UNKNOWN: it is not registered and the reuse states none`,
      'state the order it was measured in (measured: {first, then}), from the record that measured it, or measure the direction in use');
  if (arrow(use) === arrow(measured))
    return passed([`${constant} in any other order than ${arrow(measured)}`,
      ...(registered ? [] : [`the direction ${arrow(measured)} is the caller's statement; no register holds it`])]);
  const reversed = use.first === measured.then && use.then === measured.first;
  return refuse('directional-reuse',
    `${constant} was measured ${arrow(measured)}${registered ? ` (${registered.source}: ${registered.measures})` : ''}; ` +
    `it is used ${arrow(use)}${reversed ? ', the reverse order' : ''}, and a number measured in one direction does not transfer to the other`,
    `measure ${arrow(use)} on its own (a gap census in that order), or keep ${constant} to ${arrow(measured)}`);
}

/** The schema packages/play/bin/phone/capabilities.ts writes. */
export const CAPABILITIES_SCHEMA = 'device-capabilities-v1';
const CAPABILITIES_REMEDY = 'with the phone attached, run `npm run device:capabilities -- --json --out FILE` and propose the ' +
  'instrument with that report';

/**
 * capabilities-first: an instrument is proposed only against a device-capabilities-v1 report,
 * and never when the report says the phone cannot feed it.
 */
export function checkCapabilitiesFirst(proposal: {instrument: string, capabilities?: any}) {
  const instrument = typeof proposal?.instrument === 'string' && proposal.instrument.trim() ? proposal.instrument.trim() : null;
  if (!instrument)
    return refuse('capabilities-first', 'a proposal names no instrument', 'name the instrument (its tool path) and pass the capabilities report');
  const report = proposal.capabilities;
  if (report === undefined || report === null || numberKind(report).kind === 'unknown')
    return refuse('capabilities-first', `${instrument} is proposed before the phone's capabilities were read`, CAPABILITIES_REMEDY);
  if (!isRecord(report) || report.schema !== CAPABILITIES_SCHEMA || !Array.isArray(report.instruments))
    return refuse('capabilities-first', `the report passed with ${instrument} is not a ${CAPABILITIES_SCHEMA} report`, CAPABILITIES_REMEDY);
  const base = instrument.split('/').pop();
  const entry = report.instruments.find(item => typeof item?.tool === 'string' &&
    item.tool.split(/,\s*/).some(tool => tool === instrument || tool.split('/').pop() === base));
  const recorded = typeof report.recordedAt === 'string' ? report.recordedAt : 'an unrecorded date';
  if (!entry)
    return passed([`what ${instrument} needs from the phone: the capabilities report lists no entry for it`,
      `the handset as it is now: the report was recorded ${recorded}`]);
  if (entry.available === false)
    return refuse('capabilities-first', `the capabilities report (${recorded}) says this phone cannot feed ${instrument}: it needs ${entry.needs}`,
      entry.ifMissing ?? CAPABILITIES_REMEDY);
  if (entry.available !== true)
    return refuse('capabilities-first', `the capabilities report (${recorded}) could not read whether the phone offers ${entry.needs}, which ${instrument} needs`,
      CAPABILITIES_REMEDY);
  return passed([`the handset as it is now: the report was recorded ${recorded}`,
    `that ${instrument} answers the question it is proposed for: capabilities say only that its input exists`]);
}

/** The rules the `check` verb runs, by the name a caller passes. */
export const CHECKS = Object.freeze({
  'seed-floor': checkSeedFloor,
  'directional-reuse': checkDirectionalReuse,
  'capabilities-first': checkCapabilitiesFirst,
  'unknown-as-number': input => checkUnknownAsNumber(input?.operands, { operation: input?.operation }),
});
