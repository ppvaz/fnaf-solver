// The music box and the Puppet: winding and the drain (g637-g661), his escape, route and attack (g403-g411,
// g494-g497, g623), and his static glitch draws (g500-g506, g774). Each function is a Sim method;
// plant-model.js installs it on Sim.prototype.
import * as C from './config.ts';
import { unitStunReady, setUnitStun } from './movement-clock.ts';
import type { Sim } from './plant-model.ts';

/** g653-g661: the music box drain as a gated Every 50 ms, then the wind hold's drain (sourcedBoxCountdown). */
export function drainBoxCountdown(this: Sim) {
  if (!this.opts.boxEnabled) return;
  const units = Math.round(this.box * C.BOX_UNITS);
  const hour = this.hooked ? this.hour : Math.floor(this.frame / C.HOUR_FRAMES);
  if (this.boxHold === 0 && units > 0 && C.boxDrainsAtHour(this.opts.night, hour) &&
      this.gatedPass('box', C.BOX_DRAIN_TICK_MS))
    this.box = Math.max(0, units - (C.BOX_DRAIN_PER_TICK[this.opts.night] ?? C.BOX_DRAIN_PER_TICK[7])) / C.BOX_UNITS;
  if (this.boxHold > 0)                                                                  // g661
    this.boxHold = Math.max(0, this.boxHold - this.value5(this.frame));
}

/** your-view overlaps the Puppet: his route camera when out, CAM 11 in the box. */
export function puppetUnderYourView(this: Sim) {
  const p = (this.puppet as any);
  const at = !p.out ? C.BOX_CAM : (typeof p.loc === 'number' ? p.loc : null);
  return at !== null && at === this.cam;
}

/** the Puppet sits on the CAM 11 marker (in his box or just escaped) */
export function puppetAtBoxCam(this: Sim) {
  const p = (this.puppet as any);
  return !p.out || p.loc === C.BOX_CAM;
}

/** `lit?` (OI 75): the events 74-83 counter under sourcedFoxyChain, else the camera light. */
export function litCounter(this: Sim) { return this.opts.sourcedFoxyChain ? this.hallLit : this.camLightOn; }

/** g500-g502, g503, g505 (take one off, then 100-Random(150)), g506 in sheet order (sourcedPuppetGlitchDraws). */
export function puppetGlitchEarly(this: Sim) {
  const g = this.glitch;
  const lead = () => this.puppetUnderYourView() && this.viewing > 0 && g.value5 === 1 && !this.litCounter();
  const one = () => this.rng.int(0, 49, 1) === 1;
  for (let i = 0; i < 3; i++)                                                       // g500-g502
    if (lead() && !this.puppetAtBoxCam() && one()) g.value4 = 1;
  if (lead() && this.passEvery(g.g503, 1000) && !this.puppetAtBoxCam() && one()) g.value4 = 1;   // g503: countdown after lit == 0
  if (g.value4 > 0) { g.value4 -= 1; this.rng.int(0, 149, 0); }                     // g505
  if (this.passEvery(g.g506, 110)) g.value5 = 0;                                             // g506
}

/** g774: the light on the Puppet away from CAM 11 raises the glitch flag. */
export function puppetGlitchLate(this: Sim) {
  if (this.puppetUnderYourView() && !this.puppetAtBoxCam() && this.viewing > 0 && this.litCounter())
    this.glitch.value5 = 1;
}

export function tickBox(this: Sim) {
  if (!this.opts.boxEnabled) return;
  if (this.isWinding) {
    // g637/g644: the 'WinD' ratchet on a global 500 ms timer. Frame-locked
    // grid, so the edge carries the game's phase mod WIND_TICK_FRAMES.
    if (this.hooked ? this.halfTick : this.frame % C.WIND_TICK_FRAMES === 0)   // g637/g644
      this.emit('wind-tick', { sample: C.WIND_TICK_SAMPLE });
    // g639/g645: a wind below 300 snaps the counter to 300 first. The climb
    // rate below is already the 300 -> 2000 one, so without this the engine
    // was slower than the game at the bottom of the box -- the only place
    // the difference can cost a night.
    this.box = Math.min(1, Math.max(this.box, C.BOX_SNAP) + 1 / C.BOX_WIND_FRAMES);
    this.boxHold = 10;                                                                     // g638/g643
  } else if (this.opts.sourcedBoxCountdown) {
    // drained in the late pass (drainBoxCountdown)
  } else if (C.boxDrainsAtHour(this.opts.night, Math.floor(this.frame / C.HOUR_FRAMES))) {
    // Per-night rate, sourced at g653-660, and g653's hour gate: night 1's
    // box does not drain during 12 AM or 1 AM. This used to apply the night
    // 6/7 rate from t=0 to every night, which made Night 1 demand winding
    // 3.3x sooner than the game does and two hours earlier than it starts.
    this.box = Math.max(0, this.box - 1 / C.boxDrainFrames(this.opts.night));
  }
  this.tickPuppet();
}

// Puppet source order is route actions g404-411, the one-second arm/branch
// groups g494-497, the office roll g623, and finally the camera B=10 write
// g774. A successful roll therefore becomes a move on the next frame.
export function tickPuppet(this: Sim) {
  const p = (this.puppet as any);
  const f = this.frame;

  if (p.attackAt >= 0) {
    if (!this.opts.sourcedAttackAnimation && f >= p.attackAt)
      this.kill('puppet', 'The Puppet completed the sourced 40-frame marker-123 attack');
    return;
  }

  if (p.pending && !p.atOpening && !p.inside && !this.opts.sourcedPuppetMoveOrder) {
    p.pending = false;
    this.advancePuppet();
  }

  if (f % C.FPS === 0 && !this.opts.sourcedSecondPass) {
    // g494/g495: three successful one-second rolls while the box is empty.
    // CAM 11 light blocks the viewing=11 branch; every other view rolls.
    if (this.box <= 0 && !p.out && p.stage < C.PUPPET_ESCAPE_STAGES) {
      const protectedByLight = this.camLightOn && this.viewing === C.BOX_CAM;
      if (!protectedByLight && this.rng.chance(C.PUPPET_MO_CHANCE(this.ai.puppet), true)) {
        p.stage++;
        this.emit('puppet-stage', p.stage);
        if (p.stage >= C.PUPPET_ESCAPE_STAGES) {
          p.out = true;
          this.emit('puppet-out');
        }
      }
    }

    // g496: after escape, each one-second AI success arms one route hop,
    // provided B has drained to zero.
    if (p.out && !p.atOpening && !p.inside && unitStunReady(this, p, f) &&
        this.rng.chance(C.PUPPET_MO_CHANCE(this.ai.puppet), true))
      p.pending = true;

    // g497 rewrites the next 07 branch choice every second.
    p.pathChoice = this.rng.int(1, 2, 1) === 1 ? 'left' : 'right';

    // g623: marker 122 is not lethal on arrival. It rolls 1-in-10 each
    // second to move to 123; g574 then raises attack code 9 and forcedown.
    if (p.atOpening && this.rng.int(0, C.PUPPET_OFFICE_ROLL - 1, 1) === 1) {
      p.atOpening = false;
      p.inside = true;
      p.loc = 'inside';
      p.attackAt = f + C.INSIDE_ATTACK_FRAMES;
      this.dropEverything = true;
      this.emit('puppet-attack', { at: 123 });
    }
  }

  // g774 executes after the movement roll. Outside CAM 11, lighting the
  // Puppet's current camera rewrites B to 10 every frame; g372 drains it.
  if (this.camLightOn && p.out && !p.atOpening && !p.inside &&
      p.loc !== C.BOX_CAM && p.loc === this.cam)
    setUnitStun(this, p, C.PUPPET_CAMERA_PIN_FRAMES, f);
}

export function advancePuppet(this: Sim) {
  const p = (this.puppet as any);
  if (p.loc === 11) p.loc = 10;
  else if (p.loc === 10) p.loc = 7;
  else if (p.loc === 7) {
    p.route = C.PUPPET_ROUTE[p.pathChoice];
    p.loc = p.pathChoice === 'left' ? 3 : 4;
  } else if (p.loc === 3) p.loc = 1;
  else if (p.loc === 4) p.loc = 2;
  else if (p.loc === 1 || p.loc === 2) {
    p.loc = 'opening';
    p.atOpening = true;
  }
  p.idx++;
  this.emit('puppet-move', { at: p.atOpening ? 'office' : p.loc });
}
