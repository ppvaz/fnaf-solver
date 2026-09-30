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
import { packEntry, readPack } from './evidence-pack.mjs';

export const COHORT_RESULT_SCHEMA = 'cohort-result-v2';
export const CORNER_COHORT_RESULT_SCHEMA = 'corner-cohort-result-v1';

/** The label prefix a predeclaration's runs carry: `night7-k3-cohort` from `night7-k3-cohort-r01 .. r10`. */
export function labelPrefix(predeclaration) {
  const match = String(predeclaration?.labels ?? '').match(/(\S+?)-r\d{2}\b/);
  if (!match) throw new Error('the predeclaration names no rNN labels; pass the label prefix explicitly');
  return match[1];
}

/** The video's terminal from a pack's own files, or null when the pack carries no grade. */
export function videoTerminal(dir, files) {
  if (files.includes('run/timeline.json')) {
    const terminal = JSON.parse(readFileSync(join(dir, 'run/timeline.json'), 'utf8')).terminal;
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
function lastAbort(dir, files) {
  if (!files.includes('events.jsonl')) return null;
  let reason = null;
  for (const line of readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n')) {
    if (!line.includes('"type":"campaign.abort')) continue;
    const row = JSON.parse(line);
    if (typeof row.reason === 'string') reason = row.reason;
  }
  return reason;
}

function slotStatus(entry, video) {
  const executorWin = entry.outcome === 'WIN';
  if (executorWin && video?.outcome === 'clear') return 'WIN';
  if (video?.outcome === 'death' || entry.outcome === 'DEATH') return 'DEATH';
  if (executorWin && !video) return 'UNGRADED';
  if (executorWin) return 'DISPUTED';
  return 'UNKNOWN';
}

/**
 * Compute a cohort result from the packs under `packsDir`.
 * @param {any} predeclaration parsed cohort-predeclaration-v1
 * @param {string} packsDir directory holding docs/evidence/runs/<run>/
 * @param {{prefix?: string, source?: string}} [options]
 */
export function computeCohort(predeclaration, packsDir, { prefix, source = null } = {}) {
  if (predeclaration?.schema !== 'cohort-predeclaration-v1') throw new Error('not a cohort-predeclaration-v1');
  if (Array.isArray(predeclaration.corners)) {
    if (prefix !== undefined) throw new Error('a corner cohort uses each corner\'s declared labels, not a prefix override');
    return computeCorners(predeclaration, packsDir, source);
  }
  prefix ??= labelPrefix(predeclaration);
  const size = predeclaration.size;
  if (!Number.isInteger(size) || size < 1) throw new Error('the predeclaration has no cohort size');
  const night = predeclaration.night;
  const pattern = new RegExp(`^night${night}-${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-r(\\d{2})([b-z]?)-\\d{8}T\\d{6}Z$`);
  const bySlot = new Map();
  for (const id of existsSync(packsDir) ? readdirSync(packsDir).sort() : []) {
    const match = id.match(pattern);
    if (!match) continue;
    const slot = Number(match[1]);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push({ id, retry: match[2] });
  }
  const binding = predeclaration.binding?.winnerHash ?? null;
  const slots = [];
  for (let slot = 1; slot <= size; slot += 1) {
    const label = `r${String(slot).padStart(2, '0')}`;
    const runs = (bySlot.get(slot) ?? []).sort((a, b) => a.retry.localeCompare(b.retry)).map(({ id }) => {
      const dir = join(packsDir, id);
      const loaded = readPack(dir);
      const entry = packEntry(id, loaded);
      const report = loaded.files.includes('run/run-report.json')
        ? JSON.parse(readFileSync(join(dir, 'run/run-report.json'), 'utf8')) : null;
      const reached = report?.night?.reached === true;
      const video = videoTerminal(dir, loaded.files);
      return { run: id, packSha256: loaded.digest, reached, executor: entry.outcome, video: video?.outcome ?? null,
        videoDetail: video?.detail ?? null, abort: lastAbort(dir, loaded.files), bindingMatches: binding === null || loaded.pack.bundle?.winnerHash === binding,
        status: reached ? slotStatus(entry, video) : 'EXCLUDED' };
    });
    const counted = [...runs].reverse().find(run => run.reached) ?? null;
    for (const run of runs) run.role = run === counted ? 'counted' : run.reached ? 'superseded' : 'excluded';
    slots.push({ slot: label, status: counted ? counted.status : 'MISSING', runs });
  }
  const tally = status => slots.filter(slot => slot.status === status).length;
  const counted = slots.filter(slot => !['MISSING'].includes(slot.status)).length;
  return {
    schema: COHORT_RESULT_SCHEMA, predeclaration: source, night, binding, size, prefix,
    rule: 'WIN = executor terminal sixam AND video terminal clear (the predeclared rule)',
    counted, wins: tally('WIN'), deaths: tally('DEATH'), ungraded: tally('UNGRADED'),
    disputed: tally('DISPUTED'), unknown: tally('UNKNOWN'), missing: tally('MISSING'),
    winRate: `${tally('WIN')}/${counted}`,
    wrongBinding: slots.flatMap(slot => slot.runs.filter(run => !run.bindingMatches).map(run => run.run)),
    status: tally('MISSING') || tally('UNGRADED') || tally('UNKNOWN') || tally('DISPUTED') ? 'INCOMPLETE' : 'COMPLETE',
    slots,
  };
}

/** Read each explicitly labelled corner as its own cohort; never infer extra slots from the total size. */
function computeCorners(predeclaration, packsDir, source) {
  const ids = new Set();
  const prefixes = new Set();
  const { corners: declared, ...shared } = predeclaration;
  if (!declared.length) throw new Error('the predeclaration names no corners');
  const corners = declared.map(corner => {
    if (!corner.id || ids.has(corner.id)) throw new Error('corner ids must be present and unique');
    ids.add(corner.id);
    const labels = [...String(corner.labels ?? '').matchAll(/([A-Za-z0-9_-]+)-r(\d{2})\b/g)];
    const prefix = labels[0]?.[1];
    if (!prefix || labels.some((label, i) => label[1] !== prefix || Number(label[2]) !== i + 1))
      throw new Error(`corner ${corner.id} must explicitly name consecutive rNN labels starting at r01`);
    if (prefixes.has(prefix)) throw new Error('corners must use distinct label prefixes');
    prefixes.add(prefix);
    const result = computeCohort({ ...shared, size: labels.length }, packsDir, { prefix, source });
    for (const slot of result.slots) for (const run of slot.runs) {
      if (run.role !== 'counted') continue;
      const dir = join(packsDir, run.run);
      const requestPath = join(dir, 'request.json');
      const request = existsSync(requestPath) ? JSON.parse(readFileSync(requestPath, 'utf8')) : null;
      const requested = request?.spec?.nights?.find(n => n.night === predeclaration.night)?.dials ?? null;
      let observed = null;
      const eventsPath = join(dir, 'events.jsonl');
      for (const line of existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n') : []) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type !== 'observation') continue;
        if (event.label === 'state=night') break;
        try {
          const readback = JSON.parse(event.label);
          if (readback?.status === 'PASS' && readback.dials) observed = readback.dials;
        } catch { /* Non-JSON lifecycle labels carry no dial readback. */ }
      }
      run.dialVerification = { requested, observed,
        matches: requested !== null && observed !== null
          && stableHash(requested) === stableHash(corner.dials) && stableHash(observed) === stableHash(corner.dials) };
    }
    return { id: corner.id, dials: corner.dials, result };
  });
  const sum = key => corners.reduce((total, corner) => total + corner.result[key], 0);
  if (sum('size') !== predeclaration.size) throw new Error('corner labels do not add up to the declared cohort size');
  const unverifiedDials = corners.flatMap(corner => corner.result.slots.flatMap(slot => slot.runs
    .filter(run => run.role === 'counted' && !run.dialVerification.matches).map(run => run.run)));
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
