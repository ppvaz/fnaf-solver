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
// Needs the pinned commits in the clone: CI checks out with fetch-depth: 0,
// and a shallow clone fails here by name rather than skipping.
//
//   node tools/device/test-fnaf1-winner.mjs
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAMES } from '../night.mjs';
import { ROOT, RUNNER, listWinners, shapeProblems, pinsAtCommit, pinnedCommit, routeDrift, materialize, removeTree,
  treeProblems, replayArguments, replayInvocation, sha256 } from './fnaf1-winner.mjs';

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
    ok(`${path}: the pinned runner skips its own lease and shares this checkout's lock dir`,
      plan.args.includes('FNAF1_LEASE_HELD=1') && plan.args.includes(`CUE_HELPER_LOCK_DIR=${join(ROOT, 'captures/cue-helper/locks')}`));
    const won = winner.command.trim().split(/\s+/).slice(1).map((t) => (t.startsWith('~/') ? `/home/gate/${t.slice(2)}` : t));
    const labelAt = won.indexOf('--label');
    eq(`${path}: the replay passes the won command's arguments, only the label changed`,
      plan.runnerArgs.filter((_, i) => i !== labelAt + 1), won.filter((_, i) => i !== labelAt + 1));
    // The workspace packages the pinned runner imports resolve inside the pinned tree.
    const cueHelper = createRequire(join(tree, 'apps/device/src/physical-ports.js')).resolve('@fnaf2-1020/adapters/transports/cue-helper');
    ok(`${path}: @fnaf2-1020/adapters resolves inside the pinned tree, not this checkout (${cueHelper})`,
      !relative(tree, cueHelper).startsWith('..'));
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

    rows.push(`${path.padEnd(58)} ${commit.slice(0, 12)}  ${built.files} files  ${Object.keys(built.sources).length} pins` +
      `  tree drift: ${drift.length ? drift.join(', ') : 'none'}`);

    // 4. Controls on the materialized tree: each tamper is refused for its own reason.
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
      symlinkSync(join(ROOT, 'packages/adapters'), link);
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
} finally {
  for (const name of readdirSync(scratch)) if (name.startsWith('tree-')) removeTree(join(scratch, name));
  rmSync(scratch, { recursive: true, force: true });
}

function treeOptions(winner) {
  return { mode: winner.resolvedOptions.policy, dials: winner.night.dials, winner: null, route: null };
}

if (failures.length) {
  console.error(`fnaf1 winner: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(rows.join('\n'));
console.log(`fnaf1 winner: all ${checks} checks passed; every committed FNaF 1 route winner re-runs its pinned route ` +
  'byte for byte, and the tree refuses its night while it differs');
