#!/usr/bin/env node
// The test lanes as data. tools/lanes.json names each lane's node test files and its other steps
// (Python, shell, a node script with arguments, another lane); `npm run test:<lane>` runs the lane here.
// The node files go through Node's test runner, one process each: a file that exits 0 passes, a file
// using node:test reports its own tests, and the summary names every failure, so a red lane no longer
// stops at its first failing file. Then the other steps run in order.
//
//   node tools/lanes.ts LANE [--concurrency N] [--only TEXT] [--list]
//
// --only keeps the files and steps whose text contains TEXT; --list prints them and runs nothing.
// The gates that ask what CI runs (tools/test-mistake-register.ts, the grade-run coverage gate, Review's
// roadmap, the push gate) read this table rather than package.json's command lines, through Review's
// checked reader (packages/review/src/lanes.ts).
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Lane, readLanes } from '@sixam/review/lanes';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** How many of a lane's files and steps, its nested lanes' included, keep selects. */
function selected(lanes: Readonly<Record<string, Lane>>, name: string, keep: (text: string) => boolean): number {
  const lane = lanes[name];
  return lane.node.filter(keep).length
    + lane.steps.reduce((sum, step) => sum + (step[0] === 'lane' ? selected(lanes, step[1], keep) : Number(keep(step.join(' ')))), 0);
}

function main(argv: string[]) {
  const [name, ...rest] = argv;
  const lanes = readLanes(ROOT);
  const lane = name === undefined ? undefined : lanes[name];
  if (name === undefined || !lane) {
    console.error(`usage: node tools/lanes.ts LANE [--concurrency N] [--only TEXT] [--list]; lanes: ${Object.keys(lanes).join(', ')}`);
    return 2;
  }
  const flag = (key: string) => { const at = rest.indexOf(key); return at >= 0 ? rest[at + 1] : undefined; };
  const only = flag('--only');
  const concurrency = Number(flag('--concurrency') ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1) { console.error('--concurrency is a positive integer'); return 2; }
  const keep = (text: string) => only === undefined || text.includes(only);
  if (only !== undefined && !selected(lanes, name, keep)) {
    console.error(`lane ${name}: --only ${only} selects no file or step, its nested lanes' included`);
    return 2;
  }
  const files = lane.node.filter(keep);
  const steps = lane.steps.filter(step => (step[0] === 'lane' ? selected(lanes, step[1], keep) > 0 : keep(step.join(' '))));
  if (rest.includes('--list')) {
    for (const file of files) console.log(`node --test ${file}`);
    for (const step of steps) console.log(step.join(' '));
    return 0;
  }
  const failed: string[] = [];
  if (files.length) {
    const run = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, '--test-reporter=spec', ...files],
      { cwd: ROOT, stdio: 'inherit' });
    if (run.status !== 0) failed.push(`${files.length} node test files (the summary above names each failure)`);
  }
  for (const step of steps) {
    const argv = step[0] === 'lane' ? [process.execPath, fileURLToPath(import.meta.url), step[1], ...rest] : [...step];
    console.log(`\n▶ ${step.join(' ')}`);
    const run = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, stdio: 'inherit' });
    if (run.status !== 0) failed.push(step.join(' '));
  }
  if (failed.length) {
    console.error(`\nlane ${name}: ${failed.length} failed:\n${failed.map(item => `  ✖ ${item}`).join('\n')}`);
    return 1;
  }
  console.log(`\nlane ${name}: ${files.length} node test files and ${steps.length} steps pass`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
