#!/usr/bin/env node
// A committed FNaF 1 route winner re-runs the route that won, or nothing runs.
//
// On 2026-09-25 grid420 reached 6 AM at 4/20 (420-a) with the lane file and
// runner of 3aaf02c, and the winner pinned their sha256. e6de745 then changed
// both, and the winner's `command`, run from the tree, silently executed the
// new route. The property this gate holds, for every committed
// `fnaf1-route-winner-v1`:
//
//   whatever way a re-run of the winner takes, the route it executes is the
//   pinned one byte for byte, or it executes nothing.
//
// There are two ways: the replay (fnaf1-winner.mjs), which materializes the
// pinned commit's tree and runs that tree's runner, and the tree's own runner
// given the winner's night, whose routeStatus must refuse while the tree
// differs from the pins. Each is checked, and so is the old behaviour -- a
// tree runner with no guard -- which must FAIL the property (it did: the lane
// and the runner both differ). Controls then tamper a materialized tree and a
// winner and require the stated refusal, and a winner whose pins the tree
// does hold must run from the tree, so the guard is not a blanket refusal.
//
// A winner also names the census of its own route (`census`): its pinned
// grid420, imported from the materialized commit, with the options its runner
// passed -- not the tree's grid420 with the model's defaults. That record must
// describe this winner and still replay as recorded.
//
// Needs the pinned commits in the clone: CI checks out with fetch-depth: 0,
// and a shallow clone fails here by name rather than skipping.
//
//   node tools/device/test-fnaf1-winner.mjs
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAMES } from '../../apps/desktop/src/night.js';
import { designBlock } from '../winner-census.mjs';
import { FOUR_TWENTY, LANE_FILE, POPULATION_KIND, POPULATION_LANES, TIMING_PATH, loadTiming, newestTreeRecord,
  pinnedGrid420, runDeviceNight, winnerPolicyOptions } from '../fnaf1-device-lane.mjs';
import { ROOT, RUNNER, listWinners, shapeProblems, pinsAtCommit, pinnedCommit, routeDrift, materialize, removeTree,
  treeProblems, replayArguments, replayInvocation, sha256, sharedLockDir, winnerCustody } from './fnaf1-winner.mjs';

const failures = [];
let checks = 0;
const ok = (what, condition) => { checks += 1; if (!condition) failures.push(what); };
const eq = (what, a, b) => {
  checks += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const throws = (what, fn, pattern) => {
  checks += 1;
  try { fn(); failures.push(`${what}: did not refuse`); } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${what}: refused for another reason: ${error.message}`);
  }
};
const RUNNER_MJS = RUNNER.replace(/\.sh$/, '.mjs');
const treeHash = (path) => { try { return sha256(readFileSync(join(ROOT, path))); } catch { return null; } };

/**
 * The route a re-run of `winner` by way of the tree's runner executes: null
 * when the runner refuses (nothing runs), else the tree's bytes. `guard` is
 * the runner's routeStatus; the old runner had none.
 */
function treeRunExecutes(entry, guard) {
  const { winner } = entry;
  const tokens = replayArguments(winner, { label: 'gate', home: '/home/gate' });
  const options = { mode: tokens[tokens.indexOf('--mode') + 1], winner: null, route: null,
    dials: Object.fromEntries(['freddy', 'bonnie', 'chica', 'foxy'].map((d, i) =>
      [d, Number(tokens[tokens.indexOf('--dials') + 1].split(',')[i])])) };
  const status = guard ? guard(options, { winners: [entry] }) : null;
  if (status?.refusal) return { executes: null, refusal: status.refusal };
  return { executes: Object.fromEntries(Object.keys(winner.sources).map((path) => [path, treeHash(path)])), refusal: null };
}
const differsFromPins = (winner, executes) => Object.keys(winner.sources).filter((path) => executes[path] !== winner.sources[path]);

const runnerModule = await import('./fnaf1-custom-run.mjs');
const guard = runnerModule.routeStatus ?? null;
ok('the tree\'s FNaF 1 Custom Night runner exports routeStatus, its guard against running a drifted winner\'s night', Boolean(guard));

const winners = listWinners();
ok('at least one fnaf1-route-winner-v1 is committed', winners.length > 0);
const scratch = mkdtempSync(join(tmpdir(), 'test-fnaf1-winner-'));
const rows = [];
try {
  for (const [n, entry] of winners.entries()) {
    const { path, winner } = entry;
    // 1. The tree's runner, given the winner's night, executes the pinned route or nothing.
    //    This needs only the pins and the command, so it runs whatever else is wrong.
    const drift = routeDrift(winner).map((d) => d.path);
    const viaTree = treeRunExecutes(entry, guard);
    ok(`${path}: a re-run from the tree executes the pinned route or nothing` +
      (viaTree.executes ? ` (it executes ${differsFromPins(winner, viaTree.executes).join(', ')} unpinned)` : ''),
      viaTree.executes === null || differsFromPins(winner, viaTree.executes).length === 0);
    if (drift.length) {
      ok(`${path}: the refusal names every drifted file and the replay`, Boolean(viaTree.refusal)
        && drift.every((p) => viaTree.refusal.includes(p)) && viaTree.refusal.includes(`fnaf1-winner --winner ${path}`));
      // The old behaviour: no guard, so the tree's bytes run under the winner's name. The property must catch it.
      const unguarded = treeRunExecutes(entry, null);
      eq(`${path}: control -- the old unguarded runner executes the drifted files, and the property fails it`,
        differsFromPins(winner, unguarded.executes), drift);
      if (guard) {
        const knowing = guard({ ...treeOptions(winner), route: 'tree' }, { winners: [entry] });
        ok(`${path}: --route tree runs the tree's route knowingly and records that it is not the winner's`,
          knowing.refusal === null && knowing.winner.matches === false && knowing.route === 'tree');
        const byName = guard({ ...treeOptions(winner), winner: join(ROOT, path) }, { winners: [entry] });
        ok(`${path}: --winner is refused while the tree drifts, with no way round but the replay`,
          Boolean(byName.refusal) && !byName.refusal.includes('--route tree'));
      }
    }
    const shape = shapeProblems(winner);
    eq(`${path}: states what a replay needs`, shape, []);
    if (shape.length) continue;
    let commit;
    try { commit = pinnedCommit(winner); } catch (error) { failures.push(error.message); checks += 1; continue; }

    // 2. The pins are what the commit holds.
    for (const pin of pinsAtCommit(winner)) ok(`${path}: ${pin.path} at ${commit.slice(0, 12)} is the pinned file`, pin.ok);

    // 3. The replay executes the pinned tree.
    const tree = join(scratch, `tree-${n}`);
    const outputs = join(scratch, `out-${n}`);
    let built = null;
    try { built = materialize(winner, tree, { outputs }); } catch (error) { failures.push(error.message); checks += 1; continue; }
    eq(`${path}: the materialized tree is the commit, file for file`, treeProblems(tree, commit), []);
    const executes = Object.fromEntries(Object.keys(winner.sources).map((p) => [p, sha256(readFileSync(join(tree, p)))]));
    eq(`${path}: the replay executes the pinned route`, differsFromPins(winner, executes), []);
    const plan = replayInvocation(winner, { tree, serial: winner.target.device, label: 'gate', env: {}, home: '/home/gate' });
    eq(`${path}: the replay's lease is this checkout's`, plan.args.slice(0, 3), [join(ROOT, 'tools/device/device-lock-exec.py'), winner.target.device, '--']);
    const runAt = plan.args.indexOf(join(tree, RUNNER));
    ok(`${path}: the process under the lease is the pinned tree's runner`, runAt > 0 && !relative(tree, plan.args[runAt]).startsWith('..'));
    ok(`${path}: the pinned runner skips its own lease and shares the host-wide lock dir (the main checkout's)`,
      plan.args.includes('FNAF1_LEASE_HELD=1') && plan.args.includes(`CUE_HELPER_LOCK_DIR=${sharedLockDir(ROOT, {})}`)
      && sharedLockDir(ROOT, {}).endsWith('captures/cue-helper/locks'));
    const won = winner.command.trim().split(/\s+/).slice(1).map((t) => (t.startsWith('~/') ? `/home/gate/${t.slice(2)}` : t));
    const labelAt = won.indexOf('--label');
    eq(`${path}: the replay passes the won command's arguments, only the label changed`,
      plan.runnerArgs.filter((_, i) => i !== labelAt + 1), won.filter((_, i) => i !== labelAt + 1));
    // The workspace packages the pinned runner imports resolve inside the pinned tree.
    // The pinned tree predates the @sixam scope (Plan 27 commit A), so it links its own
    // @fnaf2-1020 workspace names; these strings name that tree's packages, not this checkout's.
    const cueHelper = createRequire(join(tree, 'apps/device/src/physical-ports.js')).resolve('@fnaf2-1020/adapters/transports/cue-helper');
    ok(`${path}: @fnaf2-1020/adapters resolves inside the pinned tree, not this checkout (${cueHelper})`,
      // Against the tree's real path, as fnaf1-winner.mjs checks its links: macOS's temporary
      // directory sits under /var -> /private/var, and resolve() answers with the real one.
      !relative(realpathSync(tree), cueHelper).startsWith('..'));
    // The pinned runner's own parser turns the replay's arguments into the options that won.
    const pinnedRunner = await import(pathToFileURL(join(tree, RUNNER_MJS)).href);
    const parsed = pinnedRunner.parseArgs(plan.runnerArgs);
    const r = winner.resolvedOptions;
    eq(`${path}: the pinned runner reads the replay as the won night`,
      [parsed.mode, parsed.dials, parsed.chicaByCamera, parsed.originOffsetMs, parsed.stopAfterMs, parsed.live && parsed.confirmLive],
      [r.policy, winner.night.dials, r.chicaByCamera, r.originOffsetMs, r.stopAfterMs, true]);
    ok(`${path}: its replay.command is the night launcher's fnaf1-winner with this very file`,
      String(winner.replay?.command).startsWith(`npm run night -- fnaf1-winner --winner ${path} `));
    eq('npm run night -- fnaf1-winner runs the replay', GAMES['fnaf1-winner']?.runner, 'tools/device/fnaf1-winner.mjs');

    // 4. The winner names a census of its own route -- its pinned grid420 with the
    //    options its runner passed -- and that census still replays as recorded.
    const policy = await pinnedGrid420(tree);
    const census = censusProblems(path, winner, commit, policy);
    checks += census.checked;
    failures.push(...census.problems);

    rows.push(`${path.padEnd(58)} ${commit.slice(0, 12)}  ${built.files} files  ${Object.keys(built.sources).length} pins` +
      `  tree drift: ${drift.length ? drift.join(', ') : 'none'}${census.summary}`);

    // Controls on the census: each wrong census is refused for its own reason.
    if (n === 0 && typeof winner.census === 'string' && !census.problems.length) {
      const own = JSON.parse(readFileSync(join(ROOT, 'docs/evidence', `${winner.census}.json`), 'utf8'));
      const refuses = (what, pattern, options) => {
        const { problems } = censusProblems(path, winner, commit, policy, options);
        ok(`control -- ${what} is refused${problems.length ? ` for its own reason (got: ${problems.join('; ')})` : ''}`,
          problems.length > 0 && problems.every((p) => pattern.test(p)));
      };
      refuses('a winner naming no census', /names the census of its own route/, { id: null });
      const treeCensus = newestTreeRecord();
      if (treeCensus) refuses(`naming the tree route's census (${treeCensus.id})`, /censuses this winner's pinned grid420/,
        { id: treeCensus.id, replay: false });
      const edited = (edit) => { const copy = JSON.parse(JSON.stringify(own)); edit(copy); return copy; };
      refuses('a census run with the model\'s default options', /with the options this winner's runner passed/,
        { record: edited((r) => { r.method.options = { chicaByCamera: true }; }), replay: false });
      const worst = own.lanes.findIndex((l) => l.losses.length > 0);
      refuses('a census whose first listed loss is a frame off', /replays as recorded/,
        { record: edited((r) => { r.lanes[worst].losses[0][2] += 1; }) });
      refuses('a census whose wins do not add up', /counts add up/,
        { record: edited((r) => { r.lanes[worst].heldOut.wins += 1; }), replay: false });
    }

    // 5. Controls on the materialized tree: each tamper is refused for its own reason.
    if (n === 0) {
      const lane = join(tree, 'tools/fnaf1-device-lane.mjs');
      const original = readFileSync(lane);
      writeFileSync(lane, Buffer.concat([original, Buffer.from('\n')]));
      ok('control -- one byte appended to the pinned lane file is named', treeProblems(tree, commit)
        .some((p) => p.startsWith('tools/fnaf1-device-lane.mjs: content differs')));
      writeFileSync(lane, original);
      const sh = join(tree, RUNNER);
      chmodSync(sh, 0o644);
      ok('control -- a runner that lost its executable bit is named', treeProblems(tree, commit)
        .some((p) => p.startsWith(`${RUNNER}: executable bit`)));
      chmodSync(sh, 0o755);
      const link = join(tree, 'node_modules/@fnaf2-1020/adapters');
      unlinkSync(link);
      symlinkSync(join(ROOT, 'packages/play'), link);
      ok('control -- a workspace link into this checkout is named', treeProblems(tree, commit)
        .some((p) => p.startsWith('node_modules/@fnaf2-1020/adapters resolves outside the tree')));
      eq('control -- the tree is whole again once the tampering is undone', (() => {
        unlinkSync(link); symlinkSync('../../packages/adapters', link); return treeProblems(tree, commit);
      })(), []);
      const wrongPin = { ...winner, sources: { ...winner.sources, 'tools/fnaf1-device-lane.mjs': treeHash('tools/fnaf1-device-lane.mjs') } };
      if (wrongPin.sources['tools/fnaf1-device-lane.mjs'] !== winner.sources['tools/fnaf1-device-lane.mjs'])
        throws('control -- a pin the commit does not hold refuses the materialization', () => materialize(wrongPin, join(scratch, 'wrong')),
          /tools\/fnaf1-device-lane\.mjs: the commit holds/);
      throws('control -- an abbreviated sourcesAtCommit is refused', () => pinnedCommit({ ...winner, sourcesAtCommit: commit.slice(0, 7) }),
        /not a full commit id/);
      throws('control -- a commit this clone lacks is refused by name', () => pinnedCommit({ ...winner, sourcesAtCommit: 'f'.repeat(40) }),
        /not in this clone/);
      throws('control -- a command with shell syntax is not interpreted',
        () => replayArguments({ ...winner, command: `${winner.command} ; rm -rf ~` }), /shell syntax/);
      throws('control -- a command naming another runner is not replayed',
        () => replayArguments({ ...winner, command: winner.command.replace(RUNNER, 'tools/device/night-run.sh') }), /not tools\/device\/fnaf1-custom-run\.sh/);
      // A winner whose pins the tree holds runs from the tree: the guard is not a blanket refusal.
      if (guard) {
        const held = { ...winner, sources: Object.fromEntries(Object.keys(winner.sources).map((p) => [p, treeHash(p)])) };
        const status = guard(treeOptions(held), { winners: [{ path, winner: held }] });
        ok('control -- a winner whose pins the tree still holds runs from the tree, and is recorded as matching',
          status.refusal === null && status.winner.matches === true);
        const other = guard({ ...treeOptions(winner), dials: { freddy: 0, bonnie: 20, chica: 20, foxy: 0 } }, { winners: [entry] });
        ok('control -- a grid420 night no winner names runs from the tree with its route recorded',
          other.refusal === null && other.winner === null && Object.keys(other.files).length > 0);
      }
    }
  }
  // A live replay runs only the winner file the repository holds: untracked,
  // committed and locally edited are told apart (in a scratch repository, by
  // plumbing, so no hook and no identity of this checkout is involved; a
  // GIT_DIR or GIT_INDEX_FILE inherited from a hook must never aim these
  // writes at the real repository).
  const repo = join(scratch, 'custody');
  mkdirSync(repo);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@invalid', GIT_COMMITTER_NAME: 'gate', GIT_COMMITTER_EMAIL: 'gate@invalid' };
  const g = (...args) => execFileSync('git', ['-C', repo, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
  g('init', '-q');
  writeFileSync(join(repo, 'w-winner.json'), '{}\n');
  const custody = [winnerCustody('w-winner.json', repo)];
  g('update-index', '--add', 'w-winner.json');
  g('update-ref', 'HEAD', g('commit-tree', g('write-tree'), '-m', 'custody'));
  custody.push(winnerCustody('w-winner.json', repo));
  appendFileSync(join(repo, 'w-winner.json'), ' ');
  custody.push(winnerCustody('w-winner.json', repo));
  eq('control -- winner custody tells an untracked, a committed and a locally edited winner apart',
    custody, ['UNTRACKED', 'COMMITTED', 'MODIFIED']);
} finally {
  for (const name of readdirSync(scratch)) if (name.startsWith('tree-')) removeTree(join(scratch, name));
  rmSync(scratch, { recursive: true, force: true });
}

function treeOptions(winner) {
  return { mode: winner.resolvedOptions.policy, dials: winner.night.dials, winner: null, route: null };
}

/**
 * The census record a winner names (`census`: an evidence id under
 * docs/evidence): it must be of this winner's pinned policy at its commit,
 * with the options its runner passed, on today's timing model and design
 * block; its counts must add up; and its first listed losses per lane, and a
 * few held-out wins of every fully listed lane, must replay as recorded with
 * the pinned grid420. Returns the problems rather than failing, so a control
 * can require the refusal of a census that is not this winner's.
 */
function censusProblems(path, winner, commit, policy, { id = winner.census, record = null, replay = true } = {}) {
  const problems = [];
  let checked = 0;
  const pass = (what, condition) => { checked += 1; if (!condition) problems.push(what); };
  const same = (what, a, b) => pass(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    JSON.stringify(a) === JSON.stringify(b));
  const done = (summary) => ({ problems, checked, summary });
  pass(`${path}: names the census of its own route (census: an evidence id)`, typeof id === 'string' && /^[\w.-]+$/.test(id));
  if (typeof id !== 'string') return done('');
  if (!record) {
    try { record = JSON.parse(readFileSync(join(ROOT, 'docs/evidence', `${id}.json`), 'utf8')); } catch {
      pass(`${path}: its census ${id} is not docs/evidence/${id}.json`, false);
      return done('');
    }
  }
  const m = record.method ?? {};
  same(`${id}: kind and id`, [record.kind, record.id, record.claimLevel], [POPULATION_KIND, id, 'MODEL_ONLY']);
  same(`${id}: censuses this winner's pinned grid420 at its commit`,
    [m.winner?.path, m.winner?.id, m.winner?.commit, m.policySha256], [path, winner.id, commit, winner.sources[LANE_FILE]]);
  same(`${id}: with the options this winner's runner passed`, m.options, winnerPolicyOptions(winner));
  pass(`${id}: the timing model changed since; re-run the winner census`, m.timingSha256 === sha256(readFileSync(TIMING_PATH)));
  const design = designBlock();
  pass(`${id}: the design block no longer rebuilds`, m.designBlock?.sha256 === sha256(JSON.stringify(design.seeds)));
  same(`${id}: lanes`, (record.lanes ?? []).map((l) => l.lane), [...POPULATION_LANES]);
  const inDesign = new Set(design.seeds);
  const { start, count } = m.population ?? {};
  const timing = loadTiming();
  const night = (seed, lane) => runDeviceNight({ night: 7, seed, custom: FOUR_TWENTY, timing, lane, policy, options: { ...m.options } });
  let replays = 0;
  for (const row of record.lanes ?? []) {
    const lost = row.n - row.wins;
    pass(`${id} ${row.lane}: counts add up`, row.n === count && row.design.n === m.designBlock?.inCensus
      && row.heldOut.n === m.heldOutBlock?.n && row.design.n + row.heldOut.n === row.n
      && row.design.wins + row.heldOut.wins === row.wins
      && Object.values(row.deaths ?? {}).reduce((a, b) => a + b, 0) === lost
      && row.losses.length === row.lossesListed && row.lossesListed <= lost
      && (row.lossesListed < lost || sha256(JSON.stringify(row.losses)) === row.lossesSha256));
    if (!replay) continue;
    for (const [seed, outcome, frames] of row.losses.slice(0, 5)) {
      const r = night(seed, row.lane);
      replays += 1;
      same(`${id} ${row.lane} seed ${seed} replays as recorded`, [r.outcome, r.frames], [outcome, frames]);
    }
    if (row.lossesListed === lost) {
      const listed = new Set(row.losses.map(([seed]) => seed));
      let taken = 0;
      for (let k = 0; taken < 2 && k < count; k += 1) {
        const seed = start + ((k * 40503 + row.lane.length * 977) % count);
        if (inDesign.has(seed)) continue;
        taken += 1; replays += 1;
        same(`${id} ${row.lane} held-out seed ${seed} replays as recorded`, night(seed, row.lane).outcome === '6AM', !listed.has(seed));
      }
    }
  }
  return done(`\n  census ${id}: ${(record.lanes ?? []).map((l) => `${l.lane} ${l.wins}/${l.n}`).join(', ')} (${replays} replays)`);
}

if (failures.length) {
  console.error(`fnaf1 winner: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(rows.join('\n'));
console.log(`fnaf1 winner: all ${checks} checks passed; every committed FNaF 1 route winner re-runs its pinned route ` +
  'byte for byte, and the tree refuses its night while it differs');
