// The consequence class of a change, told from its paths.
//
// CLAUDE.md, "Consequence lock": a commit is consequential if it retains a verifiable record that
// closes or advances a step of the path -- device evidence or a run pack, a promotion, a
// frame-traced twin or trace-equivalence record, a census that names its policy family and
// held-out block -- or code a gate exercises in the Companion, the controller, the trainer or the
// solver interface. Docs and plans alone, and gates, benchmarks, scaffolding and refactors that
// close no step, are bookkeeping. plans/ROADMAP.md, "What counts as consequential now", says the
// same.
//
// Paths tell part of that, and this reads only paths:
//
//   consequential  the change stages a record (RECORD_RULES), or code in one of the four areas
//                  together with a gate in the same change
//   bookkeeping    everything else that paths can tell: docs, plans, markdown, gates alone,
//                  generated catalogs, configuration, and code outside the four areas with no record
//   UNKNOWN        code in one of the four areas with no gate in the same change: whether an
//                  existing gate exercises it is not told from paths
//
// A reference to evidence from a prior commit (the hook's `EVIDENCE:<path>`) lets the hook accept
// a change; it does not make the change retain a record, so it never changes the class. Neither
// does the human override. This is not the hook: `.githooks/commit-msg` decides acceptance, and
// the lab runs the hook itself for that. It reads no file and runs nothing, so `lab commit --dry`
// classifies the staged set with it and `lab end` every commit since the session began.
import { WINNER_FILE, unknown } from '@sixam/kernel';

/** Where the definition is written. */
export const CONSEQUENCE_CITES = Object.freeze(['CLAUDE.md#consequence-lock-active-2026-09-06-loosened-2026-09-25',
  'plans/ROADMAP.md#what-counts-as-consequential-now']);

const README = /(?:^|\/)README\.md$/;

/** A path that retains a record. The first rule that matches names it. */
type PathTest = (path: string) => boolean;
export const RECORD_RULES = Object.freeze(([
  { id: 'run-pack', what: 'a run pack', test: path => path.startsWith('docs/evidence/runs/') },
  { id: 'promotion', what: 'the evidence graph (promotion edges)', test: path => path === 'docs/evidence/graph.json' },
  { id: 'evidence-record', what: 'an evidence record', test: path => path.startsWith('docs/evidence/') && !README.test(path) },
  { id: 'host-record', what: 'a host-side record', test: path => path.startsWith('tools/recompile/results/') && !README.test(path) },
  { id: 'winner', what: 'a committed winner', test: path => WINNER_FILE.test(path) },
  { id: 'staged-artifact', what: 'evidence staged under artifacts/', test: path => path.startsWith('artifacts/') },
] satisfies { id: string, what: string, test: PathTest }[]).map(rule => Object.freeze(rule)));

/** A gate: a test, a structural check, a hook or a CI workflow. */
const GATE = [
  /(?:^|\/)test[^/]*\.(?:mjs|js|cjs|ts|py|sh)$/,
  /(?:^|\/)[a-z0-9-]*test\.(?:mjs|js|py)$/,
  /\.test\.(?:mjs|js|ts)$/,
  /(?:^|\/)test\//,
  /^\.githooks\//,
  /^\.github\//,
  /^tools\/validate-references\.ts$/,
];

/** Bookkeeping by path: prose, plans, generated views, manifests and configuration. */
const BOOKKEEPING = [
  /^docs\//,
  /^plans\//,
  /\.md$/,
  /(?:^|\/)package(?:-lock)?\.json$/,
  /^tsconfig[^/]*\.json$/,
  /(?:^|\/)\.gitignore$/,
  /^\.(?:mailmap|gitattributes|editorconfig|nvmrc)$/,
  /^(?:NOTICE|LICENSE)(?:\.[a-z]+)?$/,
  /^LICENSES\//,
  /\.license$/,
  /^\.claude\//,
];

/** The four areas whose code counts when a gate exercises it. The first that matches names it. */
export const CODE_AREAS = Object.freeze(([
  { area: 'solver-interface', test: path => /^packages\/(?:review|kernel)\/src\//.test(path) || path.startsWith('apps/desktop/src/')
    || path === 'tools/evidence.js' },
  { area: 'companion', test: path => path.startsWith('android/companion/') },
  { area: 'trainer', test: path => path.startsWith('apps/trainer/') },
  // tools/device's code keeps its area as the ADR 0002 layout moves it: Play's executor and phone
  // tools (src/ and bin/), and the plans a phone executes (packages/propose/bin/plans/).
  { area: 'controller', test: path => path.startsWith('packages/play/') || path.startsWith('packages/propose/bin/plans/')
    || path.startsWith('tools/device/') },
] satisfies { area: string, test: PathTest }[]).map(rule => Object.freeze(rule)));

/**
 * What one path is: a record, a gate, bookkeeping, or code in an area (or in none of the four).
 * @param path repository-relative, forward slashes
 */
export function pathKind(path: string): {kind: 'record', rule: string, what: string} | {kind: 'gate'} | {kind: 'bookkeeping'} | {kind: 'code', area: string | null} {
  const record = RECORD_RULES.find(rule => rule.test(path));
  if (record) return { kind: 'record', rule: record.id, what: record.what };
  if (GATE.some(pattern => pattern.test(path))) return { kind: 'gate' };
  if (BOOKKEEPING.some(pattern => pattern.test(path))) return { kind: 'bookkeeping' };
  return { kind: 'code', area: CODE_AREAS.find(rule => rule.test(path))?.area ?? null };
}

const list = (items: readonly string[]) => (items.length <= 3 ? items.join(', ') : `${items.slice(0, 3).join(', ')} and ${items.length - 3} more`);

/**
 * The consequence class of one change: `consequence` is `consequential`, `bookkeeping` or
 * UNKNOWN(reason), and `because` says which rule decided it.
 * @param paths every path the change touches
 */
export function classifyChange(paths: string[]) {
  const rows = [...new Set(paths)].sort().map(path => ({ path, ...pathKind(path) }));
  const records = rows.filter(row => row.kind === 'record');
  const gates = rows.filter(row => row.kind === 'gate').map(row => row.path);
  const code = rows.filter(row => row.kind === 'code');
  const areaCode = code.filter(row => row.area);
  const areas = [...new Set(areaCode.map(row => row.area))].sort();
  const summary = {
    records: records.map(row => ({ path: row.path, rule: row.rule })), gates, areas,
    counts: { paths: rows.length, records: records.length, gates: gates.length, code: code.length, areaCode: areaCode.length,
      otherCode: code.length - areaCode.length, bookkeeping: rows.filter(row => row.kind === 'bookkeeping').length },
  };
  if (!rows.length) return { consequence: 'bookkeeping', because: 'no path changed', ...summary };
  if (records.length) {
    const kinds = [...new Set(records.map(row => row.what))];
    return { consequence: 'consequential', because: `retains ${kinds.join(' and ')}: ${list(records.map(row => row.path))}`, ...summary };
  }
  if (areaCode.length && gates.length)
    return { consequence: 'consequential', because: `code in the ${areas.join(', ')} with a gate in the same change (${list(gates)})`, ...summary };
  if (areaCode.length)
    return { consequence: unknown(`code in the ${areas.join(', ')} changed with no gate in the same change (${list(areaCode.map(row => row.path))}); ` +
      'whether an existing gate exercises it is not told from paths'), because: 'code in an area with no gate beside it', ...summary };
  const what = [...new Set(rows.map(row => (row.kind === 'code' ? 'code outside the four areas' : row.kind === 'gate' ? 'gates' : 'docs, plans or configuration')))];
  return { consequence: 'bookkeeping', because: `no record, and ${what.join(' and ')} only`, ...summary };
}

/** The class as one word: consequential, bookkeeping or UNKNOWN. */
export const consequenceKey = (result: ReturnType<typeof classifyChange>) => (typeof result.consequence === 'string' ? result.consequence : 'UNKNOWN');
