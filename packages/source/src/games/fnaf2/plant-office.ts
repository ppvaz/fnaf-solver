// The office's controls and encounters: the player's presses and the gates that drop them (g254-g270,
// g614-g619), the forcedown (g262, g274, g612), and the office encounter from its blackout to marker 123
// (g443-g447, g530-g562). Each function is a Sim method; plant-model.js installs it on Sim.prototype.
import * as C from './config.ts';
import { MON_DOWN, MON_RAISING, MON_UP, MON_LOWERING } from './plant-constants.ts';
import type { Sim } from './plant-model.ts';


export function press(this: Sim, action) {
  if (!this.alive) return;
  // Two input gates the engine had never enforced, both about reachability
  // rather than effect:
  //
  // 1. The mask cannot go on with the monitor up. There is no state in which
  //    both are raised, so a mask press while the cams are up is not a
  //    toggle -- it is an input the player cannot make.
  // 2. While the mask is on, the only control that answers is the mask
  //    itself. This is the input-side half of the g75/g84 lockout the light
  //    getters already model: a masked player can only take the mask off.
  //
  // Both matter for an open-loop pilot, whose table presses buttons without
  // checking what state the game is actually in: presses that the device
  // silently drops must be dropped here too, or the simulation flatters a
  // schedule that the phone would not execute.
  // `maskOn` is the steady endpoint, while `maskAnim` also covers the
  // lowering interval after the off press. During that interval the mask is
  // still the visible/input-owning surface; clearing maskOn early must not
  // make the simulator accept monitor, camera, light, or wind touches that
  // the phone draws on the mask and drops.
  if ((this.maskOn || this.maskAnim > 0) && action !== 'mask') return;
  if (action === 'mask' && !this.maskOn &&
      (this.monitor === MON_UP || this.monitor === MON_RAISING)) return;
  // Puppet at marker 123 has already written `being attacked by` (g574),
  // so g267/g270 no longer accept a new mask press during his 40-frame
  // attack transition.
  if (action === 'mask' && !this.maskOn &&
      (this.puppetAttackExecuting || this.goldenHallAttackExecuting)) return;
  // g267/g270 require `being attacked by` (136) = 0, so a COMMITTED attack
  // refuses the mask. Corrected 2026-08-26: this used to read the reaction
  // countdown (`got you stage` == 1) instead, and so forbade for the whole
  // window the one action g533 says ends it. No withered that reached the
  // office was survivable in this simulator until that was split apart.
  if (action === 'mask' && !this.maskOn && this.attackExecuting) return;
  // sourcedDropFlagOrder: with the mask on, the touch lands on the drop button; g619 reads it at
  // its sheet position (mask == 2 by then, even if g9 finished the put-on at this update's top).
  if (action === 'mask' && this.maskOn && this.opts.sourcedDropFlagOrder) { this.dropTouch = this.frame; return; }
  // The mask answers only at rest. g270 puts it on from `mask` == 0 and g615
  // takes it off from `mask` == 2; states 1 and 3 are the put-on and
  // take-off animations (g9 moves 1 -> 2 after 12 frames), and no group
  // accepts a touch there. The simulator used to toggle mid-animation, so it
  // scored minus7's Night 1 clear cycle -- mask on inside its read, off 133
  // ms later in the maskraise -- as a winner while the phone dropped that
  // press on 48 of 55 cycles (night1-minus7-n1-first-20260919T215533Z) and
  // 23 of 45 (night1-ladder-n1a-20260927T053211Z, 2026-09-27).
  if (action === 'mask' && this.maskAnim > 0) return;
  if (action === 'light') {
    this.lightHeld = true;
    this.onLightPress();
  } else if (action === 'mask') {
    this.setMask(!this.maskOn);
  } else if (action === 'monitor') {
    const lower = this.monitor === MON_UP || this.monitor === MON_RAISING;
    if (!lower && this.opts.sourcedMonitorRaiseGate &&
        (this.monitor !== MON_DOWN || !this.maskFullyOff || this.blackout.active || this.attackExecuting)) {
      this.flag('invalid-input', 'g254/g257: monitor raise refused (panel moving, mask not fully off, in danger, or being attacked)');
      return;
    }
    if (lower && this.opts.sourcedDropLightOrder) {
      // g614/g618: the drop button only raises the flag, and only from a
      // fully-up monitor with the mask off; g262 performs it next frame.
      // sourcedDropFlagOrder: g618 reads the touch at its sheet position (readDropTouch).
      if (this.opts.sourcedDropFlagOrder) this.dropTouch = this.frame;
      else if (this.monitor === MON_UP && this.maskFullyOff) this.dropEverything = true;
      return;
    }
    this.setMonitor(!lower);
  } else if (action === 'wind') {
    this.winding = true;
  } else if (action === 'ventL' || action === 'ventR') {
    // Loud rejection: the press is recorded, but a vent light asserted with a
    // camera up lights nothing (g301/g303/g320 require `viewing` = 0). Flag it
    // so a plan search or gate sees a wasted contact instead of silently
    // banking an effect the phone cannot produce.
    if (!this.hallView) this.flag('invalid-input', `${action} pressed with a camera up: g301/g303/g320 require viewing = 0`);
    if (action === 'ventL') this.ventLightL = true; else this.ventLightR = true;
  }
  else if (action.startsWith('cam:')) {
    const n = +action.slice(4);
    if (this.monitor === MON_UP && C.CAMS[n]) {
      this.cam = n;
      this.viewing = n;
    }
  }
}

export function release(this: Sim, action) {
  if (action === 'light') this.lightHeld = false;
  else if (action === 'wind') this.winding = false;
  else if (action === 'ventL') this.ventLightL = false;
  else if (action === 'ventR') this.ventLightR = false;
}

export function setMask(this: Sim, on) {
  if (this.maskOn === on) return;
  this.maskOn = on;
  this.maskAnim = on ? C.MASK_ANIM_ON + (this.opts.sourcedAnimationCount ? 1 : 0) : C.MASK_ANIM_OFF;   // g9 >= 12, g10 >= 14
  if (on) {
    // g776 dismisses him only once `mask` = 2 -- after the put-on animation
    // (see the maskAnim completion in tick()), not at the press.
  } else {
    // For the four shared office attackers, taking the mask back off after
    // they have reached marker 123 immediately raises `danger 2`
    // (Android groups 560-563).
    for (const u of this.units) {
      if (u.inside && u.openingRule === 'streak')
        this.commitAttack(u, 'mask was removed with an attacker inside the office');
    }
  }
}

export function setMonitor(this: Sim, up) {
  if (up && (this.monitor === MON_UP || this.monitor === MON_RAISING)) return;
  if (!up && (this.monitor === MON_DOWN || this.monitor === MON_LOWERING)) return;
  if (up) {
    if (this.gf.present) { this.kill('golden-freddy', 'Raised the monitor with Golden Freddy in the office'); return; }
    this.monitor = MON_RAISING; this.monAnim = C.MONITOR_ANIM_UP + (this.opts.sourcedAnimationCount ? 1 : 0);   // g1 >= 12
    // Mangle's marker-122 flag is set while the monitor-raise object is
    // visible (group 402), then consumed when that object disappears.
    for (const u of this.units) {
      if (u.id === 'mangle' && u.atOpening) u.raiseSeen = true;
    }
    this.camsUpSince = this.frame; // the source counter runs from the tap
  } else {
    this.monitor = MON_LOWERING; this.monAnim = C.MONITOR_ANIM_DOWN + (this.opts.sourcedAnimationCount ? 1 : 0);   // g6 >= 22
    if (this.opts.sourcedMonitorDownDraw) this.monDown.pendingDrop = true;   // e211 shows the sprite
    // g262 clears the displayed feed immediately but leaves the marker and
    // sampled last-viewed camera untouched.
    this.viewing = 0;
    this.winding = false;
    this.camsUpSince = -1; // the source resets the streak on lowering
    // The monitor-lowering object (`blip`) raises `danger 2` for the six
    // regular marker-123 occupants (groups 564-569). Mangle instead needs
    // her separate cameras-up random arm from groups 730-731.
    for (const u of this.units) {
      if (!u.inside) continue;
      if (u.id === 'mangle') {
        if (u.insideArmed) this.commitAttack(u, 'Mangle armed while the cameras were up');
      } else {
        this.commitAttack(u, 'lowered the monitor with an attacker inside the office');
      }
    }
  }
}

export function startBlackout(this: Sim, by, unitId = null) {
  this.blackoutStartFrame = this.frame;
  this.blackoutClock = 0;
  this.blackoutClockFrame = this.frame - 1;
  this.blackout = { active: true, until: this.frame + C.BLACKOUT_FRAMES, by,
                    unitId, masked: this.maskFullyOn,
                    deadline: this.frame + C.maskGraceFrames(this.opts.night) };
  this.blackoutCount++;
  this.emit('blackout', by);
}

export function startOfficeEncounter(this: Sim, u) {
  if (this.blackout.active || !u.atOpening) return;
  u.officeCue = true;
  this.startBlackout(u.name, u.id);
  this.emit('office-cue', u.id);
}

export function unitEnterInside(this: Sim, u, why) {
  u.atOpening = false; u.officeRoll = false;
  u.inside = true;
  u.officeCue = false;
  u.raiseSeen = false;
  u.openingSince = -1;
  u.openingReadyAt = -1;
  u.openingTicks = 0;
  if (this.engagedToy === u.id) this.engagedToy = null;
  this.emit('office-entry', { who: u.id, why });
  this.flag('inside-office', `${u.name} reached marker 123: ${why}`);
}

// Worst luck for the player is the shortest immunity, so the roll pins to 0.
export function repelCooldown(this: Sim) {
  return Math.floor(this.rng.int(0, C.REPEL_COOLDOWN_ROLL - 1, 0) / this.opts.night);
}

// g532 / g556-559 -> `being attacked by` = N. Past this point the mask is
// refused (g267) and everything is forced down (g624); nothing cancels it.
export function commitAttack(this: Sim, u, why) {
  if (u.committedAt >= 0) return;
  u.insideDangerAt = -1;
  u.committedAt = this.frame + C.INSIDE_ATTACK_FRAMES;
  this.dropEverything = true;   // g624
  this.emit('inside-committed', { who: u.id, why });
}

export function armInsideAttack(this: Sim, u, why) {
  if (u.insideDangerAt >= 0) return;
  // `got you stage` = 1 and `time left` = `time allowed`, per night (g530).
  u.insideDangerAt = this.frame + C.timeAllowedFrames(this.opts.night);
  // NOT dropEverything. g624 gates on `being attacked by` (136) > 0 -- the
  // COMMITTED attack -- and g274 turns `drop everything` into mask = 3, i.e.
  // it forces the mask OFF. Setting it here, at `got you stage` = 1, made the
  // bug self-reinforcing: the mask could never reach `mask == 2`, so g533's
  // escape was unreachable even once the gate above was removed. Third place
  // the same two source variables had been merged.
  this.emit('inside-armed', { who: u.id, why });
}

// g262 lowers the monitor and zeroes `viewing`, g274 takes the mask off, and
// g612 clears the flag -- all in the same frame it was set. The player's own
// presses that frame are read at g254-270, i.e. after the monitor forcedown
// and before the mask one, so running this at the top of the tick reproduces
// the order: neither a monitor nor a mask press survives a forcedown.
export function tickForcedown(this: Sim) {
  if (!this.dropEverything) return;
  this.dropEverything = false;
  if (this.monitor === MON_UP || this.monitor === MON_RAISING) this.setMonitor(false);
  if (this.maskOn) this.setMask(false);
  this.emit('forcedown');
}

// sourcedDropFlagOrder: g618/g619 read this update's drop-button touch after g262/g274 and g612,
// so the flag they raise is performed by the next tick's tickForcedown. A touch from an update
// whose tick returned early (a non-lethal kill) is dropped. (v1, the flip lock g262, g270 and
// g274 set, is not modelled: it is 0 here for a tap that is not still held from them.)
export function readDropTouch(this: Sim) {
  const touched = this.dropTouch === this.frame - 1;
  this.dropTouch = -1;
  if (!touched) return;
  if (this.monitor === MON_UP && this.maskFullyOff) this.dropEverything = true;                         // g618
  else if (this.maskFullyOn && this.viewing === 0) {                                                    // g619
    if (this.blackout.active) this.flag('invalid-input', 'g619: mask-off refused in danger');
    else this.dropEverything = true;
  }
}
