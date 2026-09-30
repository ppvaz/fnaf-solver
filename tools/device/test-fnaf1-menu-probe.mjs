#!/usr/bin/env node
// Phone-free gate for fnaf1-menu-probe.mjs: what it will accept as a live
// request, the dial walk it computes, and the one combination it must never
// leave on the Custom Night screen.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs, parseTargets, stepsBetween } from './fnaf1-menu-probe.mjs';

const refuses = (argv, pattern) => assert.throws(() => parseArgs(argv), pattern);
assert.equal(parseArgs(['--stage', 'title']).dryRun, true, 'no --live is a dry run (ADR 0002)');
refuses(['--live', '--stage', 'title'], /--live and --confirm-live/);
refuses(['--live', '--confirm-live', '--stage', 'office'], /--stage must be one of/);
refuses(['--live', '--confirm-live', '--stage', 'title', '--sweep'], /belong to --stage custom-night/);
refuses(['--live', '--confirm-live', '--stage', 'custom-night', '--sweep', '--set', '20,20,20,20'], /separate probes/);
refuses(['--dry-run', '--live'], /mutually exclusive/);
assert.equal(parseArgs(['--dry-run']).dryRun, true);
assert.deepEqual(parseArgs(['--live', '--confirm-live', '--stage', 'custom-night', '--set', '20,20,20,20']).set,
  { freddy: 20, bonnie: 20, chica: 20, foxy: 20 });

// 1/9/8/7 sends Ready to a different frame (customize g8, g60-g64).
assert.throws(() => parseTargets('1,9,8,7'), /refuses 1\/9\/8\/7/);
assert.throws(() => parseTargets('21,0,0,0'), /0\.\.20/);
assert.throws(() => parseTargets('1,2,3'), /four comma-separated/);

// The short way round the 21-value wrap (customize g41), ties going up.
assert.equal(stepsBetween(1, 20), -2);
assert.equal(stepsBetween(20, 1), 2);
assert.equal(stepsBetween(3, 20), -4);
assert.equal(stepsBetween(0, 10), 10);
assert.equal(stepsBetween(0, 11), -10);
assert.equal(stepsBetween(7, 7), 0);
for (let from = 0; from <= 20; from += 1) {
  for (let to = 0; to <= 20; to += 1) {
    const steps = stepsBetween(from, to);
    assert.ok(Math.abs(steps) <= 10, 'never the long way round');
    assert.equal(((from + steps) % 21 + 21) % 21, to);
  }
}

// The dial contact must clear the source-derived auto-repeat ceiling by the
// repository's 33 ms seam margin, and it must be the measured FNaF 1 contact.
const model = JSON.parse(await readFile(new URL('./models/custom-night-fnaf1-moto-g56-v207.json', import.meta.url), 'utf8'));
const route = JSON.parse(await readFile(new URL('./models/fnaf1-community-loop-moto-g56-v207.json', import.meta.url), 'utf8'));
assert.equal(model.stepping.contactMs, route.controls.contactMs);
assert.ok(model.stepping.contactMs + 33 <= model.stepping.autoRepeatAfterMs);
assert.equal(model.controls.ready.pressed, false, 'Ready is measured, never pressed by the probe');

console.log('fnaf1 menu probe: live gating, short dial walks over all 441 pairs, 1/9/8/7 refusal, contact under the repeat ceiling');
