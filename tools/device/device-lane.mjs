#!/usr/bin/env node
// The device lane: the model scored on exactly what the phone is sent.
//
// Every census here scores a plan's MODEL replay. The phone never sees that:
// it receives the HID schedule apps/device/src/hid-schedule.js compiles from
// the bundle's artifact, with its own macro timings (a read's mask press, a
// maskraise's gap, a camdrop's light tail) and the phone's own constraints on
// top. On 2026-09-27 a Night 1 plan the model scored 65,536/65,536 lost a
// press on 96 of 269 graded contacts on the phone, twice, because the two
// disagreed (night1-ladder-n1a-20260927T053211Z). This file closes that gap:
//
//   1. compile the bundle's plan into the executor's own HID schedule;
//   2. decode each report back into contact transitions (slot, down/up,
//      screen point) and each point back into its profile control;
//   3. deliver them to the simulator through actuator.mjs with the device
//      constraints this repository has measured, each switchable:
//        maskFloor  a mask-ON press inside the mask button's absence after a
//                   lowering press is lost (native trace: fully visible at
//                   ~382.5 ms; SEAM_FLOORS);
//        seams      a monitor press under 180 ms after a mask-off is dropped
//                   at the measured rate (actuator.mjs SEAM_BANDS);
//        merge      HYPOTHESIS, not a measurement: a new contact on a slot
//                   that was released less than one Fusion poll (33 ms)
//                   earlier can reach the game as a drag of the old touch,
//                   not a new one. A control read by a TRIGGER (a camera's
//                   ObjectClicked, the monitor's new-touch cameraHitbox, and
//                   conservatively the mask) then misses the press, with
//                   probability 1 - gap/poll; a control read as a held
//                   "touch over object" (the flashlight, the vent lights,
//                   the music box) is satisfied by the dragged touch. The
//                   first version lost every merged press, and so scored
//                   toys-n34 0/40 on Night 4 -- which the phone won with it
//                   (night4-n4-bbfix-20260920T002911Z), its 41 merges per
//                   night all being the camdrop light 20 ms after the wind;
//        late       each press lands late by a draw from a band (ms).
//
//   node tools/device/device-lane.mjs --bundle DIR --night N [--seeds 300] [--epoch MS]
//        [--no-merge] [--no-floor] [--no-seams] [--late 0,100] [--dials JSON]
//
// MODEL_ONLY: a simulator result with device rules applied. A rule marked
// HYPOTHESIS here is only as good as its test against a phone run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FPS, Sim, Rng } from '@sixam/core/mechanics';
import { stableHash } from '@sixam/core/contracts';
import { MODEL_CONTEXT_LIGHT } from '@sixam/core/control';
import { validateExecutorRequest } from '../../apps/device/src/artifact-executor.js';
import { compileDeviceLocalHidSchedule } from '../../apps/device/src/hid-schedule.js';
import { DeviceActuator } from './actuator.mjs';
import { SEAM_FLOORS } from './artifact-commands.mjs';

export const FUSION_POLL_MS = 33;
const frame = (ms) => Math.round(ms * FPS / 1000);

/** The executor request for one night of a bundle, built as campaign-bundle.js builds it. */
export function laneRequest(bundleDir, night, { mutate = null } = {}) {
  const artifact = JSON.parse(readFileSync(join(bundleDir, 'artifact.json'), 'utf8'));
  const profile = JSON.parse(readFileSync(join(bundleDir, 'profile.json'), 'utf8'));
  const plan = artifact.plans.find((p) => p.night === night);
  if (!plan) throw new Error(`device lane: ${bundleDir} has no night ${night}`);
  let blocks = Object.values(plan.cycles).flatMap((cycle) => cycle.blocks.map((block) => ({ ...block, night })));
  if (mutate) blocks = blocks.map((block) => ({ ...block, actions: block.actions.map(mutate) }));
  return validateExecutorRequest({
    schema: 'device-executor-v1', version: 1, mode: 'live',
    artifact: { winnerHash: artifact.winnerHash ?? 'a'.repeat(64), engineHash: 'b'.repeat(64), profileHash: 'c'.repeat(64),
      profileStableHash: stableHash(profile),
      plans: [{ night, sha256: plan.sha256 ?? 'd'.repeat(64), timing: plan.timing,
        ...(plan.armVerification ? { armVerification: plan.armVerification } : {}) }] },
    profile, limits: { maxActions: profile.limits?.maxActions ?? 64, maxDurationMs: profile.limits?.maxDurationMs ?? 15000 },
    blocks,
  });
}

// A report is [1, count, ...count records of [flags, xlo, xhi, ylo, yhi], filler].
// flags bit 0 is the tip switch, bit 2 names contact 1 (hid.js record/report).
// toRaw: raw x = floor((1080 - y) * 20/9), raw y = floor(x * 9/20).
function decodeReport(bytes) {
  const count = bytes[1];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const [flags, xlo, xhi, ylo, yhi] = bytes.slice(2 + 5 * i, 7 + 5 * i);
    const rawX = xlo | (xhi << 8); const rawY = ylo | (yhi << 8);
    out.push({ slot: flags & 4 ? 1 : 0, down: (flags & 1) === 1, x: rawY * 20 / 9, y: 1080 - rawX * 9 / 20 });
  }
  return out;
}

const SIM_ACTION = { cameraFeedLight: MODEL_CONTEXT_LIGHT, hallLight: MODEL_CONTEXT_LIGHT,
  leftVentLight: 'ventL', rightVentLight: 'ventR', mask: 'mask', monitor: 'monitor', wind: 'wind' };

/** Contact transitions on the night timeline (ms from the night origin), each with its profile control. */
export function hidTimeline(request) {
  const schedule = compileDeviceLocalHidSchedule(request);
  const points = Object.entries(request.profile.controlMap);
  const controlAt = (x, y) => {
    let best = null; let bestD = Infinity;
    for (const [name, p] of points) { const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = name; } }
    if (bestD > 6) throw new Error(`device lane: no control within 6 px of (${x.toFixed(0)}, ${y.toFixed(0)})`);
    return best;
  };
  const events = [];
  const held = [null, null];
  let t = -schedule.readyDelayMs;
  for (const text of schedule.lines) {
    const row = JSON.parse(text);
    if (row.command === 'delay') t += row.duration;
    else if (row.command === 'report') {
      for (const rec of decodeReport(row.report)) {
        if (rec.down && held[rec.slot] === null) {
          const control = controlAt(rec.x, rec.y);
          held[rec.slot] = control;
          events.push({ t, slot: rec.slot, down: true, control });
        } else if (!rec.down && held[rec.slot] !== null) {
          events.push({ t, slot: rec.slot, down: false, control: held[rec.slot] });
          held[rec.slot] = null;
        }
      }
    }
  }
  return { events, schedule };
}

/** Controls the game detects by a trigger (a new touch or a click), which a dragged touch does not fire. */
export const TRIGGERED = (action) => action === 'monitor' || action === 'mask' || /^cam:\d+$/.test(action ?? '');

/** Sim action for a profile control, or null for one the simulator does not model (mute). */
export const simAction = (control) => (/^cam:\d+$/.test(control) ? control : SIM_ACTION[control] ?? null);

/**
 * One night of `timeline` on the simulator, through the device constraints.
 * `epochMs` places the night origin on the game's clock.
 */
export function playLane({ events, seed, night, epochMs = 0, customNight = undefined,
  merge = true, maskFloor = true, seams = true, late = null } = {}) {
  const sim = new Sim({ night, seed, ...(customNight ? { customNight } : {}) });
  const actuator = new DeviceActuator(sim, { seed, lateMinMs: late ? late[0] : 0, lateMaxMs: late ? late[1] : 0,
    maskFloorMs: maskFloor ? SEAM_FLOORS.maskButtonFullyVisibleAfterMonitorDownMs : null });
  if (!seams) actuator.seamDropped = () => false;
  const rng = new Rng(((seed >>> 0) ^ 0x51ed270b) >>> 0);
  const lastUp = [-Infinity, -Infinity];
  const lostDowns = new Set();
  const queue = [];
  let merged = 0;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const action = simAction(e.control);
    if (e.down) {
      const gap = e.t - lastUp[e.slot];
      if (merge && gap < FUSION_POLL_MS && TRIGGERED(action) && rng.next() < 1 - gap / FUSION_POLL_MS) { lostDowns.add(i); merged += 1; continue; }
      if (action) queue.push([frame(e.t + epochMs), 'press', action, i]);
    } else {
      lastUp[e.slot] = e.t;
      const down = events.findLastIndex((x, j) => j < i && x.down && x.slot === e.slot);
      if (lostDowns.has(down)) continue;
      if (action && ['wind', MODEL_CONTEXT_LIGHT, 'ventL', 'ventR'].includes(action)) queue.push([frame(e.t + epochMs), 'release', action, i]);
    }
  }
  queue.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
  let q = 0;
  while (sim.alive && !sim.won) {
    while (q < queue.length && queue[q][0] <= sim.frame) { const [, op, action] = queue[q++]; actuator[op](action); }
    actuator.deliver();
    sim.tick();
  }
  return { won: !!sim.won, death: sim.death?.reason ?? null, frame: sim.frame, merged,
    maskFloorDrops: actuator.maskFloorDrops, seamDrops: actuator.seamDrops };
}

async function main(argv) {
  const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1]; };
  const bundle = flag('bundle', null); const night = Number(flag('night', 'NaN'));
  if (!bundle || !Number.isInteger(night)) throw new Error('usage: device-lane.mjs --bundle DIR --night N [--seeds N] [--epoch MS]');
  const count = Number(flag('seeds', '300'));
  const winner = JSON.parse(readFileSync(join(bundle, 'winner.json'), 'utf8'));
  const epochMs = Number(flag('epoch', String((winner.anchorEpochMs ?? 0) + (winner.phaseOffsetMs ?? 0))));
  const lateArg = flag('late', null);
  const opts = { merge: !argv.includes('--no-merge'), maskFloor: !argv.includes('--no-floor'), seams: !argv.includes('--no-seams'),
    late: lateArg ? lateArg.split(',').map(Number) : null,
    customNight: flag('dials', null) ? JSON.parse(flag('dials', null)) : undefined };
  const { events } = hidTimeline(laneRequest(bundle, night));
  let wins = 0; const deaths = {}; let merged = 0;
  for (let seed = 1; seed <= count; seed += 1) {
    const r = playLane({ events, seed, night, epochMs, ...opts });
    merged += r.merged;
    if (r.won) wins += 1; else deaths[r.death ?? 'alive'] = (deaths[r.death ?? 'alive'] ?? 0) + 1;
  }
  console.log(`device lane ${bundle} night ${night} epoch ${epochMs} ms: ${wins}/${count} ` +
    `${JSON.stringify(deaths)} merged presses ${merged} (${JSON.stringify({ merge: opts.merge, maskFloor: opts.maskFloor, seams: opts.seams, late: opts.late })})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
