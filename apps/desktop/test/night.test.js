// The one night entry point (apps/desktop/src/night.js), against fake runners in a
// throwaway tree: arguments reach the runner untouched, the FNaF 1 run
// directories a night creates are packed however it exits, directories that
// were already there or belong to another game are not, and FNaF 2 -- whose
// runner packs its own campaigns -- is only dispatched.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAMES, runNight } from '../src/night.js';

const root = mkdtempSync(join(tmpdir(), 'night-test-'));
const runner = (path, body) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), `#!/bin/sh\n${body}\n`);
  chmodSync(join(root, path), 0o755);
};
try {
  mkdirSync(join(root, 'artifacts/runs/fnaf1-night4-old-20260101T000000Z'), { recursive: true });
  runner(GAMES.fnaf1.runner, [
    'printf "%s\\n" "$@" > args.txt',
    'mkdir -p artifacts/runs/fnaf1-night4-new-20260925T000000Z artifacts/runs/night6-other-20260925T000000Z',
    'exit 3',
  ].join('\n'));
  runner(GAMES.fnaf2.runner, 'mkdir -p artifacts/runs/night7-k3-20260925T000000Z\nexit 0');
  runner(GAMES['fnaf1-custom'].runner, 'exit 0');

  const packed = [];
  const pack = async (_root, id) => { packed.push(id); return 0; };
  const fnaf1 = await runNight('fnaf1', ['--night', '4', '--label', 'a b'], { root, pack });
  assert.equal(fnaf1.status, 3, 'the runner\'s own exit status is the launcher\'s');
  assert.deepEqual(readFileSync(join(root, 'args.txt'), 'utf8').split('\n').filter(Boolean),
    ['--night', '4', '--label', 'a b'], 'arguments reach the runner untouched');
  assert.deepEqual(packed, ['fnaf1-night4-new-20260925T000000Z'],
    'a death or abort is packed too, and only the new FNaF 1 directory');

  packed.length = 0;
  const fnaf2 = await runNight('fnaf2', ['--dry-run'], { root, pack });
  assert.equal(fnaf2.status, 0);
  assert.deepEqual(packed, [], 'night-run.sh packs its own campaigns');

  const dry = await runNight('fnaf1-custom', ['--dry-run'], { root, pack });
  assert.deepEqual(dry.packed, [], 'a dry run leaves no run directory and packs nothing');

  assert.equal(GAMES['fnaf1-winner'].runner, 'packages/play/games/fnaf1/fnaf1-winner.mjs',
    'a committed FNaF 1 winner is re-run from its pinned commit, not by the tree\'s runner');
  assert.ok(GAMES['fnaf1-winner'].packs.test('fnaf1-custom-grid420-replay-20260927T000000Z'), 'and its run is packed');

  await assert.rejects(runNight('fnaf9', [], { root, pack }), /unknown game/);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('night: the launcher passes arguments through, packs the FNaF 1 runs a night created however it ends, and leaves FNaF 2 to its runner');
