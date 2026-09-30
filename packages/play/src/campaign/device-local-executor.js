/**
 * Full-night scheduler for the device boundary.
 *
 * A compiled request contains one opening and one repeatable steady-cycle
 * block set. This expands the repeatable cycle against the declared timing,
 * then delegates each semantic block to a device-local apply port. The host
 * never sends one ADB command per action and this class never interprets a
 * strategy or chooses a control.
 * CONTRACT:device-executor-v1.
 */
import { validateExecutorRequest } from './artifact-executor.js';

const sleepDefault = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`device-local executor: ${message}`); };

export function expandNightBlocks(request, night) {
  validateExecutorRequest(request);
  const plan = request.artifact.plans.find(item => item.night === night);
  if (!plan) fail(`night ${night} is not bound to the request`);
  const blocks = request.blocks.filter(block => block.night === night);
  const opening = blocks.filter(block => block.cycle === 'opening');
  const steady = blocks.filter(block => block.cycle === 'toys');
  const finish = blocks.filter(block => block.cycle === 'finish');
  const others = blocks.filter(block => !['opening', 'toys', 'finish'].includes(block.cycle));
  if (!opening.length || (!steady.length && !others.length)) fail(`night ${night} has no runnable opening/steady blocks`);
  const { periodMs, loopStartMs, stopAtMs, idleUntilMs } = plan.timing;
  const startMs = Math.max(loopStartMs, idleUntilMs);
  // Opening rows are authored on the night timeline.  `loopStartMs` gates the
  // repeatable steady cycle only; adding it to the opening moved Night 1's
  // CAM09/CAM11 arm from the authored opening to 2 AM (its 140 s idle
  // boundary), leaving the monitor in the wrong parity and making the wind
  // contact inert.  This also preserves the minimal Night 1 emitter's
  // deliberate 115 s pre-2-AM arm.
  const expanded = opening.map(block => ({ ...block, scheduleAtMs: block.atMs }));
  for (let base = startMs; base < stopAtMs; base += periodMs) {
    for (const block of steady) {
      const scheduleAtMs = base + block.atMs;
      if (scheduleAtMs < stopAtMs) expanded.push({ ...block, scheduleAtMs });
    }
    for (const block of others) {
      const scheduleAtMs = base + block.atMs;
      if (scheduleAtMs < stopAtMs) expanded.push({ ...block, scheduleAtMs });
    }
  }
  expanded.push(...finish.map(block => ({ ...block, scheduleAtMs: block.atMs })));
  return expanded.sort((a, b) => a.scheduleAtMs - b.scheduleAtMs || a.id.localeCompare(b.id));
}

export class DeviceLocalArtifactExecutor {
  /** @param {{applyBlock?: Function, now?: Function, sleep?: Function, abort?: Function, releaseAll?: Function, lateBudgetMs?: number}} options */
  constructor({ applyBlock, now = () => performance.now(), sleep = sleepDefault,
    abort, releaseAll, lateBudgetMs = 250 } = {}) {
    if (typeof applyBlock !== 'function') throw new TypeError('device-local executor requires applyBlock');
    if (typeof abort !== 'function' || typeof releaseAll !== 'function')
      throw new TypeError('device-local executor requires abort and releaseAll');
    if (!Number.isInteger(lateBudgetMs) || lateBudgetMs < 0) throw new TypeError('lateBudgetMs must be non-negative');
    this.applyBlock = applyBlock; this.now = now; this.sleep = sleep;
    this.abortPort = abort; this.releasePort = releaseAll; this.lateBudgetMs = lateBudgetMs;
    this.running = false;
  }

  async execute(request) {
    validateExecutorRequest(request);
    if (request.mode !== 'live' && request.mode !== 'dry-run') fail('unsupported request mode');
    if (request.artifact.plans.length !== 1) fail('one night per device-local execution request is required');
    if (this.running) fail('executor is already running');
    const night = request.artifact.plans[0].night;
    const plan = request.artifact.plans[0];
    const blocks = expandNightBlocks(request, night);
    const origin = this.now();
    this.running = true;
    try {
      for (const block of blocks) {
        const due = origin + block.scheduleAtMs;
        const remaining = due - this.now();
        if (remaining > 0) await this.sleep(remaining);
        const lateMs = Math.max(0, this.now() - due);
        if (lateMs > this.lateBudgetMs) fail(`block ${block.id} is ${Math.round(lateMs)}ms late`);
        await this.applyBlock(block);
      }
      const observeUntil = origin + plan.timing.observeUntilMs;
      const remaining = observeUntil - this.now();
      if (remaining > 0) await this.sleep(remaining);
      return { status: 'COMPLETED', outcome: 'UNVERIFIED', night,
        plannedUntilMs: plan.timing.observeUntilMs, blockCount: blocks.length,
        deviceLocal: true };
    } finally {
      this.running = false;
      await this.releasePort();
    }
  }

  abort(reason) { return this.abortPort(reason); }
  releaseAll() { return this.releasePort(); }
}
