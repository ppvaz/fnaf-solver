// The ROADMAP's steps S1-S7, each open, closed or UNKNOWN, computed from what its "Closes when"
// can be checked against (ADR 0002 principle 4: status is a query, never prose).
//
// plans/ROADMAP.md is read for two things only, and a test holds both to the file: each step's
// heading and "Closes when" text (quoted, so a reader sees the condition the state was computed
// for), and the order lines under "**Order.**", from which `lab next` ranks the steps. The states
// come from the evidence, never from the ROADMAP's own "Stands" prose:
//
//   S1  closed when graph.json holds a PROMOTED_BY edge the packs re-derive, and no committed
//       winner-v1 stands MODEL_ONLY (the promotions query's own open items)
//   S2  UNKNOWN: no registered record kind carries a twin or trace-equivalence verdict, so a
//       closing record cannot be told from the records that name S2
//   S3  needs S2; S4 and S5 need S3 (the ROADMAP's "Needs S2", "S4 after S3", "S5 needs S3's
//       robustness field"): open while a need is open, UNKNOWN while one is UNKNOWN
//   S6  a PROMOTED_BY edge for a FNaF 1, 3 and 4 pack; the fnaf-solver / @sixam/* names; a
//       truth.* verb in the solver interface (Plan 28 gap 2)
//   S7  every mistake-register entry names a gate that runs in a CI lane; and a morning report
//       that refutes an unqueued mechanism, which no record kind states (UNKNOWN)
//
// It reads files and runs nothing; the promotions query and the pack rows are passed in, so the
// caller computes them once.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isUnknown, unknown } from '@sixam/kernel';
import { MISTAKE_ENTRIES } from './refusals.mjs';
import { readMistakes, stepFamily } from './mistakes.mjs';
import { GAMES, gameKey } from './registers.mjs';
import { VERBS } from './solver.mjs';

export const ROADMAP = 'plans/ROADMAP.md';
export const MISTAKE_GATES_FILE = 'tools/test-mistake-register.mjs';
export const MCP_SERVER_FILE = 'apps/desktop/src/cue-helper-mcp.mjs';

/** The steps, their headings as the ROADMAP writes them, and what each needs closed first. */
export const STEPS = Object.freeze([
  { id: 'S1', title: 'Custody and the first promotion edge', needs: [], where: 'phone' },
  { id: 'S2', title: 'Fidelity at the level of encounters', needs: [], where: 'phone and host' },
  { id: 'S3', title: 'The ceiling, from a census over policies', needs: ['S2'], where: 'host, then phone corners' },
  { id: 'S4', title: 'A controller that plays at the ceiling, on the phone', needs: ['S3'], where: 'phone' },
  { id: 'S5', title: 'The human route', needs: ['S3'], where: 'Pedro, on the phone' },
  { id: 'S6', title: 'The method on four games, and the interface', needs: [], where: 'host and phone' },
  { id: 'S7', title: 'The lab runs itself', needs: [], after: ['S2', 'S3', 'S4', 'S5'], where: 'host and the overnight window' },
].map(step => Object.freeze(step)));

/** The ROADMAP's order, verbatim; `lab next` ranks by it, and a test finds each line in the file. */
export const ORDER = Object.freeze([
  '**Now:** S1, which needs minutes of Pedro plus the peer machine.',
  '**Next:** S2a is the next physical test; S2b runs beside it.',
  '**Then:** S3 after S2, and S4 after S3.',
  "**S5** needs S3's robustness field.",
  '**S6** is already under way. Its gates are restated below.',
  '**S7** comes last, because it automates S2 to S5.',
]);

/** The order line each step is ranked by. */
export const ORDER_OF = Object.freeze({ S1: 0, S2: 1, S3: 2, S4: 2, S5: 3, S6: 4, S7: 5 });

/**
 * Each step's "Closes when" text as the ROADMAP writes it, markdown emphasis removed.
 * @param {string} root
 * @returns {Record<string, string | null>}
 */
export function closesWhen(root) {
  const text = readFileSync(join(root, ROADMAP), 'utf8');
  const out = {};
  for (const step of STEPS) {
    const at = text.indexOf(`### ${step.id}: ${step.title}`);
    if (at < 0) { out[step.id] = null; continue; }
    const rest = text.slice(at + 1);
    const section = rest.slice(0, rest.search(/\n##+ /) >= 0 ? rest.search(/\n##+ /) : rest.length);
    const lines = section.split('\n');
    const first = lines.findIndex(line => line.startsWith('- **Closes when**'));
    if (first < 0) { out[step.id] = null; continue; }
    const taken = [lines[first]];
    for (const line of lines.slice(first + 1)) {
      if (!/^\s+\S/.test(line)) break;
      taken.push(line.trim());
    }
    out[step.id] = taken.join(' ').replace(/^- \*\*Closes when\*\*\s*/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** The ROADMAP headings and order lines this module relies on that the file no longer holds. @param {string} root */
export function roadmapDrift(root) {
  const text = readFileSync(join(root, ROADMAP), 'utf8');
  return [...STEPS.map(step => `### ${step.id}: ${step.title}`), ...ORDER].filter(line => !text.includes(line));
}

const DATE = /(20\d{2})-?(\d{2})-?(\d{2})/;
const recordDate = (file, record) => {
  const stamp = [record.date, record.recordedAt, file].map(value => (typeof value === 'string' ? DATE.exec(value) : null)).find(Boolean);
  return stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}` : null;
};

/**
 * The evidence records that name a step in their top-level `step` field (docs/evidence/*.json and
 * tools/recompile/results/*.json), by step, oldest first.
 * @param {string} root
 */
export function stepRecords(root) {
  const byStep = Object.fromEntries(STEPS.map(step => [step.id, []]));
  for (const dir of ['docs/evidence', 'tools/recompile/results']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir)).filter(item => item.endsWith('.json')).sort()) {
      let record;
      try { record = JSON.parse(readFileSync(join(root, dir, name), 'utf8')); } catch { continue; }
      if (!record || typeof record.step !== 'string') continue;
      const named = /\bS([1-7])[ab]?\b/.exec(record.step);
      if (!named) continue;
      byStep[`S${named[1]}`].push({ file: `${dir}/${name}`, id: record.evidenceId ?? record.id ?? null, date: recordDate(name, record),
        step: record.step });
    }
  }
  for (const rows of Object.values(byStep)) rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.file.localeCompare(b.file));
  return byStep;
}

/** The gate each mistake-register entry relies on: tools/test-mistake-register.mjs's REGISTER_GATES, and the refusals. @param {string} root */
export function mistakeGates(root) {
  const text = readFileSync(join(root, MISTAKE_GATES_FILE), 'utf8');
  const block = /const REGISTER_GATES = \[([\s\S]*?)\n\];/.exec(text)?.[1];
  if (block === undefined) return null;
  const gates = {};
  for (const [, n, self, file] of block.matchAll(/\[(\d+),\s*(?:(SELF)|'([^']+)')\]/g))
    (gates[n] ??= []).push(self ? MISTAKE_GATES_FILE : file);
  for (const n of Object.keys(MISTAKE_ENTRIES)) (gates[n] ??= []).push('packages/review/test/refusals.test.mjs');
  return gates;
}

/** The CI-run scripts that hold the lanes (.github/workflows/ci.yml runs each). */
const CI_SCRIPTS = ['test:unit', 'test:unit:slow', 'test:contracts', 'test:core'];

const workspaceNames = root => ['packages', 'apps'].flatMap(group => (existsSync(join(root, group)) ? readdirSync(join(root, group)) : [])
  .map(name => [group, name]).filter(([group, name]) => existsSync(join(root, group, name, 'package.json')))
  .map(([group, name]) => ({ dir: `${group}/${name}`, name: JSON.parse(readFileSync(join(root, group, name, 'package.json'), 'utf8')).name })));

/**
 * Every step's state.
 * @param {string} root
 * @param {{promotions: any, packs: any[]}} inputs the promotions query (queryPromotions) and the pack rows (readPacks)
 * @returns {{id: string, title: string, closesWhen: string | null, state: 'open' | 'closed' | {kind: 'UNKNOWN', reason: string},
 *   met: string[], unmet: string[], needs: string[], records: {count: number, newest: any}, where: string}[]}
 */
export function stepStatus(root, { promotions, packs }) {
  const closes = closesWhen(root);
  const records = stepRecords(root);
  const rows = new Map();
  const base = step => ({ id: step.id, title: step.title, closesWhen: closes[step.id], needs: [...step.needs], where: step.where,
    records: { count: records[step.id].length, newest: records[step.id].at(-1) ?? null }, met: [], unmet: [] });

  // S1: the promotions query's own edges and open items.
  {
    const row = base(STEPS[0]);
    if (!promotions || isUnknown(promotions)) row.state = unknown(`the promotions query did not run: ${promotions?.reason ?? 'no result'}`);
    else if (!promotions.consistent) row.state = unknown('graph.json and the derivation from the packs disagree (npm run review -- query promotions)');
    else {
      const edges = promotions.edges.matched;
      const open = promotions.open.modelOnlyWinners;
      (edges > 0 ? row.met : row.unmet).push(`${edges} PROMOTED_BY edges re-derive from their packs`);
      if (open.count === 0) row.met.push(`every one of ${open.of} committed winner-v1 bindings is named by a run pack`);
      else row.unmet.push(...open.winners.map(item => `${item.file} stands MODEL_ONLY: no run pack names it`));
      // Open for S1 in CLAUDE.md's list, but not part of its "Closes when": kept beside the state, never in it.
      const debt = promotions.open.untrackedWinnerDebt;
      row.alsoOpen = debt.untracked ? [`UNTRACKED_WINNER_DEBT ${debt.summary}: ${debt.entries.filter(item => !item.committed)
        .map(item => `Night ${item.night ?? 'UNKNOWN'} binding ${item.hash}`).join(', ')} has no committed winner`] : [];
      row.state = edges > 0 && open.count === 0 ? 'closed' : 'open';
      row.promotions = { edges, modelOnlyWinners: open.winners.map(item => item.file), untrackedWinnerDebt: debt.summary };
    }
    rows.set('S1', row);
  }

  // S2: no record kind states its verdict.
  {
    const row = base(STEPS[1]);
    row.state = unknown(`S2 closes on a frame-traced twin record or a trace-equivalence record, and no registered record kind states ` +
      `either verdict, so a closing record cannot be told from the ${row.records.count} records that name step S2` +
      (row.records.newest ? ` (newest ${row.records.newest.file})` : ''));
    rows.set('S2', row);
  }

  // S3-S5: their needs first.
  for (const step of STEPS.slice(2, 5)) {
    const row = base(step);
    const need = rows.get(step.needs[0]);
    if (need.state === 'closed') row.state = unknown(`${step.needs[0]} is closed; ${step.id}'s own condition has no registered record kind to query`);
    else if (need.state === 'open') { row.state = 'open'; row.unmet.push(`needs ${need.id}, which is open`); }
    else row.state = unknown(`needs ${need.id}, whose state is UNKNOWN`);
    rows.set(step.id, row);
  }

  // S6: the three games' promotion edges, the names, and the interface's verbs.
  {
    const row = base(STEPS[5]);
    for (const game of GAMES.filter(item => item.alias !== 'fnaf2')) {
      const own = packs.filter(pack => gameKey(pack.game) === game.package);
      const promoted = own.filter(pack => pack.promoted);
      (promoted.length ? row.met : row.unmet).push(`${game.title}: ${promoted.length} PROMOTED_BY edges over ${own.length} run packs`);
    }
    const rootName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
    const off = workspaceNames(root).filter(item => !String(item.name).startsWith('@sixam/'));
    const server = existsSync(join(root, MCP_SERVER_FILE)) && /name: 'fnaf-solver'/.test(readFileSync(join(root, MCP_SERVER_FILE), 'utf8'));
    const named = rootName === 'fnaf-solver' && off.length === 0 && server;
    (named ? row.met : row.unmet).push(named ? 'the repository, every workspace and the MCP server carry fnaf-solver / @sixam/* names'
      : `names: package ${rootName}${off.length ? `, workspaces ${off.map(item => item.name).join(', ')}` : ''}${server ? '' : ', MCP server not fnaf-solver'}`);
    const truth = VERBS.some(verb => verb === 'rulebook' || verb.startsWith('truth'));
    (truth ? row.met : row.unmet).push(truth ? 'the solver interface answers a truth verb'
      : `Plan 28's truth.* verbs are not in the solver interface (its verbs: ${VERBS.join(', ')})`);
    row.state = row.unmet.length ? 'open' : unknown('every computed condition holds; a census naming its family per game is not queried');
    rows.set('S6', row);
  }

  // S7: the registers' gates; the morning report no record kind states.
  {
    const row = base(STEPS[6]);
    const register = readMistakes(root);
    const gates = mistakeGates(root);
    const lanes = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
    const inLane = file => CI_SCRIPTS.some(script => (lanes[script] ?? '').includes(file));
    if (!gates || !register.entries.length) row.unmet.push(`the register or ${MISTAKE_GATES_FILE}'s REGISTER_GATES could not be read`);
    else {
      const bare = register.entries.filter(entry => !(gates[entry.n] ?? []).some(inLane)).map(entry => entry.n);
      (bare.length ? row.unmet : row.met).push(bare.length
        ? `mistake entries ${bare.join(', ')} of ${register.entries.length} name no gate that runs in a CI lane (${register.source})`
        : `every one of ${register.entries.length} mistake entries names a gate a CI lane runs`);
    }
    row.state = row.unmet.length ? 'open'
      : unknown('a morning report that refutes an unqueued mechanism: no record kind states such a refutation');
    rows.set('S7', row);
  }
  return STEPS.map(step => rows.get(step.id));
}

/** A step's state as one word. @param {{state: any}} row */
export const stateKey = row => (typeof row.state === 'string' ? row.state : 'UNKNOWN');

export { stepFamily };
