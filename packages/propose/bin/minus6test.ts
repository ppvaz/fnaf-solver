// "Minus 6" probe: revive the refuted Six-Seven two-camera cover by
// *tolerating* the one route CAM 06/07 never sees. Under the post-XOR graph
// that route is Toy Freddy's (9 -> 10 -> blindA -> blindB -> office) — not
// Withered Freddy's, who is held at CAM 07 like the rest. The candidate runs
// Minus 7's cycle shape with the flash pass cut to 06/07 and accepts a
// defended office encounter (mask inside the 45-frame fuse, full 300-frame
// sequence cost, sourced repel + cooldown) every time Toy Freddy walks in.
//
// The controller is observable-only: clock, own inputs, vent-bang cues, the
// visible blackout, BB's cues, Foxy's hall audio, and the box gauge. Leaked
// opening threats get minus2test-style held-mask cycles (max two consecutive,
// box floor override); holds and defends keep the free right vent light on,
// which also asserts the sourced office-light latch. A pass here is a
// sim-derived result on the current Android model, not a proven strategy.
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import type { SimOptions } from '@sixam/source/games/fnaf2/plant-options.ts';
import { Bot } from '../parked/minus7/reactive-pilot.ts';
import type { PlanRow } from '../parked/minus7/reactive-pilot.ts';

export const MINUS6_CYCLE: PlanRow[] = [
  [0, 'tap', 'monitor'],
  [18, 'tap', 'mask'], [27, 'tap', 'mask'],
  [30, 'down', 'light'], [32, 'up', 'light'],
  [36, 'tap', 'monitor'],
  [55, 'tap', 'cam:6'], [57, 'down', 'light'], [59, 'up', 'light'],
  [67, 'tap', 'cam:7'], [69, 'down', 'light'], [71, 'up', 'light'],
  [79, 'tap', 'cam:11'], [82, 'down', 'wind'],
];

const A = (f: number) => { // next frame landing on a :X2 / :X7 second boundary
  for (let k = 0; k < 12 * C.FPS; k++) {
    const g = f + k;
    if (g % C.FPS === 0) { const d = (g / C.FPS) % 10; if (d === 2 || d === 7) return g; }
  }
  return f;
};

class Minus6Bot extends Bot<Sim> {
  declare evIdx: number;
  declare threats: number;
  declare consecHolds: number;
  declare maxConsecHolds: number;
  declare holdUntil: number;
  declare holdCooldownUntil: number;
  declare defends: number;
  declare holdCount: number;
  constructor(sim: Sim, table: readonly PlanRow[] = MINUS6_CYCLE, targets: number[] | null = null) {
    super(sim, table, targets);
    this.evIdx = 0; this.threats = 0;
    this.consecHolds = 0; this.maxConsecHolds = 0;
    this.holdUntil = -1; this.holdCooldownUntil = -1;
    this.defends = 0; this.holdCount = 0;
  }

  // After the 300-frame sequence: unmask, flash the hall right away (Foxy's D
  // must be zeroed between every pair of 5s checks), rebuild the two-camera
  // stall off-anchor, and wind until the next :X2/:X7 anchor re-syncs.
  postDefend(f: number) {
    const p: PlanRow[] = [[f + 1, 'tap', 'mask']];
    if (!this.sim.foxy.gotYou) p.push([f + 16, 'down', 'light'], [f + 18, 'up', 'light']);
    p.push([f + 20, 'tap', 'monitor'],
      [f + 34, 'tap', 'cam:6'], [f + 36, 'down', 'light'], [f + 38, 'up', 'light'],
      [f + 44, 'tap', 'cam:7'], [f + 46, 'down', 'light'], [f + 48, 'up', 'light'],
      [f + 52, 'tap', 'cam:11'], [f + 55, 'down', 'wind']);
    return p;
  }

  step() {
    const s = this.sim, f = s.frame;
    // The Shooter25 stall, held all night: the right vent light is free,
    // blocks Toy Bonnie's vent hop outright (group 428), and while the cams
    // are down it keeps the sourced office-light latch asserted.
    if (!s.ventLightR) s.press('ventR');
    for (; this.evIdx < s.events.length; this.evIdx++) {
      const e = s.events[this.evIdx];
      if (e.type === 'vent-bang' && !e.data?.cam && e.data?.who !== 'bb')
        this.threats = Math.max(0, this.threats + (e.data.leaving ? -1 : 1));
    }

    // 1. The shared office encounter. Groups 538-555 resolve a decision that
    // is latched during the fuse, so the whole 300-frame sequence is paid:
    // stay down, mask fully on, nothing else.
    if (s.blackout.active) {
      if (this.kind !== 'defend') {
        this.kind = 'defend'; this.plan = []; this.waiting = null; this.defends++;
        s.release('light'); s.release('wind');
      }
      if (!s.maskOn) s.press('mask');
      return;
    }
    if (this.kind === 'defend') {
      this.kind = 'postdefend';
      this.plan = this.postDefend(f);
    }

    // 2. Held-mask cycles for unresolved opening threats (minus2test policy
    // shape): clear Toy Chica / Mangle via their sourced continuous-mask
    // leaves and let Toy Bonnie roll his overlay encounter. Foxy in the hall
    // gets the late unmask-flash-remask so his D re-enters every boundary
    // near zero. After two consecutive holds a full flash cycle must run
    // (box, Foxy, stun refresh) before holding again.
    if (this.kind === 'hold') {
      if (f >= this.holdUntil) {
        if (s.maskOn) s.press('mask');
        this.kind = 'cycle'; this.plan = [];
        if (this.consecHolds >= 2) {
          this.holdCooldownUntil = f + C.MO_FRAMES;
          this.consecHolds = 0;
        }
      } else {
        const ph = f % C.MO_FRAMES;
        const foxyHall = s.foxy.loc === 'hall' && !s.foxy.gotYou;
        if (foxyHall && ph === 274 && s.maskOn) s.press('mask');
        else if (foxyHall && ph === 290 && !s.maskOn) s.press('light');
        else if (foxyHall && ph === 298) s.release('light');
        else if (ph === 299 && !s.maskOn) s.press('mask');
        else if (s.camsUp) s.press('monitor');
        else if (!s.maskOn) s.press('mask');
        return;
      }
    }
    if (this.threats > 0 && this.consecHolds < 2 && f >= this.holdCooldownUntil &&
        s.box >= 0.5 && !s.bb.inOpening && this.waiting === null &&
        // phaseA only needs the cams down across BB's interval, which a held
        // cycle satisfies; only the BB attack/recover sequences are exclusive.
        (this.kind === 'cycle' || this.kind === 'postdefend' ||
         this.kind === 'phaseA' || this.kind === 'start')) {
      this.kind = 'hold';
      this.plan = [];
      this.holdUntil = A(f + 1) + C.MO_FRAMES - 2;
      this.consecHolds++; this.holdCount++;
      this.maxConsecHolds = Math.max(this.maxConsecHolds, this.consecHolds);
      s.release('light'); s.release('wind');
      if (s.camsUp) s.press('monitor');
      if (!s.maskOn) s.press('mask');
      return;
    }

    super.step();
  }
}

/** A night of the probe: the Sim's options, and the table and its cameras. */
interface Minus6Options extends Partial<SimOptions> {
  readonly cycle?: readonly PlanRow[];
  readonly targets?: number[] | null;
}

export function run(opts: Minus6Options = {}) {
  const sim = new Sim(Object.assign({ seed: 999 }, opts));
  const bot = new Minus6Bot(sim, opts.cycle || MINUS6_CYCLE, opts.targets || null);
  let minBox = 1;
  while (sim.alive && !sim.won) { bot.step(); sim.tick(); minBox = Math.min(minBox, sim.box); }
  return { sim, bot, minBox };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = +(process.argv[2] || 200);
  const worst = process.argv.includes('--worst');
  const fails: Record<string, number> = {}; let minB = 1, minP = C.POWER_FRAMES;
  let maxDefends = 0, maxHolds = 0;
  for (let i = 0; i < n; i++) {
    const r = run({ seed: (i * 2246822519) >>> 0, worst });
    minB = Math.min(minB, r.minBox); minP = Math.min(minP, r.sim.power);
    maxDefends = Math.max(maxDefends, r.bot.defends);
    maxHolds = Math.max(maxHolds, r.bot.maxConsecHolds);
    if (!r.sim.won) {
      const death = r.sim.death as NonNullable<Sim['death']>; // a night that is not won ended in a death
      const key = `${death.reason}: ${death.detail}`;
      fails[key] = (fails[key] || 0) + 1;
    }
  }
  const failed = Object.values(fails).reduce((a, b) => a + b, 0);
  console.log(`Minus 6 probe (${worst ? 'pinned worst-luck' : 'normal'} seeds)`);
  console.log(`${n - failed}/${n} survived on the current Android model`);
  for (const [k, v] of Object.entries(fails)) console.log(`  ${v}x  ${k}`);
  console.log(`min box ${(minB * 100).toFixed(0)}% | min power ${minP} | max encounters ${maxDefends} | max consecutive holds ${maxHolds}`);
}
