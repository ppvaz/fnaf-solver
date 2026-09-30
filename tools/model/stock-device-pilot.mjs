// The device pilot, run in the simulator.
//
// tools/device/trial.sh drives the phone from a fixed millisecond
// table. This replays that exact table against the sourced engine, so a
// schedule change can be judged before it costs a night on the device.
//
// Unlike tools/model/reactive-pilot.mjs -- whose bot reads sim state freely -- this bot is
// blind by construction. Its only optional input is one left-vent check per
// cycle, which is what the phone can actually do: flash the left vent light
// and classify one screenshot. That check is sourced: with the left light on,
// Balloon Boy standing at the vent opening renders his own view (group 289),
// distinct from the empty-vent view (group 287).
//
//   node tools/model/stock-device-pilot.mjs 200            # blind, as the device runs today
//   node tools/model/stock-device-pilot.mjs 200 --vent     # with the once-a-cycle vent check
//   node tools/model/stock-device-pilot.mjs 200 --vent --cycles=80
//   node tools/model/stock-device-pilot.mjs 200 --night=6  # 6th Night, the night the phone runs
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { DeviceActuator } from '../../packages/play/bin/phone/actuator.mjs';
import { formatRate } from '../../packages/review/src/stat.mjs';

const ms = (v) => Math.round(v / 1000 * C.FPS);

// trial.sh, PRESS_MODE=fast-swipe: the opening sequence, then a 5000 ms
// cycle from base = 7000 + cycle * 5000. Camera-light and hall presses are
// holds; the phone's 60 ms swipe is one frame of contact but the game latches
// the flash for the frame it lands on.
const OPENING = [
  [180, 'tap', 'monitor'], [460, 'tap', 'cam:11'],
  [4000, 'tap', 'cam:10'], [4190, 'hold', 'light', 60],
  [4380, 'tap', 'cam:4'], [4570, 'hold', 'light', 60],
  [4760, 'tap', 'cam:7'], [4950, 'hold', 'light', 60],
  [5140, 'tap', 'cam:11'],
];

const CYCLE = [
  [0, 'down'],                                 // cams down (see `--sync`)
  [450, 'tap', 'mask'], [800, 'tap', 'mask'],  // Golden Freddy flick
  [950, 'hold', 'light', 200],                 // hall, two attempts
  [1300, 'hold', 'light', 150],
  [1550, 'up'],                                // cams up
  [2050, 'tap', 'cam:10'], [2240, 'hold', 'light', 60],
  [2430, 'tap', 'cam:4'], [2620, 'hold', 'light', 60],
  [2810, 'tap', 'cam:7'], [3000, 'hold', 'light', 60],
  [3190, 'tap', 'cam:11'], [3380, 'hold', 'wind', 1400],
];

// The same cycle plus an answer to the sourced 10 s forcedown (g718-721), which
// slams the monitor down whenever one of the four streak attackers is waiting at
// marker 122 with the cameras up. It fires at absolute `f % 600 == 0`, and every
// Minus 7 cycle is anchored on :X2/:X7, so it always lands at cycle phase
// 3000 ms -- mid-sweep, cams up, where a blind schedule keeps tapping cameras
// into a lowered monitor while the 50-frame office-defense fuse burns.
//
// The guard costs nothing. `press()` drops a mask press while the monitor is up
// (there is no state in which both are raised), so the flick is a no-op unless
// the forcedown actually happened; when it did, the monitor is already down and
// the mask lands well inside the fuse. The `up` is a `--sync` intent for the
// same reason: after a forcedown the monitor otherwise stays down for the rest
// of the cycle, and that cycle's winding is lost -- which is what turns the
// rescued nights into Puppet deaths instead.
const CYCLE_GUARDED = [
  ...CYCLE,
  [3200, 'tap', 'mask'], [3550, 'tap', 'mask'],   // defuse; dropped if the cams are up
  [3750, 'up'],                                   // sync intent: no-op unless forced down
  [3950, 'tap', 'cam:11'], [4140, 'hold', 'wind', 860],
].sort((a, b) => a[0] - b[0]);

// Same cycle with the box wound first and the three stall cameras refreshed
// last, so the newest flash is ~1 s old when the cams drop. That is what makes
// a Balloon Boy mask hold survivable: the 400-frame stun has to cover the whole
// masked window, and the human Phase B buys that margin the same way.
const CYCLE_LATE_FLASH = [
  [0, 'down'],                                 // cams down (see `--sync`)
  [450, 'tap', 'mask'], [800, 'tap', 'mask'],  // Golden Freddy flick
  [950, 'hold', 'light', 200],
  [1300, 'hold', 'light', 150],
  [1550, 'up'],                                // cams up
  [1800, 'tap', 'cam:11'], [1990, 'hold', 'wind', 1400],
  [3500, 'tap', 'cam:10'], [3690, 'hold', 'light', 60],
  [3880, 'tap', 'cam:4'], [4070, 'hold', 'light', 60],
  [4260, 'tap', 'cam:7'], [4450, 'hold', 'light', 60],
];

// The response when the vent check says Balloon Boy is at the opening. He
// walks in on the next completed monitor raise (g290-291), so the monitor must
// stay down until he is gone. The check happens with the cams already down, so
// the mask goes on immediately and holds for more than the five consecutive
// fully-masked scheduler ticks that send him back to CAM 10 (g294). The
// response occupies two cycles and re-flashes the stall cameras on the way out.
const RESPONSE = [
  // Golden Freddy first: flashing the hall with him in the office is lethal
  // and only a mask touch clears him, so flick the mask, then flash, then mask
  // for real. Foxy cover has to be bought before the mask goes on and repaid
  // the moment it comes off -- g75/g84 require mask = 0, so nothing at all can
  // be flashed in between.
  [0, 'tap', 'mask'], [250, 'tap', 'mask'],
  [450, 'hold', 'light', 250],
  [800, 'tap', 'mask'],                        // mask on and held
  // Off at +6000: the mask is fully on by +1000, which is 5 whole scheduler
  // seconds before +5700, so g294's five consecutive masked ticks are paid
  // with 300 ms to spare. Everything after this is a race against the stall
  // cameras, whose 400-frame stun expires just before the next 5 s interval.
  [6000, 'tap', 'mask'],
  [6200, 'hold', 'light', 250],                // repay Foxy immediately
  [6400, 'up'],
  // All three stall cameras must be refreshed before that interval, which
  // lands at +7700. At the device's 190 ms launch spacing this finishes at
  // +7650 -- the whole margin the response has.
  [6700, 'tap', 'cam:10'], [6890, 'hold', 'light', 60],
  [7080, 'tap', 'cam:4'], [7270, 'hold', 'light', 60],
  [7460, 'tap', 'cam:7'], [7650, 'hold', 'light', 60],
  [7840, 'tap', 'cam:11'], [8030, 'hold', 'wind', 1400],
  // Ends with the monitor up, which is what the normal cycle expects.
];

// A left-opening response for the phone's simultaneous BB/GF office read.
// The first sustained mask both clears an office Golden Freddy and starts
// BB's five-tick counter, so the older flick-then-flash preamble only burns
// camera-stun margin. CYCLE_LATE_FLASH leaves the newest target flash less
// than a second old at VENT_CHECK_AT; the 5.2 s hold is therefore still
// covered by the sourced 400-frame stuns in the worst one-second tick phase.
// Recover Foxy's hall reset before raising, then refresh the three targets.
const RESPONSE_FAST = [
  [0, 'tap', 'mask'],
  [5200, 'tap', 'mask'],
  [5500, 'hold', 'light', 250],
  [5800, 'up'],
  [6100, 'tap', 'cam:10'], [6290, 'hold', 'light', 60],
  [6480, 'tap', 'cam:4'], [6670, 'hold', 'light', 60],
  [6860, 'tap', 'cam:7'], [7050, 'hold', 'light', 60],
  [7240, 'tap', 'cam:11'], [7430, 'hold', 'wind', 1800],
];

// Markiplier's eviction (docs/strategy/MINUS-7-STRATEGY.md 9.3): spend the sourced
// 100*night frames of hall light -- 11.67 s on night 7 -- in segments shorter
// than the 400-frame camera stun, so Foxy retreats to Parts & Service without
// the stall sweep ever lapsing. Each cams-down segment also latches Balloon
// Boy wherever he is (g417 needs the monitor up), so the eviction holds him
// while it runs, and every raise is preceded by a vent check.
const EVICT = [
  [0, 'tap', 'mask'], [250, 'tap', 'mask'],    // clear Golden Freddy first
  [600, 'hold', 'light', 5000],                // segment 1
  [5700, 'check'],
  [5900, 'tap', 'monitor'],
  [6200, 'tap', 'cam:10'], [6390, 'hold', 'light', 60],
  [6580, 'tap', 'cam:4'], [6770, 'hold', 'light', 60],
  [6960, 'tap', 'cam:7'], [7150, 'hold', 'light', 60],
  [7340, 'tap', 'cam:11'], [7530, 'hold', 'wind', 1200],
  [8900, 'tap', 'monitor'],
  [9150, 'tap', 'mask'], [9400, 'tap', 'mask'],
  [9700, 'hold', 'light', 3500],               // segment 2
  [13300, 'check'],
  [13500, 'tap', 'monitor'],
  [13800, 'tap', 'cam:10'], [13990, 'hold', 'light', 60],
  [14180, 'tap', 'cam:4'], [14370, 'hold', 'light', 60],
  [14560, 'tap', 'cam:7'], [14750, 'hold', 'light', 60],
  [14940, 'tap', 'cam:11'], [15130, 'hold', 'wind', 1200],
  [16500, 'tap', 'monitor'],
  [16750, 'tap', 'mask'], [17000, 'tap', 'mask'],
  [17300, 'hold', 'light', 3500],              // segment 3
  [20900, 'check'],
  [21100, 'tap', 'monitor'],
  [21400, 'tap', 'cam:10'], [21590, 'hold', 'light', 60],
  [21780, 'tap', 'cam:4'], [21970, 'hold', 'light', 60],
  [22160, 'tap', 'cam:7'], [22350, 'hold', 'light', 60],
  [22540, 'tap', 'cam:11'], [22730, 'hold', 'wind', 1400],
];

// Where in the cams-up sweep the pilot peeks at CAM 05. Seeing Balloon Boy
// there means he is one move from the vent, which is the cue Markiplier aligns
// the eviction with.
const CAM5_PEEK_AT = 4800;

// The phone flashes the left vent just before the cams come up, which is the
// last moment a response can still beat the raise that would let him in.
const VENT_CHECK_AT = 300;

export function run(opts = {}) {
  const cycles = opts.cycles ?? 80;
  const sim = new Sim(Object.assign({ seed: 1 }, opts.sim));
  // The measured phone between the table and the game: per-press launch
  // lateness (this runner fires one wall-timed helper per table row) and the
  // mask-seam monitor drop. Off by default so every published simulator
  // figure keeps meaning what it meant; `--device-actuator` opts a run in.
  const actuator = opts.deviceActuator
    ? new DeviceActuator(sim, Object.assign(
        { seed: (opts.sim && opts.sim.seed) ?? 1, worst: opts.sim && opts.sim.worst },
        opts.deviceActuator === true ? {} : opts.deviceActuator))
    : null;
  const press = (a) => actuator ? actuator.press(a) : sim.press(a);
  const release = (a) => actuator ? actuator.release(a) : sim.release(a);
  let queue = [];
  const responseTable = opts.fastResponse ? RESPONSE_FAST : RESPONSE;
  const at = (t0, table) => table.forEach(([o, kind, act, dur]) =>
    queue.push([t0 + ms(o), kind, act, dur ? ms(dur) : 0]));

  at(0, OPENING);
  let checks = 0, responses = 0, evictions = 0, syncs = 0;
  // Cycle phase can defer Balloon Boy's monitor-gated final hop, but g417
  // consumes a latched A=2 later rather than cancelling it. `phasesweep.mjs`
  // varies this base to quantify that limited benefit; no phase eliminates
  // his arrival.
  const base = opts.base ?? 7000;
  const cycleAt = (k) => ms(base + k * 5000);
  let cycleTable = opts.lateFlash ? CYCLE_LATE_FLASH
    : opts.guard ? CYCLE_GUARDED : CYCLE;
  // The per-cycle Golden Freddy mask flick is blind insurance. g336 spawns
  // him only with the monitor up, g776 makes the mask the only clear, and
  // g777/g778 kill on a raise or hall flash while he is present. A visual
  // policy could skip it on confirmed-empty frames; flicksweep prices what a
  // blind schedule loses when it simply removes the two mask events.
  if (opts.noFlick) cycleTable = cycleTable.filter(event => event[2] !== 'mask');
  for (let k = 0; k < cycles; k++) at(cycleAt(k), cycleTable);

  const releases = [];
  let busyUntil = -1;

  // Replace everything scheduled between now and `until` with `table`. `until`
  // must land on a cycle boundary or the resumed cycle starts mid-table.
  const takeOver = (f, until, table) => {
    queue = queue.filter(e => e[0] < f || e[0] >= until);
    at(f, table);
    queue.sort((a, b) => a[0] - b[0]);
    busyUntil = until;
  };

  // The one thing the phone can see with the cams down: flash the left vent
  // light and classify a screenshot. g289 draws Balloon Boy at the opening,
  // g287 draws it empty.
  const ventCheck = (f) => {
    checks++;
    if (!sim.bb.inOpening) return false;
    responses++;
    // Resume on the first cycle boundary at or after the response's last
    // action: reserving a whole extra cycle leaves the stall cameras dark for
    // 5 s of dead air, which is not a cost of the defence itself.
    const last = responseTable[responseTable.length - 1];
    const end = f + ms(last[0]) + (last[3] ? ms(last[3]) : 0);
    const k = Math.ceil((end - cycleAt(0)) / ms(5000));
    takeOver(f, cycleAt(k), responseTable);
    return true;
  };

  while (sim.alive && !sim.won) {
    const f = sim.frame;
    // floor, not round: a phase late in the cycle must belong to this cycle.
    const k = Math.floor((f - cycleAt(0)) / ms(5000));
    const phase = f - cycleAt(k);

    // A clocked alternative to vision: pay the full Balloon Boy response every
    // N cycles. It can keep BB out but blinds the hall long enough for other
    // threats to dominate; periodicsweep.mjs retains that negative result.
    // Never respond on cycle zero, before the opening sweep establishes cover.
    if (opts.periodic && f > busyUntil && phase === 0 && k >= opts.periodic &&
        k % opts.periodic === 0) {
      responses++;
      const last = responseTable[responseTable.length - 1];
      const end = f + ms(last[0]) + (last[3] ? ms(last[3]) : 0);
      const kk = Math.ceil((end - cycleAt(0)) / ms(5000));
      takeOver(f, cycleAt(kk), responseTable);
    } else if (opts.vent && f > busyUntil && phase === ms(VENT_CHECK_AT) && k >= 0) {
      ventCheck(f);
    } else if (opts.evict && f > busyUntil && phase === ms(CAM5_PEEK_AT) && k >= 0
               && sim.camsUp && sim.bb.stage === C.BB_STAGES - 1) {
      // He is on CAM 05, one move out: start the eviction now so Foxy is in
      // Parts & Service by the time the mask window is forced.
      evictions++;
      takeOver(cycleAt(k + 1), cycleAt(k + 6), EVICT);
    }

    while (queue.length && queue[0][0] <= f) {
      const [, kind, act, dur] = queue.shift();
      if (kind === 'check') { if (ventCheck(f)) break; }
      // `down`/`up` are monitor *intents*, not presses. Blind, they are the
      // old unconditional toggle. With --sync the pilot spends one screenshot
      // on the monitor state first and presses only if the state disagrees --
      // the one input the phone can take without a reaction deadline, since
      // the look can happen a second early and the decision is a skip, not a
      // timed response.
      else if (kind === 'down' || kind === 'up') {
        const want = kind === 'up';
        if (!opts.sync) { press('monitor'); continue; }
        syncs++;
        if (sim.camsUp !== want) press('monitor');
      }
      else if (kind === 'tap') press(act);
      else { press(act); releases.push([f + dur, act]); }
    }
    for (let i = releases.length - 1; i >= 0; i--)
      if (releases[i][0] <= f) { release(releases[i][1]); releases.splice(i, 1); }
    if (actuator) actuator.deliver();

    sim.tick();
  }
  return { sim, checks, responses, evictions, syncs,
           actuator: actuator && { sent: actuator.sent, seamDrops: actuator.seamDrops } };
}

// Counts night-6 deaths whose last office entry was the forcedown's fuse
// expiring. This is the one claim `--guard` makes, and it is checked as a
// ratio rather than a threshold so it stays meaningful if the schedule moves.
function fuseMisses(n, guard) {
  let misses = 0;
  for (let i = 0; i < n; i++) {
    const r = run({ vent: true, sync: true, guard,
                    sim: { seed: (i * 2246822519) >>> 0, night: 6 } });
    if (r.sim.won) continue;
    const entry = r.sim.events.filter(e => e.type === 'office-entry').pop();
    if (entry && /45-frame office-defense fuse/.test(entry.data.why)) misses++;
  }
  return misses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = +(process.argv[2] || 200);
  const vent = process.argv.includes('--vent');
  const evict = process.argv.includes('--evict');
  const lateFlash = process.argv.includes('--late-flash');
  const guard = process.argv.includes('--guard');
  const fastResponse = process.argv.includes('--fast-response');
  const sync = process.argv.includes('--sync');
  const cyclesArg = (process.argv.find(a => a.startsWith('--cycles=')) || '').split('=')[1];
  const cycles = cyclesArg ? +cyclesArg : 80;
  // The device runs 6th Night, whose AI table is lower than 10/20 until 2 AM
  // and still below it afterwards. 7 stays the default because the trainer,
  // the strategy and every other tool here target 10/20.
  const nightArg = (process.argv.find(a => a.startsWith('--night=')) || '').split('=')[1];
  const night = nightArg ? +nightArg : 7;
  const lateArg = (process.argv.find(a => a.startsWith('--press-late-ms=')) || '').split('=')[1];
  let deviceActuator = process.argv.includes('--device-actuator');
  if (lateArg !== undefined) {
    if (!deviceActuator) throw new Error('--press-late-ms= does nothing without --device-actuator');
    const [lo, hi] = lateArg.split(',').map(Number);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo)
      throw new Error('--press-late-ms=MIN,MAX needs 0 <= MIN <= MAX');
    deviceActuator = { lateMinMs: lo, lateMaxMs: hi };
  }
  const assert = process.argv.includes('--assert');
  const worst = process.argv.includes('--worst');
  const fails = {};
  let survived = 0, minBox = 1, minPower = Infinity, checks = 0, responses = 0, evictions = 0;
  // The Balloon Boy -> Foxy chain, which is what the vent check exists to
  // break: BB reaches the office, g96 and g301/303 take every light away, the
  // hall can no longer be flashed, and Foxy collects. Counted separately from
  // plain Foxy deaths because only this one is BB's fault.
  let foxyDeaths = 0, bbInOffice = 0, chain = 0;
  let actSent = 0, actDrops = 0, actDropNights = 0;
  for (let i = 0; i < n; i++) {
    const r = run({ vent, evict, cycles, lateFlash, fastResponse, guard, sync,
      deviceActuator, sim: { seed: (i * 2246822519) >>> 0, worst, night } });
    checks += r.checks; responses += r.responses; evictions += r.evictions;
    if (r.actuator) {
      actSent += r.actuator.sent; actDrops += r.actuator.seamDrops;
      if (r.actuator.seamDrops) actDropNights++;
    }
    minBox = Math.min(minBox, r.sim.box); minPower = Math.min(minPower, r.sim.power);
    if (r.sim.won) survived++;
    else {
      const key = `${r.sim.death.reason}: ${r.sim.death.detail}`;
      fails[key] = (fails[key] || 0) + 1;
      if (r.sim.death.reason === 'foxy') foxyDeaths++;
      if (r.sim.bb.inside) bbInOffice++;
      if (r.sim.bb.inside && r.sim.death.reason === 'foxy') chain++;
    }
  }
  const mode = `${guard ? ' (forcedown guard)' : ''}${lateFlash ? ' (late flash)' : ''}${fastResponse ? ' (fast response)' : ''}${vent ? ' + vent check' : ' (blind, as shipped)'}${evict ? ' + eviction' : ''}${sync ? ' + monitor sync' : ''}${deviceActuator ? ' + device actuator' : ''}`;
  const label = night === 7 ? 'a full 10/20 night' : `a full night ${night}`;
  console.log(`${survived}/${n} survived (${formatRate(survived, n, { label: 'survival' })}) ` +
    `${label} — device schedule${mode}`);
  for (const [k, v] of Object.entries(fails).sort((a, b) => b[1] - a[1])) console.log(`  ${v}x  ${k}`);
  console.log(`min box ${(minBox * 100).toFixed(0)}% | min power ${minPower}` +
    (vent ? ` | ${responses} responses in ${checks} checks` : '') +
    (evict ? ` | ${evictions} evictions` : ''));
  console.log(`Balloon Boy: ${bbInOffice} reached the office | ` +
    `Foxy: ${foxyDeaths} deaths | BB->Foxy chain: ${chain}`);
  if (deviceActuator)
    console.log(`actuator: ${actDrops} seam-dropped monitor presses in ${actSent} sent` +
      ` (${actDropNights}/${n} nights lost at least one)`);

  if (process.argv.includes('--assert-guard')) {
    // g718-721 lands at cycle phase 3000 ms for any :X2/:X7 anchor, and the
    // blind schedule has no answer to it. The guard flick is free -- the mask
    // press is dropped while the monitor is up -- so it may only ever help.
    const plain = fuseMisses(n, false), guarded = fuseMisses(n, true);
    console.log(`forcedown fuse misses over ${n} night-6 runs: ` +
      `${plain} unguarded -> ${guarded} guarded`);
    if (guarded * 5 > plain) {
      console.log('  FAIL  the forcedown guard did not cut fuse misses fivefold');
      process.exit(1);
    }
    console.log('  PASS  the forcedown guard defuses the g718-721 monitor drop');
  }

  if (assert) {
    // The claim under guard is narrow and is the whole point of the vent
    // check: Balloon Boy must never reach the office, and Foxy must never
    // collect a run because he did. Survival is deliberately NOT asserted --
    // the pilot still loses to the seven, and pretending otherwise is how the
    // last set of stale numbers got written.
    const problems = [];
    if (bbInOffice) problems.push(`${bbInOffice} nights let Balloon Boy into the office`);
    if (chain) problems.push(`${chain} Foxy deaths followed BB taking the lights`);
    if (problems.length) {
      for (const p of problems) console.log(`  FAIL  ${p}`);
      process.exit(1);
    }
    console.log('  PASS  Balloon Boy never reached the office, and no Foxy death followed him');
  }
}
