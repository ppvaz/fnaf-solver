// A cohort result, computed from its run packs instead of assembled by hand.
//
// A cohort is predeclared (cohort-predeclaration-v1: the binding, the size, the
// labels and the rules) and then run slot by slot; until 2026-09-25 its result
// was a JSON record someone wrote from the run directories, the ledger and the
// video grades. That record is only as good as the copying, and it cites media a
// later reader may not have. This reads the committed packs instead
// (evidence-pack.mjs), applies the predeclared win rule -- the executor's
// terminal is sixam AND the video's terminal is clear -- and reports every slot,
// including the ones the packs cannot decide yet.
//
// A slot's runs are the packs named <night>-<prefix>-rNN[b..z]-<stamp>. A run
// that never reached the night is excluded; when several reached it, the last
// is the one that counts (the rules re-run an invalid slot as rNNb, rNNc) and
// the others are reported as superseded. A video terminal comes from the pack's
// grade.log (`TERMINAL: clear -- ...`, the line run-timeline.py prints) or its
// timeline.json (run-timeline.py's `terminal.outcome`); without either, a sixam run is
// UNGRADED, not a win. A pack whose result was never printed (recovered from its night-run
// log, evidence-pack.mjs) has no executor terminal: its slot is decided by the video if
// the video saw a death, and is otherwise UNKNOWN with the executor's own abort reason beside
// it -- this does not promote an abort to a death on the rule's behalf.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableHash } from '@sixam/kernel/contracts';
import { packEntry, readPack } from './evidence-pack.ts';
import { lastDialReadback, requestedDials } from './custom-night.ts';
import { jsonObject, jsonlRecords, objectOrNull } from './records.ts';
import { isList } from '@sixam/kernel';

/** One corner of a corner cohort: its own labels and the dial vector it plays. */
type Corner = { readonly id?: string, readonly labels?: unknown, readonly dials?: unknown };
/** cohort-predeclaration-v1, by the fields a cohort reads. */
type Predeclaration = { readonly schema?: unknown, readonly labels?: unknown, readonly size?: unknown, readonly night?: unknown,
  readonly binding?: { readonly winnerHash?: string | null } | null, readonly corners?: readonly Corner[], readonly [field: string]: unknown };
/** One run of a slot, as its pack reads. */
type SlotRun = { run: string, packSha256: string, reached: boolean, executor: unknown, video: string | null,
  videoDetail: unknown, abort: string | null, bindingMatches: boolean, status: string, role?: string,
  dialVerification?: { requested: unknown, observed: unknown, matches: boolean } };

export const COHORT_RESULT_SCHEMA = 'cohort-result-v2';
export const CORNER_COHORT_RESULT_SCHEMA = 'corner-cohort-result-v1';

/** The label prefix a predeclaration's runs carry: `night7-k3-cohort` from `night7-k3-cohort-r01 .. r10`. */
export function labelPrefix(predeclaration: Predeclaration | null | undefined) {
  const match = String(predeclaration?.labels ?? '').match(/(\S+?)-r\d{2}\b/);
  if (!match) throw new Error('the predeclaration names no rNN labels; pass the label prefix explicitly');
  return match[1];
}

/** The video's terminal from a pack's own files, or null when the pack carries no grade. */
export function videoTerminal(dir: string, files: readonly string[]) {
  if (files.includes('run/timeline.json')) {
    const terminal = objectOrNull(jsonObject(readFileSync(join(dir, 'run/timeline.json'), 'utf8'), 'run/timeline.json').terminal);
    if (typeof terminal?.outcome === 'string') {
      const detail = terminal.evidence ? `${terminal.evidence}${terminal.at_s === null || terminal.at_s === undefined ? '' : ` at ${terminal.at_s} s`}`
        : terminal.note ?? null;
      return { outcome: terminal.outcome, detail, source: 'run/timeline.json' };
    }
  }
  if (files.includes('run/grade.log')) {
    const line = readFileSync(join(dir, 'run/grade.log'), 'utf8').match(/^\s*TERMINAL: (\w+)(?: -- (.*))?$/m);
    if (line) return { outcome: line[1], detail: line[2] ?? null, source: 'run/grade.log' };
  }
  return null;
}

/** The executor's last abort reason, from the pack's events, or null. */
function lastAbort(dir: string, files: readonly string[]) {
  if (!files.includes('events.jsonl')) return null;
  let reason: string | null = null;
  for (const row of jsonlRecords(readFileSync(join(dir, 'events.jsonl'), 'utf8'), 'events.jsonl'))
    if (typeof row.type === 'string' && row.type.startsWith('campaign.abort') && typeof row.reason === 'string') reason = row.reason;
  return reason;
}

function slotStatus(entry: { readonly outcome: unknown }, video: { readonly outcome: unknown } | null) {
  const executorWin = entry.outcome === 'WIN';
  if (executorWin && video?.outcome === 'clear') return 'WIN';
  if (video?.outcome === 'death' || entry.outcome === 'DEATH') return 'DEATH';
  if (executorWin && !video) return 'UNGRADED';
  if (executorWin) return 'DISPUTED';
  return 'UNKNOWN';
}

/**
 * Compute a cohort result from the packs under `packsDir`.
 * @param predeclaration parsed cohort-predeclaration-v1
 * @param packsDir directory holding docs/evidence/runs/<run>/
 */
export function computeCohort(predeclaration: Predeclaration, packsDir: string, { prefix, source = null }: {prefix?: string, source?: string | null} = {}) {
  if (predeclaration?.schema !== 'cohort-predeclaration-v1') throw new Error('not a cohort-predeclaration-v1');
  if (isList(predeclaration.corners)) {
    if (prefix !== undefined) throw new Error('a corner cohort uses each corner\'s declared labels, not a prefix override');
    return computeCorners(predeclaration, packsDir, source);
  }
  return cohortSlots(predeclaration, packsDir, prefix ?? labelPrefix(predeclaration), source);
}

/** One labelled cohort's slots, from its packs: the whole of a plain cohort, and each corner of a corner cohort. */
function cohortSlots(predeclaration: Predeclaration, packsDir: string, prefix: string, source: string | null) {
  const size = predeclaration.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) throw new Error('the predeclaration has no cohort size');
  const night = predeclaration.night;
  const pattern = new RegExp(`^night${night}-${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-r(\\d{2})([b-z]?)-\\d{8}T\\d{6}Z$`);
  const bySlot = new Map<number, { id: string, retry: string }[]>();
  for (const id of existsSync(packsDir) ? readdirSync(packsDir).sort() : []) {
    const match = id.match(pattern);
    if (!match) continue;
    const slot = Number(match[1]);
    let found = bySlot.get(slot);
    if (!found) { found = []; bySlot.set(slot, found); }
    found.push({ id, retry: match[2] });
  }
  const binding = predeclaration.binding?.winnerHash ?? null;
  const slots: { slot: string, status: string, runs: SlotRun[] }[] = [];
  for (let slot = 1; slot <= size; slot += 1) {
    const label = `r${String(slot).padStart(2, '0')}`;
    const runs = (bySlot.get(slot) ?? []).sort((a, b) => a.retry.localeCompare(b.retry)).map(({ id }): SlotRun => {
      const dir = join(packsDir, id);
      const loaded = readPack(dir);
      const entry = packEntry(id, loaded);
      const report = loaded.files.includes('run/run-report.json')
        ? jsonObject(readFileSync(join(dir, 'run/run-report.json'), 'utf8'), 'run/run-report.json') : null;
      const reached = objectOrNull(report?.night)?.reached === true;
      const video = videoTerminal(dir, loaded.files);
      return { run: id, packSha256: loaded.digest, reached, executor: entry.outcome, video: video?.outcome ?? null,
        videoDetail: video?.detail ?? null, abort: lastAbort(dir, loaded.files), bindingMatches: binding === null || loaded.pack.bundle?.winnerHash === binding,
        status: reached ? slotStatus(entry, video) : 'EXCLUDED' };
    });
    const counted = [...runs].reverse().find(run => run.reached) ?? null;
    for (const run of runs) run.role = run === counted ? 'counted' : run.reached ? 'superseded' : 'excluded';
    // A run played on another binding is not a run of this cohort: its slot is
    // invalid, re-run as any invalid slot is, and neither scored nor counted.
    const status = !counted ? 'MISSING' : !counted.bindingMatches ? 'WRONG_BINDING' : counted.status;
    slots.push({ slot: label, status, runs });
  }
  const tally = (status: string) => slots.filter(slot => slot.status === status).length;
  const counted = slots.filter(slot => !['MISSING', 'WRONG_BINDING'].includes(slot.status)).length;
  const wrongBinding = slots.flatMap(slot => slot.runs.filter(run => !run.bindingMatches).map(run => run.run));
  return {
    schema: COHORT_RESULT_SCHEMA, predeclaration: source, night, binding, size, prefix,
    rule: 'WIN = executor terminal sixam AND video terminal clear (the predeclared rule)',
    counted, wins: tally('WIN'), deaths: tally('DEATH'), ungraded: tally('UNGRADED'),
    disputed: tally('DISPUTED'), unknown: tally('UNKNOWN'), missing: tally('MISSING'),
    winRate: `${tally('WIN')}/${counted}`,
    wrongBinding,
    status: tally('MISSING') || tally('UNGRADED') || tally('UNKNOWN') || tally('DISPUTED') || wrongBinding.length
      ? 'INCOMPLETE' : 'COMPLETE',
    slots,
  };
}

/** Read each explicitly labelled corner as its own cohort; never infer extra slots from the total size. */
function computeCorners(predeclaration: Predeclaration, packsDir: string, source: string | null) {
  const ids = new Set<string>();
  const prefixes = new Set<string>();
  // computeCohort checked corners is a list before it came here.
  const { corners: declared = [], ...shared } = predeclaration;
  if (!declared.length) throw new Error('the predeclaration names no corners');
  const corners = declared.map(corner => {
    const cornerId = corner.id;
    if (!cornerId || ids.has(cornerId)) throw new Error('corner ids must be present and unique');
    ids.add(cornerId);
    const labels = [...String(corner.labels ?? '').matchAll(/([A-Za-z0-9_-]+)-r(\d{2})\b/g)];
    const prefix = labels[0]?.[1];
    if (!prefix || labels.some((label, i) => label[1] !== prefix || Number(label[2]) !== i + 1))
      throw new Error(`corner ${corner.id} must explicitly name consecutive rNN labels starting at r01`);
    if (prefixes.has(prefix)) throw new Error('corners must use distinct label prefixes');
    prefixes.add(prefix);
    // What computeCohort did for a corner: shared fields carry the schema it checked, and no corners.
    const result = cohortSlots({ ...shared, size: labels.length }, packsDir, prefix, source);
    for (const slot of result.slots) for (const run of slot.runs) {
      if (run.role !== 'counted') continue;
      const dir = join(packsDir, run.run);
      const requestPath = join(dir, 'request.json');
      const request = existsSync(requestPath) ? jsonObject(readFileSync(requestPath, 'utf8'), 'request.json') : null;
      const requested = requestedDials(request, predeclaration.night);
      const eventsPath = join(dir, 'events.jsonl');
      const events = existsSync(eventsPath) ? jsonlRecords(readFileSync(eventsPath, 'utf8'), 'events.jsonl') : [];
      const observed = lastDialReadback(events)?.dials ?? null;
      run.dialVerification = { requested, observed,
        matches: requested !== null && observed !== null
          && stableHash(requested) === stableHash(corner.dials) && stableHash(observed) === stableHash(corner.dials) };
    }
    return { id: cornerId, dials: corner.dials, result };
  });
  const sum = (key: 'size' | 'counted' | 'wins' | 'deaths' | 'ungraded' | 'disputed' | 'unknown' | 'missing') =>
    corners.reduce((total, corner) => total + corner.result[key], 0);
  if (sum('size') !== predeclaration.size) throw new Error('corner labels do not add up to the declared cohort size');
  const unverifiedDials = corners.flatMap(corner => corner.result.slots.flatMap(slot => slot.runs
    .filter(run => run.role === 'counted' && !run.dialVerification?.matches).map(run => run.run)));
  const result = {
    schema: CORNER_COHORT_RESULT_SCHEMA, claimLevel: 'DEVICE_MEASURED', predeclaration: source,
    night: predeclaration.night, binding: predeclaration.binding?.winnerHash ?? null,
    rule: corners[0].result.rule, size: sum('size'), counted: sum('counted'), wins: sum('wins'),
    deaths: sum('deaths'), ungraded: sum('ungraded'), disputed: sum('disputed'),
    unknown: sum('unknown'), missing: sum('missing'),
    winRate: `${sum('wins')}/${sum('counted')}`,
    wrongBinding: corners.flatMap(corner => corner.result.wrongBinding),
    unverifiedDials,
    status: corners.every(corner => corner.result.status === 'COMPLETE' && !corner.result.wrongBinding.length)
      && !unverifiedDials.length ? 'COMPLETE' : 'INCOMPLETE',
    corners,
  };
  return { ...result, evidenceId: `cohort-${stableHash(result)}` };
}
