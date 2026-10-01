// The event sheet's order: the per-second pass (g213-g781) and the Random draws the model spends where the
// sheet spends them (the camera views, the monitor-down image, the vent cameras, the random image, the
// footsteps, the blackout flicker, g58/g59/g192). Each function is a Sim method; plant-model.js installs
// it on Sim.prototype.
import * as C from './config.ts';
import { FOOTSTEP_NODES, FOOTSTEP_CAM_NODES, OFFICE_FOOTSTEP_IDS } from './plant-constants.ts';
import * as blackoutClock from './blackout-clock.ts';
import { unitStunReady } from './movement-clock.ts';
import { attackAnimationLate } from './attack-animation.ts';
import type { Sim, Unit } from './plant-model.ts';

/**
 * Camera-view draws in sheet order (sourcedViewDraws); `this.cam` is the
 * your-view marker, the last camera selected.
 */
export function drawViewed(this: Sim, f: number, part = 'all') {
  const up = this.viewing > 0, all = part === 'all';
  const toyGroup: Record<string, string> = { toybonnie: 'g366', toychica: 'g368', toyfreddy: 'g419' };
  const nodeOf = (id: string) => {
    if (id === 'bb') return this.bb.inOpening || this.bb.inside ? null : ([10, 7, 3, 1, 5][this.bb.stage] ?? null);
    if (id === 'foxy') return this.opts.foxyEnabled && this.foxy.loc === 'parts' ? 8 : null;
    const u = this.units.find(x => x.id === id);
    return !u || u.done || u.atOpening || u.inside ? null : u.path[u.idx];
  };
  if (up) for (const id of ['toybonnie', 'toychica', 'toyfreddy']) {                       // g366, g368, g419
    const u = this.units.find(x => x.id === id);
    const armed = u?.pending && (!this.opts.sourcedPromotedViewDraws || u.promoted);   // value 0 == 2
    if ((all || part === toyGroup[id]) && armed && nodeOf(id) === this.cam) this.rng.int(0, 99, 0);
  }
  if (up && (all || part === 'fades')) for (const id of ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy',
                            'toybonnie', 'toychica', 'mangle', 'bb']) {                      // g468-g476
    if (f <= (this.fadeUntil[id] ?? -1) && nodeOf(id) === this.cam) this.rng.int(0, 99, 0);
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

/** The per-second pass helpers; mask2 is read when each part starts. */
export function passTools(this: Sim, f: number) {
  const every = (key: string, ms: number) => this.passEvery(this.passTimers[key] ??= { v: 0, init: false }, ms);
  /** Random(n) == 1 */
  const one = (n: number) => this.rng.int(0, n - 1, 1) === 1;
  const unit = (id: string) => this.units.find(x => x.id === id);
  const at122 = (u: Unit | undefined): u is Unit => !!u && u.atOpening && !u.inside;
  const mask2 = this.maskFullyOn;
  const p = this.puppet;
  const danger2 = () => this.units.some(x => x.committedAt >= 0) || p.attackAt >= 0;
  return { every, one, unit, at122, mask2, p, danger2 };
}

/** g213/g292/g294 precede rolls, promotions and route moves. */
export function secondPassFront(this: Sim, f: number) {
  const { every, one, unit, mask2 } = this.passTools(f);
  { const u = unit('toyfreddy');                                                    // g213
    if (this.viewing === 0 && !this.lightHeld && u && !u.atOpening && !u.inside &&
        u.path[u.idx] === 'blindB' && mask2 && every('213', 1000) && one(10)) {
      u.idx = 0; u.pending = false;
      this.emit('route-return', { who: u.id, to: 9, group: 213 });
    } }
  if (this.bb.inOpening && mask2 && every('292', 1000) && one(10)) { this.rng.int(0, 3, 0); this.bbLeave(); }   // g292
  if (this.bb.inOpening && this.bb.maskTicks >= C.VENT_MASK_TICKS && mask2) { this.rng.int(0, 3, 0); this.bbLeave(); }   // g294
}

/** g366-g518; the front groups run before the movement pass under sourcedSheetOrder. */
export function secondPassEarly(this: Sim, f: number) {
  const { every, one, unit, at122, mask2, p } = this.passTools(f);
  const sheet = this.opts.sourcedSheetOrder, views = sheet && this.opts.sourcedViewDraws;
  if (!sheet) this.secondPassFront(f);
  if (views && !this.opts.sourcedRouteViewDraws) { this.drawViewed(f, 'g366'); this.drawViewed(f, 'g368'); }
  { const u = unit('mangle');
    if (at122(u) && mask2 && every('400', 1000) && one(10)) { this.rng.int(0, 3, 0); this.unitLeave(u); }       // g400
    if (at122(u) && u.maskExposureTicks >= 5 && mask2) { this.rng.int(0, 3, 0); this.unitLeave(u); } }          // g401
  if (this.opts.sourcedPuppetMoveOrder && this.puppet.pending && !this.puppet.atOpening && !this.puppet.inside) {
    this.puppet.pending = false;                                                     // g403-g411
    this.advancePuppet();
  }
  if (views && !this.opts.sourcedRouteViewDraws) this.drawViewed(f, 'g419');
  { const u = unit('toybonnie');
    const overlays = this.units.some(x => (x.id === 'toybonnie' || x.id === 'toychica') && x.officeCue);
    if (at122(u) && mask2 && !this.blackout.active && !overlays && every('436', 500) && one(2))
      this.startOfficeEncounter(u);                                                  // g436
    if (at122(u) && mask2 && this.blackout.active && !u.officeCue && every('437', 1000) && one(3)) {
      u.pending = false;
      this.unitLeave(u, { idx: u.path.indexOf(3) });                                 // g437
    } }
  { const u = unit('toychica');
    if (at122(u) && mask2 && every('439', 1000) && one(10)) { this.rng.int(0, 3, 0); this.unitLeave(u); }       // g439
    if (at122(u) && u.maskExposureTicks >= 5 && mask2) { this.rng.int(0, 3, 0); this.unitLeave(u); } }          // g440
  if (views) this.drawViewed(f, 'fades');                                             // g468-g476
  {
    const stage = () => {
      p.stage++;
      this.emit('puppet-stage', p.stage);
      if (p.stage >= C.PUPPET_ESCAPE_STAGES) { p.out = true; this.emit('puppet-out'); }
    };
    if (this.box <= 0 && every('494', 1000) && p.stage < C.PUPPET_ESCAPE_STAGES &&
        this.rng.int(0, 19, 0) <= this.ai.puppet && !this.camLightOn && this.viewing === C.BOX_CAM) stage();   // g494
    if (this.box <= 0 && every('495', 1000) && p.stage < C.PUPPET_ESCAPE_STAGES &&
        this.rng.int(0, 19, 0) <= this.ai.puppet && this.viewing !== C.BOX_CAM) stage();                      // g495
    if (every('496', 1000) && this.rng.int(0, 19, 0) <= this.ai.puppet &&
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
  const { every, one, unit, mask2, p, danger2 } = this.passTools(f);
  const sheet = this.opts.sourcedSheetOrder;
  for (const id of ['withfreddy', 'withbonnie', 'withchica', 'toyfreddy']) {           // g556-g559
    const u = unit(id);
    if (u && u.inside && !danger2() && mask2 && every('556' + id, 1000) && one(2))
      this.commitAttack(u, 'inside-office mask attack roll');
  }
  attackAnimationLate(this);                                                        // g575-g595, before g611/g623
  if (this.bb.cueRedraw) { this.bb.cueRedraw = false; this.rng.int(0, 2, 0); }        // g611: a cue of 4 redrawn (sourcedBBMoves)
  if (p.atOpening && every('623', 1000) && one(10)) {                                  // g623
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
  { const u = unit('mangle');
    if (u && u.inside && this.viewing > 0 && every('730', 1000) && one(20)) u.insideArmed = true;             // g730
    for (const [g, cue] of ([['739', true], ['740', true], ['741', true], ['742', false], ['743', false]] as [string, boolean][]))
      if (u && u.inside && every(g, 1000) && one(20) && cue) this.rng.int(0, 2, 0);                          // g739-g743
  }
  if (this.hooked ? this.passEvery(this.hookTimers.g744, 1000) : f % C.FPS === 0) this.rollDecidePath();   // g744
  for (const id of ['withfreddy', 'withbonnie', 'withchica', 'toyfreddy']) {           // g747-g750
    const u = unit(id);
    if (u && u.inside && mask2 && every('747' + id, 1000) && one(10)) {
      if (id === 'withbonnie' || id === 'withchica') this.rng.int(0, 3, 0);
      this.unitLeave(u, { idx: 0, cooldown: C.INSIDE_LEAVE_COOLDOWN });
    }
  }
  if (sheet && this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchLate();           // g774
  { const latch = this.opts.sourcedFoxyChain ? this.hallLatch : this.hallLightOn;    // g781
    if (this.ai.golden > 0 && !latch && every('781', 1000)) {
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
  const sites: [string, number][] = [['toychica', 5], ['withbonnie', 5], ['toybonnie', 6], ['withchica', 6], ['mangle', 6], ['puppet', 6]];
  for (const [id, cam] of sites) {
    let here;
    if (id === 'puppet') {
      const p = this.puppet;
      here = p.out && !p.atOpening && !p.inside && p.route ? p.route[p.idx] === cam : false;
    } else {
      const u = this.units.find(x => x.id === id);
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
  for (const id of ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy', 'toybonnie', 'toychica', 'bb', 'mangle']) {
    const holder = id === 'foxy' ? this.foxy : id === 'bb' ? this.bb : this.units.find(x => x.id === id);
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
