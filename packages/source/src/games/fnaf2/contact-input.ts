// Sourced panel contacts: g258 releases the flip lock before g262/g270/g274;
// g618/g619 re-read a held bottom contact late. Camera selection is on release (g35-g40).
// Contact timing is supplied explicitly; legacy press/release callers retain their tap semantics.
import * as C from './config.ts';
import type { Sim } from './plant-model.ts';
export type ContactInput = { monitor: boolean; mask: boolean; flipLock: boolean; cameraNew: string | null;
  cameraLatch: string | null; cameraReleased: string | null };

export function enableContacts(sim: Sim): ContactInput {
  if (!(sim.opts.sourcedDropFlagOrder && sim.opts.sourcedSheetOrder))
    throw new Error('contact input requires sourcedDropFlagOrder and sourcedSheetOrder');
  return sim.contactInput ??= { monitor: false, mask: false, flipLock: false,
    cameraNew: null, cameraLatch: null, cameraReleased: null };
}

export function contactDown(sim: Sim, action: string) {
  const c = enableContacts(sim);
  if (action === 'monitor' || action === 'mask') c[action] = true;
  else if (action.startsWith('cam:') && C.CAMS[+action.slice(4)]) c.cameraNew = action;
  else sim.press(action);
}

export function contactUp(sim: Sim, action: string) {
  const c = enableContacts(sim);
  if (action === 'monitor' || action === 'mask') c[action] = false;
  else if (action.startsWith('cam:')) c.cameraReleased = action;
  else sim.release(action);
}

/** g258 precedes the forcedown and mask-on writes. */
export function releaseFlipLock(sim: Sim) {
  const c = sim.contactInput;
  if (c && !c.monitor && !c.mask) c.flipLock = false;
}

/** After animation latches, before the late drop-button read. */
export function readContactInput(sim: Sim) {
  const c = sim.contactInput;
  if (!c) return;
  if (!sim.camsUp) c.cameraLatch = null;
  if (c.cameraReleased && c.cameraLatch === c.cameraReleased && sim.camsUp && sim.maskFullyOff) {
    sim.cam = sim.viewing = +c.cameraReleased.slice(4);
    c.cameraLatch = null;
  }
  c.cameraReleased = null;
  if (c.cameraNew) c.cameraLatch = sim.camsUp && sim.maskFullyOff ? c.cameraNew : null;
  c.cameraNew = null;
  if (c.flipLock) return;
  if (c.monitor && sim.monitor === 'down' && sim.maskFullyOff && !sim.blackout.active && !sim.attackExecuting)
    sim.setMonitor(true); // g257/g258 leave v1=0; the retained native probe reads this boundary.
  if (c.mask && sim.maskFullyOff && sim.monitor !== 'raising' && sim.monitor !== 'up' &&
      sim.viewing === 0 && !sim.attackExecuting && !sim.puppetAttackExecuting && !sim.goldenHallAttackExecuting)
    sim.setMask(true); // g270 follows g258 and holds v1=1 until release.
}

export function heldDropTouch(sim: Sim) {
  const c = sim.contactInput;
  return !!c && !c.flipLock && (c.monitor || c.mask);
}
