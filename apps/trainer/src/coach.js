import * as C from '@sixam/source/fnaf2';

// Watches the routine rather than the game: which input was due, when it
// actually landed, and by how much it was off.
export class Coach {
  constructor(sim, opts = {}) {
    this.sim = sim;
    this.script = opts.script || C.CYCLE_SCRIPT;
    this.enabled = opts.enabled !== false;
    this.anchorDigits = opts.anchorDigits || [2, 7];
    this.tolGood = opts.tolGood ?? C.TOL_GOOD;
    this.tolOk = opts.tolOk ?? C.TOL_OK;
    this.cycleStart = null;
    this.idx = 0;
    this.results = [];       // {stepId, delta, grade, t} — rolling, for the UI
    // The full run, uncapped: `results` is trimmed to 400 for the lane, which
    // silently drops the early cycles of a long run — exactly the rows a
    // lateness census needs. Rows carry the cycle index so per-step lateness
    // can be correlated within a pass (plans/04: human slack clusters).
    this.trace = [];         // {cycle, stepId, action, at, delta, grade, t}
    this.holds = [];         // {cycle, stepId, heldSec, targetSec}
    this.pendingFlash = null; // camflash step awaiting its light tap
    this.suspended = false;   // BB attacks run off-script
    this.onCycle = opts.onCycle || null;
    this.cycleOk = true;      // did every step of the current pass land?
    this.windFrames = 0;      // frames actually spent winding this pass
    this.combo = 0;           // consecutive inputs that landed in tolerance
    this.bestCombo = 0;
    this.streak = 0;          // consecutive clean passes
    this.bestStreak = 0;
    this.cycles = 0;
  }

  get expected() { return this.cycleStart == null ? null : this.script[this.idx]; }
  get expectedAt() { const e = this.expected; return e ? this.cycleStart + e.at : null; }

  // Next whole second, strictly after `t`, whose digit is an anchor digit.
  // Must be strictly after: returning a time already past makes a short script
  // wrap every frame instead of once per cycle.
  nextAnchor(t) {
    const from = Math.floor(t) + 1;
    for (let k = 0; k < 12; k++) {
      const cand = from + k;
      if (this.anchorDigits.includes(cand % 10)) return cand;
    }
    return from;
  }

  start(t) { this.cycleStart = this.nextAnchor(t); this.idx = 0; }

  // The tolerance for one step, as separate early/late magnitudes. A step that
  // carries a measured window is graded against that; anything else falls back
  // to the lesson's own symmetric pair.
  tolFor(step) { return C.stepTol(step, this.tolGood, this.tolOk); }

  grade(step, delta) {
    const t = this.tolFor(step);
    const a = Math.abs(delta);
    const good = delta > 0 ? t.goodLate : t.goodEarly;
    const ok = delta > 0 ? t.okLate : t.okEarly;
    return a <= good ? 'good' : a <= ok ? 'ok' : 'late';
  }

  // The wind step is graded on how long the box was actually being wound, not
  // on the press: a tap would otherwise score full marks while the box drains.
  get windStep() { return this.script.find(st => st.hold); }

  // called every frame
  update() {
    if (!this.enabled || this.suspended) return null;
    if (this.sim.isWinding) this.windFrames++;
    const t = this.sim.t;
    if (this.cycleStart == null) { this.start(t); return null; }
    // a camflash needs its light within 0.4s of the cam tap
    if (this.pendingFlash && t - this.pendingFlash.t > 0.4) {
      const p = this.pendingFlash; this.pendingFlash = null;
      this.push(p.step, null, 'no-flash');
      this.advance(t);
    }
    const e = this.expected;
    if (!e) { this.completeCycle(); this.cycleStart = this.nextAnchor(t + 0.2); this.idx = 0; return null; }
    if (t > this.cycleStart + e.at + 1.0) { this.push(e, null, 'missed'); this.advance(t); }
    return null;
  }

  advance(t) {
    this.idx++;
    if (this.idx >= this.script.length) {
      this.completeCycle();
      this.cycleStart = this.nextAnchor(t + 0.2);
      this.idx = 0;
    }
  }

  push(step, delta, grade) {
    this.trace.push({ cycle: this.cycles, stepId: step.id, action: step.action,
                      at: step.at, delta, grade, t: this.sim.t });
    this.results.push({ stepId: step.id, label: step.label, delta, grade, t: this.sim.t });
    if (this.results.length > 400) this.results.shift();
    this.last = this.results[this.results.length - 1];
    // 'good' and 'ok' both count: a lesson should not demand frame perfection.
    if (grade !== 'good' && grade !== 'ok') { this.cycleOk = false; this.combo = 0; }
    else { this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); }
  }

  // The next few inputs, for the rhythm lane. Anchors are 5s apart, so future
  // cycles are just this one shifted.
  upcoming(horizon = 3) {
    if (this.cycleStart == null || !this.script?.length) return [];
    const t = this.sim.t, out = [];
    for (let c = 0; c < 3; c++) {
      const base = this.cycleStart + c * 5;
      for (let i = 0; i < this.script.length; i++) {
        if (c === 0 && i < this.idx) continue;
        const due = base + this.script[i].at;
        if (due < t - 0.35 || due > t + horizon) continue;
        out.push({ step: this.script[i], due, done: false });
      }
    }
    return out;
  }

  // Called when the script wraps: one complete pass of the routine.
  completeCycle() {
    const w = this.windStep;
    if (w) {
      const held = this.windFrames / C.FPS;
      this.lastHeld = held;
      this.holds.push({ cycle: this.cycles, stepId: w.id, heldSec: held, targetSec: w.hold });
      // 80% of the window is enough: you have to let go to drop the cams.
      if (held < w.hold * 0.8) {
        this.push(w, null, held < w.hold * 0.35 ? 'no-wind' : 'wind-short');
      }
    }
    this.windFrames = 0;
    this.cycles++;
    if (this.cycleOk) { this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); }
    else this.streak = 0;
    const ok = this.cycleOk;
    this.cycleOk = true;
    this.onCycle?.(ok, this.streak);
  }

  // Which on-screen control the player should be reaching for right now.
  get lightSel() {
    return this.sim.camsUp ? '[data-widget="camlight"]' : '[data-widget="light"]';
  }

  get cue() {
    if (this.suspended || this.cycleStart == null) return null;
    if (this.pendingFlash) return { sel: this.lightSel, label: 'Flash' };
    const e = this.expected;
    if (!e) return null;
    switch (e.action) {
      case 'monitor': return { sel: '[data-act="monitor"]', label: e.label };
      case 'mask': return { sel: '[data-act="mask"]', label: e.label };
      case 'light': return { sel: this.lightSel, label: e.label };
      case 'wind': return { sel: '[data-act="wind"]', label: e.label };
      case 'cam':
      case 'camflash': return { sel: `.camb[data-cam="${e.cam}"]`, label: e.label };
      default: return null;
    }
  }

  // called on every player input, before the sim consumes it
  onInput(act) {
    if (!this.enabled || this.suspended || this.cycleStart == null) return;
    const t = this.sim.t;
    // resolve a pending camera flash
    if (this.pendingFlash && act === 'light') {
      const p = this.pendingFlash; this.pendingFlash = null;
      this.push(p.step, p.delta, this.grade(p.step, p.delta));
      this.advance(this.sim.t);
      return;
    }
    const e = this.expected;
    if (!e) return;
    const due = this.cycleStart + e.at;
    const delta = t - due;
    const matches = this.matches(e, act);
    if (!matches) {
      // an early input for the *next* step is a miss on this one
      const n = this.script[this.idx + 1];
      if (n && this.matches(n, act)) { this.push(e, null, 'skipped'); this.advance(t); this.onInput(act); }
      return;
    }
    // Hold position on a camflash until its light tap lands, so the grade is
    // attributed to this cycle rather than the next one.
    if (e.action === 'camflash') { this.pendingFlash = { step: e, t, delta }; return; }
    this.push(e, delta, this.grade(e, delta));
    this.advance(t);
  }

  matches(step, act) {
    switch (step.action) {
      case 'monitor': return act === 'monitor';
      case 'mask':    return act === 'mask';
      case 'light':   return act === 'light';
      case 'wind':    return act === 'wind';
      case 'cam':     return act === `cam:${step.cam}`;
      case 'camflash': return act === `cam:${step.cam}`;
      default: return false;
    }
  }

  get summary() {
    const scored = this.results.filter(r => r.delta != null);
    const n = scored.length || 1;
    const good = this.results.filter(r => r.grade === 'good').length;
    const bad = this.results.filter(r => r.grade === 'missed' || r.grade === 'late' ||
                                          r.grade === 'skipped' || r.grade === 'no-flash').length;
    const mean = scored.reduce((a, r) => a + Math.abs(r.delta), 0) / n;
    return { total: this.results.length, good, bad, meanAbs: mean, accuracy: good / (this.results.length || 1) };
  }
}

// The Phase B duel: measures un-mask -> CAM 10 -> CAM 04 as one motion.
export class DuelTimer {
  constructor() { this.reset(); this.best = +localStorage.getItem('m7.bestDuel') || null; }
  reset() { this.startT = null; this.marks = []; this.lastResult = null; }
  begin(t) { this.startT = t; this.marks = []; }
  mark(t, what) {
    if (this.startT == null) return;
    this.marks.push({ t: t - this.startT, what });
    if (what === 'cam:4') {
      this.lastResult = t - this.startT;
      if (this.best == null || this.lastResult < this.best) {
        this.best = this.lastResult;
        localStorage.setItem('m7.bestDuel', String(this.best));
      }
      this.startT = null;
    }
  }
}
