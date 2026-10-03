// The event sheet's order: the per-second pass (g213-g781) and the Random draws the model spends where the
// sheet spends them (the camera views, the monitor-down image, the vent cameras, the random image, the
// footsteps, the blackout flicker, g58/g59/g192). Each function is a Sim method; plant-model.js installs
// it on Sim.prototype.
import * as C from './config.ts';
import { FOOTSTEP_NODES, FOOTSTEP_CAM_NODES, OFFICE_FOOTSTEP_IDS, unitOf } from './plant-constants.ts';
import * as blackoutClock from './blackout-clock.ts';
import { unitStunReady } from './movement-clock.ts';
import { attackAnimationLate } from './attack-animation.ts';
import type { Sim, Unit } from './plant-model.ts';

// Per-frame lookups without per-frame allocation (the sheet pass spent a sourced night's time building
// closures, arrays and keys each loop): a unit is found by its position (unitOf), and the id lists and timer
// keys are built once here.
const BB_VIEW_ROUTE: readonly number[] = [10, 7, 3, 1, 5];
const TOY_GROUP: Readonly<Record<string, string>> = { toybonnie: 'g366', toychica: 'g368', toyfreddy: 'g419' };
const VIEW_TOYS = ['toybonnie', 'toychica', 'toyfreddy'];
const FADE_IDS = ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy', 'toybonnie', 'toychica', 'mangle', 'bb'];
const STREAK_IDS = ['withfreddy', 'withbonnie', 'withchica', 'toyfreddy'];
const G556 = STREAK_IDS.map((id): [string, string] => [id, `556${id}`]);
const G747 = STREAK_IDS.map((id): [string, string] => [id, `747${id}`]);
const MANGLE_CUES: readonly [string, boolean][] = [['739', true], ['740', true], ['741', true], ['742', false], ['743', false]];
const VENT_CAM_SITES: readonly [string, number][] = [['toychica', 5], ['withbonnie', 5], ['toybonnie', 6], ['withchica', 6], ['mangle', 6], ['puppet', 6]];
const FOOTSTEP_IDS = ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy', 'toybonnie', 'toychica', 'bb', 'mangle'];

/** A camera's view of `id`: Balloon Boy's stage camera, Foxy on CAM 08, or a unit's route node. */
function viewNode(sim: Sim, id: string) {
  if (id === 'bb') return sim.bb.inOpening || sim.bb.inside ? null : (BB_VIEW_ROUTE[sim.bb.stage] ?? null);
  if (id === 'foxy') return sim.opts.foxyEnabled && sim.foxy.loc === 'parts' ? 8 : null;
  const u = unitOf(sim, id);
  return !u || u.done || u.atOpening || u.inside ? null : u.path[u.idx];
}

/**
 * Camera-view draws in sheet order (sourcedViewDraws); `this.cam` is the
 * your-view marker, the last camera selected.
 */
export function drawViewed(this: Sim, f: number, part = 'all') {
  const up = this.viewing > 0, all = part === 'all';
  if (up) for (const id of VIEW_TOYS) {                                                   // g366, g368, g419
    const u = unitOf(this, id);
    const armed = u?.pending && (!this.opts.sourcedPromotedViewDraws || u.promoted);   // value 0 == 2
    if ((all || part === TOY_GROUP[id]) && armed && viewNode(this, id) === this.cam) this.rng.int(0, 99, 0);
  }
  if (up && (all || part === 'fades')) for (const id of FADE_IDS) {                       // g468-g476
    if (f <= (this.fadeUntil[id] ?? -1) && viewNode(this, id) === this.cam) this.rng.int(0, 99, 0);
  }
  if (!all && part !== 'g498') return;
  if (!(this.opts.sourcedEveryOrigin && this.frame === 1)) this.puppetStaticTimer -= this.frameUnits;   // g498
  if (this.puppetStaticTimer <= 0) {
    this.puppetStaticTimer += 600;
    const p = this.puppet;
    const at = !p.out ? C.BOX_CAM : (typeof p.loc === 'number' ? p.loc : null);
    if (at === this.cam) this.rng.int(0, 99, 0);
  }
}

/** e7 (hide once value 0 reaches 22), then the drop's e211 (show). */
export function monitorDownEarly(this: Sim) {
  const m = this.monDown;
  const reached = m.av0 >= 22;
  if (reached && !m.hidePrev) m.visible = false;
  m.hidePrev = reached;
  if (m.pendingDrop) { m.visible = true; m.pendingDrop = false; }
}

/** e720 draw + e721, e722 (once invisible), e871 (once visible), e872. */
export function monitorDownLate(this: Sim) {
  const m = this.monDown;
  if (m.visible && m.av2 === 0) { this.rng.int(0, 999999, 0); m.av2 = 1; }
  const inv = !m.visible;
  if (inv && !m.invPrev) m.av2 = 0;
  m.invPrev = inv;
  const vis = m.visible;
  if (vis && !m.visPrev) m.av0 = 0;
  m.visPrev = vis;
  if (m.visible) m.av0 += 1;
}

/**
 * The per-second draw groups in sheet order (sourcedSecondPass). A group's
 * countdown loads on the first frame its earlier conditions hold (returning
 * false) and then counts down only on frames it is reached.
 */
export function secondPass(this: Sim, f: number) {
  if (this.opts.sourcedSheetOrder) this.secondPassFront(f);
  this.secondPassEarly(f); this.secondPassLate(f);
}

// The per-second pass helpers; each part reads mask2 (the mask fully on) when it starts.
const every = (sim: Sim, key: string, ms: number) => sim.passEvery(sim.passTimers[key] ??= { v: 0, init: false }, ms);
/** Random(n) == 1 */
const one = (sim: Sim, n: number) => sim.rng.int(0, n - 1, 1) === 1;
const at122 = (u: Unit | undefined): u is Unit => !!u && u.atOpening && !u.inside;
const danger2 = (sim: Sim) => sim.units.some(x => x.committedAt >= 0) || sim.puppet.attackAt >= 0;
/** g494/g495: the Puppet's escape stage advances, and at the last one he is out. */
function puppetStage(sim: Sim) {
  const p = sim.puppet;
  p.stage++;
  sim.emit('puppet-stage', p.stage);
  if (p.stage >= C.PUPPET_ESCAPE_STAGES) { p.out = true; sim.emit('puppet-out'); }
}

/** g213/g292/g294 precede rolls, promotions and route moves. */
export function secondPassFront(this: Sim, _f: number) {
  const mask2 = this.maskFullyOn;
  { const u = unitOf(this, 'toyfreddy');                                                    // g213
    if (this.viewing === 0 && !this.lightHeld && u && !u.atOpening && !u.inside &&
        u.path[u.idx] === 'blindB' && mask2 && every(this, '213', 1000) && one(this, 10)) {
      u.idx = 0; u.pending = false;
      this.emit('route-return', { who: u.id, to: 9, group: 213 });
    } }
  if (this.bb.inOpening && mask2 && every(this, '292', 1000) && one(this, 10)) { this.rng.int(0, 3, 0); this.bbLeave(); }   // g292
  if (this.bb.inOpening && this.bb.maskTicks >= C.VENT_MASK_TICKS && mask2) { this.rng.int(0, 3, 0); this.bbLeave(); }   // g294
}

/** g366-g518; the front groups run before the movement pass under sourcedSheetOrder. */
export function secondPassEarly(this: Sim, f: number) {
  const mask2 = this.maskFullyOn, p = this.puppet;
  const sheet = this.opts.sourcedSheetOrder, views = sheet && this.opts.sourcedViewDraws;
  if (!sheet) this.secondPassFront(f);
  if (views && !this.opts.sourcedRouteViewDraws) { this.drawViewed(f, 'g366'); this.drawViewed(f, 'g368'); }
  { const u = unitOf(this, 'mangle');
    if (at122(u) && mask2 && every(this, '400', 1000) && one(this, 10)) { this.rng.int(0, 3, 0); this.unitLeave(u); }       // g400
    if (at122(u) && u.maskExposureTicks >= 5 && mask2) { this.rng.int(0, 3, 0); this.unitLeave(u); } }          // g401
  if (this.opts.sourcedPuppetMoveOrder && this.puppet.pending && !this.puppet.atOpening && !this.puppet.inside) {
    this.puppet.pending = false;                                                     // g403-g411
    this.advancePuppet();
  }
  if (views && !this.opts.sourcedRouteViewDraws) this.drawViewed(f, 'g419');
  { const u = unitOf(this, 'toybonnie');
    const overlays = this.units.some(x => (x.id === 'toybonnie' || x.id === 'toychica') && x.officeCue);
    if (at122(u) && mask2 && !this.blackout.active && !overlays && every(this, '436', 500) && one(this, 2))
      this.startOfficeEncounter(u);                                                  // g436
    if (at122(u) && mask2 && this.blackout.active && !u.officeCue && every(this, '437', 1000) && one(this, 3)) {
      u.pending = false;
      this.unitLeave(u, { idx: u.path.indexOf(3) });                                 // g437
    } }
  { const u = unitOf(this, 'toychica');
    if (at122(u) && mask2 && every(this, '439', 1000) && one(this, 10)) { this.rng.int(0, 3, 0); this.unitLeave(u); }       // g439
    if (at122(u) && u.maskExposureTicks >= 5 && mask2) { this.rng.int(0, 3, 0); this.unitLeave(u); } }          // g440
  if (views) this.drawViewed(f, 'fades');                                             // g468-g476
  {
    if (this.box <= 0 && every(this, '494', 1000) && p.stage < C.PUPPET_ESCAPE_STAGES &&
        this.rng.int(0, 19, 0) <= this.ai.puppet && !this.camLightOn && this.viewing === C.BOX_CAM) puppetStage(this);   // g494
    if (this.box <= 0 && every(this, '495', 1000) && p.stage < C.PUPPET_ESCAPE_STAGES &&
        this.rng.int(0, 19, 0) <= this.ai.puppet && this.viewing !== C.BOX_CAM) puppetStage(this);                      // g495
    if (every(this, '496', 1000) && this.rng.int(0, 19, 0) <= this.ai.puppet &&
        p.out && !p.atOpening && !p.inside && unitStunReady(this, p, f)) p.pending = true;                   // g496
    if (this.hooked ? this.passEvery(this.hookTimers.g497, 1000) : f % C.FPS === 0)                          // g497
      p.pathChoice = this.rng.int(1, 2, 1) === 1 ? 'left' : 'right';
  }
  if (views) this.drawViewed(f, 'g498');
  if (sheet && this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchEarly();          // g500-g506
  if (sheet) this.blackoutFlicker(f);                                                  // g517/g518
}

/** g556-g781; under sourcedSheetOrder also the hour table (g673-g684) and g774 in sheet order. */
export function secondPassLate(this: Sim, f: number) {
  const mask2 = this.maskFullyOn, p = this.puppet;
  const sheet = this.opts.sourcedSheetOrder;
  for (const [id, key] of G556) {                                                      // g556-g559
    const u = unitOf(this, id);
    if (u && u.inside && !danger2(this) && mask2 && every(this, key, 1000) && one(this, 2))
      this.commitAttack(u, 'inside-office mask attack roll');
  }
  attackAnimationLate(this);                                                        // g575-g595, before g611/g623
  if (this.bb.cueRedraw) { this.bb.cueRedraw = false; this.rng.int(0, 2, 0); }        // g611: a cue of 4 redrawn (sourcedBBMoves)
  if (p.atOpening && every(this, '623', 1000) && one(this, 10)) {                                  // g623
    p.atOpening = false; p.inside = true; p.loc = 'inside';
    p.attackAt = f + C.INSIDE_ATTACK_FRAMES;
    this.dropEverything = true;
    this.emit('puppet-attack', { at: 123 });
  }
  const hourTable = this.opts.sourcedHourTable && this.opts.night !== 7;
  if (hourTable) {                                                                     // g627-g630, then g673-g684
    let rows = f === 1 ? 0 : -1;
    if (this.hooked) {
      if (this.passEvery(this.hookTimers.g627, 1000)) this.am++;
      if (this.am >= 70) { this.am = 0; this.hour++; rows = this.hour; }
    } else if (f % C.HOUR_FRAMES === 0) rows = f / C.HOUR_FRAMES;
    if (rows >= 0) this.applyAiHour(rows);
  } else if (sheet && !this.hooked && f % C.HOUR_FRAMES === 0) this.applyAiHour(f / C.HOUR_FRAMES);   // g673-g684
  if (sheet && this.opts.sourcedVentCamDraws) this.ventCamDraws();                      // g685-g690
  if (sheet && this.opts.sourcedFootstepDraws) this.footstepDraws();                    // g695-g703
  if (this.hooked && !hourTable) {                                                     // g627, g629/g630, g673-g684
    if (this.passEvery(this.hookTimers.g627, 1000)) this.am++;
    if (this.am >= 70) { this.am = 0; this.hour++; this.applyAiHour(this.hour); }
  }
  if (this.opts.sourcedBoxCountdown) this.drainBoxCountdown();                         // g652-g661
  { const u = unitOf(this, 'mangle');
    if (u && u.inside && this.viewing > 0 && every(this, '730', 1000) && one(this, 20)) u.insideArmed = true;             // g730
    for (const [g, cue] of MANGLE_CUES)
      if (u && u.inside && every(this, g, 1000) && one(this, 20) && cue) this.rng.int(0, 2, 0);                          // g739-g743
  }
  if (this.hooked ? this.passEvery(this.hookTimers.g744, 1000) : f % C.FPS === 0) this.rollDecidePath();   // g744
  for (const [id, key] of G747) {                                                      // g747-g750
    const u = unitOf(this, id);
    if (u && u.inside && mask2 && every(this, key, 1000) && one(this, 10)) {
      if (id === 'withbonnie' || id === 'withchica') this.rng.int(0, 3, 0);
      this.unitLeave(u, { idx: 0, cooldown: C.INSIDE_LEAVE_COOLDOWN });
    }
  }
  if (sheet && this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchLate();           // g774
  { const latch = this.opts.sourcedFoxyChain ? this.hallLatch : this.hallLightOn;    // g781
    if (this.ai.golden > 0 && !latch && every(this, '781', 1000)) {
      const there = this.rng.int(0, C.GF_HALL_ROLL - 1, 1) === 1;
      if (this.opts.gfEnabled && !this.gf.hallInside && there !== this.gf.inHall) {
        this.gf.inHall = there;
        this.gf.hallExposure = 0;
        if (there) this.emit('gf-hall');
      }
    } }
  // g787 copies the Custom Night dials and g821 sets the Puppet, once, after g781 (sourcedCustomDialOrder)
  if (f === 1 && this.opts.sourcedCustomDialOrder && this.opts.night === 7) this.applyAiHour(0);
}

/** g685-g690: Random(4) the first loop a unit stands on CAM 05/06, re-armed when it leaves (sourcedVentCamDraws). */
export function ventCamDraws(this: Sim) {
  for (const [id, cam] of VENT_CAM_SITES) {
    let here;
    if (id === 'puppet') {
      const p = this.puppet;
      here = p.out && !p.atOpening && !p.inside && p.route ? p.route[p.idx] === cam : false;
    } else {
      const u = unitOf(this, id);
      here = !!u && !u.done && !u.atOpening && !u.inside && u.path[u.idx] === cam;
    }
    if (here && !this.ventCamDrawn[id]) { this.ventCamDrawn[id] = true; this.rng.int(0, 3, 0); }
    else if (!here) this.ventCamDrawn[id] = false;
  }
}

/** g811: Random(1000) once per stretch of viewing == 0 (sourcedRandomImageDraw). */
export function randomImageDraw(this: Sim) {
  if (this.viewing === 0) {
    if (this.randomImageArmed) { this.randomImageArmed = false; this.rng.int(0, 999, 0); }
  } else this.randomImageArmed = true;
}

/** The markers whose hop sets a footstep cue (footstepCamMarkers adds CAM 01-04). */
export function footstepNodes(this: Sim) { return this.opts.footstepCamMarkers ? FOOTSTEP_CAM_NODES : FOOTSTEP_NODES; }

/** g695-g703: one draw per pending footstep cue, in sheet order (sourcedFootstepDraws). */
export function footstepDraws(this: Sim) {
  if (this.opts.sourcedFootstepValue2) {
    const g5 = this.value5(this.frame);
    for (const u of this.units) {
      if (u.value2 > 0) u.value2 = Math.max(0, u.value2 - g5);                             // g458-g466
      const office = this.opts.sourcedOfficeFootsteps && u.atOpening && OFFICE_FOOTSTEP_IDS.has(u.id);   // 122
      const on = u.value2 > 0 && !u.done && !u.inside && (office || (!u.atOpening && this.footstepNodes().has(u.path[u.idx])));
      u.footstep = on && !u.footstepOn;                                                    // g695-g703, NotAlways
      u.footstepOn = on;
    }
  }
  for (const id of FOOTSTEP_IDS) {
    const holder = id === 'foxy' ? this.foxy : id === 'bb' ? this.bb : unitOf(this, id);
    if (!holder || !holder.footstep) continue;
    holder.footstep = false;
    const value = this.rng.int(0, id === 'mangle' ? 2 : 4, 0) + 1;   // cam01 value 5 = Random(5)+1; Mangle: value 12 = Random(3)+1
    // g704-g708 play samples 25-29 from value 5; g709-g711 play 30-32 from value 12: the draw is audible
    this.emit('footstep', { who: id, value, sample: id === 'mangle' ? 29 + value : 24 + value });
  }
}

/** Blackout flicker: the g514 clock and the g517/g518 draw (sourcedBlackoutDraws). */
export function blackoutFlicker(this: Sim, f: number) {
  blackoutClock.startStreakEncounters(this);
  blackoutClock.blackoutFlicker(this, f);
}

/**
 * The Office frame's unconditional timer draws, g58/g59/g192, before g337.
 * The separate g822 StartOfFrame draw runs once, before the first loop.
 */
export function drawUnconditional(this: Sim) {
  const loading = this.opts.sourcedEveryOrigin && this.frame === 1;
  for (const t of this.unconditionalTimers) {
    if (loading) continue;
    t.counter -= this.frameUnits;
    if (t.counter <= 0) { t.counter += t.delayUnits; this.rng.next(); this.unconditionalDraws++; }
  }
}
