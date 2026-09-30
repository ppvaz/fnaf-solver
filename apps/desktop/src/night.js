#!/usr/bin/env node
// One entry point for a night on the phone, whatever the game.
//
//   npm run night -- fnaf2 --label NAME [--live --confirm-live] [night-run.sh options]
//   npm run night -- fnaf1 --night N [--live --confirm-live] [fnaf1-night-run.sh options]
//   npm run night -- fnaf1-custom --mode M [--live --confirm-live] [fnaf1-custom-run.sh options]
//   npm run night -- fnaf1-winner --winner FILE [--live --confirm-live --label NAME]
//
// Every runner is dry unless it is given --live --confirm-live (Pedro,
// 2026-09-29; ADR 0002): without the pair it prints what it would run and
// touches no phone. A live night reads the handset serial from FNAF_SERIAL or
// the untracked local profile (tools/device/local-profile.mjs) and refuses
// without one. Each game keeps its own runner -- they differ in what they
// drive, and each takes the serial lease before its first adb call.
//
// This only picks the runner, passes the arguments through untouched, and
// packs what the night left behind (packages/review/src/evidence-pack.mjs) once it ends,
// however it ends: a death, an abort and a Ctrl-C are evidence too. night-run.sh
// packs its own campaigns, so FNaF 2 is only dispatched; the FNaF 1 runners do
// not, so their new run directories are packed here. A FNaF 1 dry run leaves no
// run directory and so packs nothing.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const GAMES = Object.freeze({
  fnaf2: { runner: 'tools/device/night-run.sh', packs: null },
  fnaf1: { runner: 'tools/device/fnaf1-night-run.sh', packs: /^fnaf1-night\d+-/ },
  'fnaf1-custom': { runner: 'tools/device/fnaf1-custom-run.sh', packs: /^fnaf1-custom-/ },
  // A committed FNaF 1 winner, re-run from its pinned commit (fnaf1-winner.mjs).
  'fnaf1-winner': { runner: 'tools/device/fnaf1-winner.mjs', packs: /^fnaf1-custom-/ },
});

const runDirs = root => {
  const dir = join(root, 'artifacts', 'runs');
  return new Set(existsSync(dir) ? readdirSync(dir) : []);
};

/**
 * Run one night and pack the run directories it created.
 * @param {string} game a key of GAMES
 * @param {string[]} args passed to the runner untouched
 * @param {{root?: string, pack?: (root: string, id: string) => Promise<number>}} [options]
 * @returns {Promise<{status: number, packed: string[]}>}
 */
export async function runNight(game, args, { root = ROOT, pack = packRun } = {}) {
  const entry = GAMES[game];
  if (!entry) throw new Error(`unknown game ${JSON.stringify(game)}; one of ${Object.keys(GAMES).join(', ')}`);
  const before = runDirs(root);
  const child = spawn(join(root, entry.runner), args, { cwd: root, stdio: 'inherit' });
  // Ctrl-C reaches the runner through the terminal's process group; this waits
  // for it to finish its own abort and reset, then packs what it left.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  const status = await new Promise((done, failed) => {
    child.on('error', failed);
    child.on('close', (code, signal) => done(code ?? (signal ? 128 : 1)));
  }).finally(() => process.off('SIGINT', ignore));
  const packed = [];
  if (entry.packs) {
    for (const id of [...runDirs(root)].filter(id => !before.has(id) && entry.packs.test(id)).sort()) {
      const rc = await pack(root, id);
      if (rc !== 0) console.error(`night: packing ${id} failed (${rc}); pack it with npm run evidence -- pack ${id}`);
      else packed.push(id);
    }
  }
  return { status, packed };
}

function packRun(root, id) {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [join(root, 'tools/evidence.js'), 'pack', id], { cwd: root, stdio: 'inherit' });
    child.on('error', failed);
    child.on('close', code => done(code ?? 1));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [game, ...args] = process.argv.slice(2);
  if (!game || game === '--help' || game === '-h') {
    console.log(`Usage: npm run night -- <${Object.keys(GAMES).join('|')}> [runner options]\n`
      + 'Runs that game\'s night runner with the options as given, then packs the run.\n'
      + 'Every runner is dry unless given --live --confirm-live.');
    process.exit(game ? 0 : 2);
  }
  try {
    const { status } = await runNight(game, args);
    process.exit(status);
  } catch (error) {
    console.error(`night: ${error.message}`);
    process.exit(2);
  }
}
