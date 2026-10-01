import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Coach, DuelTimer, playPress } from './coach.ts';
import { Audio } from './audio.ts';
import { UI } from './ui.ts';
import { bindInputs, keepAwake, goFullscreen, isFullscreen, buzz } from './input.ts';
import { drawTimeline, buildSummary, fmtTime } from './report.ts';
import { sweepPattern } from './lane.ts';
import * as Assets from './assets.ts';
import type { Step } from './curriculum.ts';
import { LESSONS, LESSON_FRAMES, MINUS7_CYCLE, byId, lessonSim, loadProgress, saveProgress, markPassed,
  recordCombo, unlockedIndex } from './curriculum.ts';
import { ArcadeLab } from './arcade-ui.ts';
import { REPOSITORY, factById, factText } from './route-facts.ts';
import { byId as element } from './dom.ts';

type Lesson = (typeof LESSONS)[number];
/** The calibration session: a mode with no lesson, so every lesson field is absent. */
interface Calibration {
  readonly name: string; readonly sim: {}; readonly coach: false;
  readonly id?: undefined; readonly title?: undefined; readonly drill?: undefined; readonly target?: undefined;
  readonly duelTarget?: undefined; readonly fullNight?: undefined;
}
type Settings = ReturnType<typeof loadSettings>;
/** One raw input, beside the coach's graded rows. */
interface TraceEvent { readonly t: number, readonly now: number, readonly kind: string, readonly act: string }

// The brief's "ON SCREEN" row: what a lesson's `controls` list looks like to
// the player, colour-coded the same way the rhythm lane codes those inputs.
const CONTROL_CHIPS: Readonly<Record<string, { readonly label: string, readonly kind: string }>> = {
  light:    { label: 'LIGHT',     kind: 'k-light' },
  camlight: { label: 'CAM LIGHT', kind: 'k-light' },
  mask:     { label: 'MASK',      kind: 'k-mask' },
  monitor:  { label: 'MONITOR',   kind: '' },
  cams:     { label: 'CAMS',      kind: 'k-cams' },
  wind:     { label: 'WIND',      kind: 'k-wind' },
  vents:    { label: 'VENTS',     kind: '' },
};
const ALL_CONTROLS = Object.keys(CONTROL_CHIPS);

// What this page's server can write. The trainer's dev server (serve.py) names
// its endpoints in a meta tag it adds to the pages it serves; GitHub Pages and
// any other static host serve the page as committed, with none, and there is
// nothing to post a trace or a layout to.
const DEV_SERVER = new Set((document.querySelector('meta[name="trainer-dev-server"]')
  ?.getAttribute('content') || '').split(/\s+/).filter(Boolean));

class App {
  declare audio: Audio;
  declare stage: HTMLElement;
  declare ui: UI;
  declare arcade: ArcadeLab;
  declare duel: DuelTimer;
  declare running: boolean;
  declare acc: number;
  declare last: number;
  declare settings: Settings;
  declare syncFullscreen: () => boolean;
  declare modeKey: string | null | undefined;
  declare mode: Lesson | Calibration;
  declare sim: Sim;
  declare coach: Coach | null;
  declare pendingLesson: string | null | undefined;
  declare duelWins: number;
  declare passed: boolean;
  declare traceEvents: TraceEvent[];
  declare tracePosted: boolean;
  declare startedAt: string;
  declare lastBoxTick: number;
  declare ambOn: boolean;
  declare wake: WakeLockSentinel | null | undefined;
  declare _rearm: number | undefined;
  declare _popped: Coach['last'];
  constructor() {
    this.audio = new Audio();
    this.stage = element('stage');
    this.ui = new UI(this.stage);
    this.arcade = new ArcadeLab(element('arcade'));
    this.duel = new DuelTimer();
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.settings = loadSettings();
    this.bindUI();
    this.bindFullscreen();
    bindInputs(this.stage, (a) => this.onPress(a), (a) => this.onRelease(a));
    this.flushTraces();
    requestAnimationFrame((t) => this.frame(t));
  }

  bindUI() {
    element('menu').addEventListener('click', async (e) => {
      // A click targets an element.
      const target = e.target as Element | null;
      const b = target?.closest<HTMLElement>('[data-mode]');
      if (b) { this.brief(b.dataset.mode); return; }
      const s = target?.closest<HTMLElement>('[data-ui]');
      if (!s) return;
      if (s.dataset.ui === 'settings') showPanel('settings');
      if (s.dataset.ui === 'about') showPanel('about');
      if (s.dataset.ui === 'arcade') { this.arcade.open(); showPanel('arcade'); }
    });
    document.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => showPanel('menu')));
    element('btn-quit').addEventListener('click', () => this.stop());
    element('btn-again').addEventListener('click', () => this.start(this.modeKey));
    element('btn-menu').addEventListener('click', () => { buildMenu(); showPanel('menu'); });
    element('btn-brief-go').addEventListener('click', () => this.start(this.pendingLesson));
    element('btn-brief-back').addEventListener('click', () => { buildMenu(); showPanel('menu'); });
    element('btn-next-lesson').addEventListener('click', (e) =>
      // The listener is on the button itself.
      this.brief((e.currentTarget as HTMLElement).dataset.next));
    element('btn-retry-lesson').addEventListener('click', () => this.start(this.modeKey));
    element('btn-passed-menu').addEventListener('click', () => { buildMenu(); showPanel('menu'); });
    element('btn-resetprogress').addEventListener('click', () => {
      saveProgress({}); buildMenu();
    });

    element('btn-calibrate').addEventListener('click', () => this.startCalibration());
    element('btn-resetmap').addEventListener('click', () => {
      this.ui.resetMap();
      note('Layout reset to the shipped defaults.');
    });
    element('btn-savemap').addEventListener('click', () => this.saveLayout());
    const snd = element<HTMLInputElement>('opt-sound');
    snd.checked = this.settings.sound;
    snd.addEventListener('change', () => { this.settings.sound = snd.checked; this.audio.enabled = snd.checked; saveSettings(this.settings); });
    const hp = element<HTMLInputElement>('opt-haptics');
    hp.checked = this.settings.haptics;
    hp.addEventListener('change', () => { this.settings.haptics = hp.checked; saveSettings(this.settings); if (hp.checked) buzz(20); });
    const mt = element<HTMLInputElement>('opt-metronome');
    mt.checked = this.settings.metronome;
    mt.addEventListener('change', () => { this.settings.metronome = mt.checked; saveSettings(this.settings); });
    const co = element<HTMLInputElement>('opt-coach');
    co.checked = this.settings.coach;
    co.addEventListener('change', () => { this.settings.coach = co.checked; saveSettings(this.settings); });

    element('row-savemap').hidden = !DEV_SERVER.has('save-layout');
    this.buildSoundSlots();
    element('btn-clear-sounds').addEventListener('click', async () => {
      await Assets.clearAll(); this.audio.samples = {}; this.buildSoundSlots();
    });
  }

  // Insist on full screen for the length of a run. Three ways in, because a
  // single request at start-up is the one thing that reliably does not work:
  // it is refused if the gesture has been spent, and the player can leave with
  // a swipe or the Escape key at any time afterwards.
  bindFullscreen() {
    const nag = element('btn-fs');
    // Calibration is exempt: it runs with `running` true but is a layout
    // session, and a viewport resize mid-drag would move the thing being
    // dragged. Control geometry is stored as a fraction of the stage, so it
    // does not care what size the viewport was when it was set.
    const sync = () => element('run')
      .classList.toggle('windowed', this.running && !this.ui.calibrating && !isFullscreen());
    this.syncFullscreen = sync;
    nag.addEventListener('click', () => { goFullscreen().then(sync); });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    // Every touch on the stage is a fresh user gesture, so a run that dropped
    // out of full screen climbs back in on the next input the player makes
    // anyway -- without costing them one.
    this.stage.addEventListener('pointerdown', () => {
      if (this.running && !this.ui.calibrating && !isFullscreen()) goFullscreen().then(sync);
    }, { capture: true, passive: true });
  }

  // Push the calibrated map back into the canonical core config as DEFAULT_MAP.
  // Only the dev server can do that; anywhere else we fall back to showing the
  // JSON so it can be copied across by hand.
  async saveLayout() {
    const ta = element<HTMLTextAreaElement>('map-json');
    try {
      const res = await fetch('/save-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map: this.ui.map, widgets: this.ui.widgets }),
      });
      // What serve.py's save-layout answers.
      const body: { error?: string, build?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      ta.hidden = true;
      note(`Saved to canonical core config. ${body.build || ''} Reload to run against the new default.`);
    } catch (e) {
      ta.hidden = false;
      ta.value = JSON.stringify({ map: this.ui.map, widgets: this.ui.widgets }, null, 2);
      ta.select?.();
      try { await navigator.clipboard.writeText(ta.value); } catch { /* clipboard may be blocked */ }
      note(`Could not reach the dev server (${(e as Error).message}). The layout JSON is below — copied to your clipboard if permitted.`);
    }
  }

  async buildSoundSlots() {
    const wrap = element('sound-slots');
    const have = await Assets.listSlots().catch((): Record<string, string | undefined> => ({}));
    wrap.innerHTML = Assets.SLOTS.map(s => `
      <label class="slot">
        <span class="slot-name">${s.label}</span>
        <span class="slot-why">${s.why}</span>
        <span class="slot-state">${have[s.id] ? `✓ ${have[s.id]}` : 'synthesised'}</span>
        <input type="file" accept="audio/*" data-slot="${s.id}">
      </label>`).join('');
    wrap.querySelectorAll<HTMLInputElement>('input[type=file]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const file = inp.files?.[0];
        if (!file) return;
        // Every input built above carries its slot.
        await Assets.putSlot(inp.dataset.slot as string, file);
        this.audio.unlock();
        await Assets.loadInto(this.audio);
        this.buildSoundSlots();
      });
    });
  }

  // Calibration runs in its own session with the simulation inert and game
  // input disabled, so dragging a control never doubles as pressing it.
  startCalibration() {
    this.modeKey = null;
    this.mode = { name: 'Calibrate', sim: {}, coach: false };
    this.sim = new Sim({
      bbEnabled: false, foxyEnabled: false, gfEnabled: false, boxEnabled: false,
      stalledEnabled: false, powerEnabled: false, lethal: false, record: false,
      durationFrames: LESSON_FRAMES,
    });
    this.coach = null;
    this.sim.monitor = 'up';
    this.sim.cam = this.sim.viewing = this.sim.lastViewed = C.BOX_CAM;
    this.sim.hasViewedCamera = true;
    this.ui.clearCoach();
    this.ui.setCoachVisible(false);
    this.ui.duelMode = false;
    this.ui.setControls(null);
    this.ui.showCues = false;
    this.ui.enableCalibration(true);
    this.running = true;
    this.acc = 0; this.last = performance.now();
    showPanel('run');
    this.syncFullscreen();
    note('');
  }

  // ------------------------------------------------------------- lessons
  brief(id: string | null | undefined) {
    const l = byId(id);
    if (!l) return;
    this.pendingLesson = id;
    const i = LESSONS.indexOf(l);
    element('brief-title').textContent = l.title;
    element('brief-step').textContent =
      `LESSON ${String(i + 1).padStart(2, '0')} / ${LESSONS.length}`;
    element('brief-goal').textContent = l.goal;
    element('brief-teach').textContent = l.teach;
    element('brief-when').textContent = l.when ? `WHEN — ${l.when}` : '';
    element('brief-status').innerHTML = (l.facts || []).map(factItem).join('');
    const need = l.fullNight ? 'clear the night'
      // The phaseB lesson names its duel target.
      : l.drill === 'phaseB' ? `beat ${(l.duelTarget as number) * 1000 | 0} ms on ${l.target} attacks`
      : `${l.target} clean passes in a row`;
    const tol = l.tol ? ` · graded ±${l.tol.tolGood * 1000 | 0} ms GOOD / ±${l.tol.tolOk * 1000 | 0} ms OK` : '';
    // The tolerance is a practice tolerance. For a lesson that can end the
    // night, say that the model's own per-step margin is not known for this
    // timing, rather than let the header read as a promise.
    const margins = l.script && l.sim.lethal !== false
      ? ' · how late each step can be before the night is lost: UNKNOWN, unmeasured for this timing' : '';
    element('brief-pass').textContent =
      `PASS — ${need}${tol} · never slowed down${margins}`;
    element('brief-controls').innerHTML =
      (l.controls || ALL_CONTROLS).map(c => {
        const d = CONTROL_CHIPS[c];
        return d ? `<span class="chip-ctrl ${d.kind}">${d.label}</span>` : '';
      }).join('');
    element('btn-brief-go').textContent = LESSONS.indexOf(l) === 0 ? 'Start' : 'Start lesson';
    const cv = element<HTMLCanvasElement>('brief-lane');
    // The lane sits in its own box on the brief panel.
    (cv.parentElement as HTMLElement).style.display = l.script ? '' : 'none';
    showPanel('brief');
    if (l.script) {
      sweepPattern(cv, l.script,
        () => this.pendingLesson === id && element('brief').classList.contains('shown'));
    }
  }

  // ------------------------------------------------------------------ run
  async start(key: string | null | undefined) {
    this.modeKey = key;
    const mode = byId(key);
    if (!mode) return;
    this.mode = mode;
    this.ui.enableCalibration(false);
    this.audio.unlock();
    this.audio.enabled = this.settings.sound;
    await Assets.loadInto(this.audio).catch(() => {});
    this.sim = lessonSim(mode);
    const coached = !!mode.script;
    this.coach = new Coach(this.sim, {
      enabled: coached,
      script: mode.script || undefined,
      tolGood: mode.tol?.tolGood,
      tolOk: mode.tol?.tolOk,
      onCycle: (ok, streak) => this.onCycle(ok, streak),
    });
    this.ui.clearCoach();
    this.ui.setCoachVisible(true);
    this.ui.duelMode = mode.drill === 'phaseB';
    this.ui.duel = this.duel;
    this.ui.setControls(mode.controls);
    this.ui.showCues = this.settings.coach;
    this.ui.setStreak('');
    this.duel.reset();
    this.duelWins = 0;
    this.passed = false;
    this.traceEvents = [];
    this.tracePosted = false;
    this.startedAt = new Date().toISOString();
    this.lastBoxTick = -1;
    this.ambOn = false;
    this.running = true;
    this.acc = 0; this.last = performance.now();
    showPanel('run');
    this.ui.runEntry();
    // Before the await: requestFullscreen only succeeds while the browser still
    // counts us as inside the Start tap's gesture, and awaiting spends it.
    goFullscreen().then(() => this.syncFullscreen());
    this.wake = await keepAwake();
    this.syncFullscreen();
  }

  onCycle(ok: boolean, streak: number) {
    // Only a lesson's coach calls this; calibration has none.
    const l = this.mode as Lesson;
    if (!l || l.fullNight || this.passed) return;
    this.ui.setStreak(`${streak} / ${l.target}`);
    if (ok) { this.audio.good(); this.ui.cleanPass(this.sim.t); this.buzz([10, 30, 14]); }
    else { this.audio.bad(); this.buzz(24); }
    if (streak >= l.target) this.pass(`${l.target} clean passes in a row.`);
  }

  pass(detail: string) {
    if (this.passed) return;
    this.passed = true;
    this.running = false;
    this.postTrace();
    this.syncFullscreen();
    this.wake?.release?.().catch(() => {});
    this.audio.ambience(false);
    this.audio.win();
    this.buzz([20, 60, 20, 60, 45]);
    // A pass ends a lesson; calibration never passes.
    const lesson = this.mode as Lesson;
    markPassed(lesson.id, this.coach?.bestCombo || 0);
    const i = LESSONS.indexOf(lesson);
    const nxt = LESSONS[i + 1];
    pendingUnlock = nxt?.id || null;
    buildMenu();
    element('passed-title').textContent = `${this.mode.title} — passed`;
    element('passed-body').textContent =
      `${detail}${nxt ? ` Next up: ${nxt.title} — ${nxt.goal}` : ' That is the whole ladder.'}`;
    const b = element('btn-next-lesson');
    b.style.display = nxt ? '' : 'none';
    b.dataset.next = nxt?.id || '';
    this.ui.win();
    showPanel('passed');
  }

  stop() {
    if (this.mode?.id && this.coach) recordCombo(this.mode.id, this.coach.bestCombo);
    this.running = false;
    this.postTrace();
    this.syncFullscreen();
    this.ui.enableCalibration(false);
    this.wake?.release?.().catch(() => {});
    this.audio.ambience(false);
    showPanel('menu');
  }

  onPress(act: string) {
    if (!this.running || !this.sim || this.ui.calibrating) return;
    this.logEvent('press', act);
    // Confirm the tap landed before anything else: on glass you cannot feel a
    // button, and a missed press you did not notice is the worst failure mode.
    this.feedbackFor(act);
    const beforeCombo = this.coach?.combo ?? 0;
    const beforeLast = this.coach?.last;
    // The duel reads the mask as it was before this press.
    if (this.mode.drill === 'phaseB') this.duelInput(act);
    playPress(this.sim, this.coach, act);
    // A new grade replaces the last one; there is none before the first.
    if (this.coach && this.coach.last && this.coach.last !== beforeLast) {
      const g = this.coach.last.grade;
      this.ui.grade(g);
      this.audio.judge(g);
      if (g !== 'good' && g !== 'ok') this.buzz(28);
      else if (this.coach.combo > beforeCombo && this.coach.combo % 10 === 0) {
        this.audio.milestone(this.coach.combo);
        this.ui.lane.milestone(this.sim.t);
        this.buzz([10, 40, 10]);
      }
    }
  }
  onRelease(act: string) {
    if (!this.running || !this.sim || this.ui.calibrating) return;
    this.logEvent('release', act);
    this.sim.release(act);
  }

  // The raw input stream, alongside the coach's graded rows: hold lengths and
  // inter-press spacing live here, and neither is recoverable from grades.
  logEvent(kind: string, act: string) {
    if (!this.coach?.enabled || !this.traceEvents) return;
    this.traceEvents.push({ t: this.sim.t, now: performance.now(), kind, act });
  }

  // One trace per coached run, sent when the run ends however it ends. The
  // bands a HumanActuator needs are measurements, so the trace carries its
  // conditions: speed and cue settings, the device, and whether an automated
  // browser drove the inputs -- a bot's perfectly timed presses must be
  // excludable from the human census (they post dry so test runs also never
  // land in captures/).
  postTrace() {
    if (!DEV_SERVER.has('save-trace')) return;
    if (this.tracePosted || !this.coach?.enabled || !this.coach.trace.length) return;
    this.tracePosted = true;
    const sim = this.sim, coach = this.coach;
    const env = { userAgent: navigator.userAgent, webdriver: !!navigator.webdriver,
                  touch: 'ontouchstart' in window, w: innerWidth, h: innerHeight };
    const body: Record<string, unknown> = {
      v: 1,
      lesson: this.modeKey,
      startedAt: this.startedAt,
      speed: this.settings.speed || 1,
      settings: { coach: this.settings.coach, metronome: this.settings.metronome,
                  sound: this.settings.sound, haptics: this.settings.haptics },
      tol: { good: coach.tolGood, ok: coach.tolOk },
      env,
      outcome: { reason: sim.death ? 'death' : sim.won ? 'won' : 'stopped',
                 survivedSec: sim.frame / C.FPS, detail: sim.death?.detail || null },
      steps: coach.trace,
      holds: coach.holds,
      events: this.traceEvents,
    };
    if (env.webdriver) body.dry = true;
    this.sendTrace(body).catch(() => this.queueTrace(body));
  }

  async sendTrace(body: object) {
    const res = await fetch('/save-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // A trace that fails to save must not vanish silently -- a practice session
  // believed collected and actually lost is the graded-nothing pipeline again.
  // Park it and retry on the next launch, when the dev server may be back.
  queueTrace(body: object) {
    try {
      const q = JSON.parse(localStorage.getItem('m7.pendingTraces') || '[]');
      q.push(body);
      localStorage.setItem('m7.pendingTraces', JSON.stringify(q.slice(-8)));
      console.warn('save-trace failed; trace queued for the next launch');
    } catch (e) {
      console.warn(`save-trace failed and the trace could not be queued: ${(e as Error).message}`);
    }
  }

  async flushTraces() {
    if (!DEV_SERVER.has('save-trace')) return;
    // What queueTrace parked on this device.
    let q: object[];
    try { q = JSON.parse(localStorage.getItem('m7.pendingTraces') || '[]'); } catch { return; }
    if (!q.length) return;
    const left: object[] = [];
    for (const body of q) {
      try { await this.sendTrace(body); } catch { left.push(body); }
    }
    try { localStorage.setItem('m7.pendingTraces', JSON.stringify(left)); } catch { /* full */ }
    if (left.length < q.length) console.log(`flushed ${q.length - left.length} queued trace(s)`);
  }

  feedbackFor(act: string) {
    if (act.startsWith('cam:')) this.audio.tap('cam', +act.slice(4));
    else this.audio.tap(act);
    this.buzz(8);
  }

  buzz(pattern: VibratePattern) { if (this.settings.haptics) buzz(pattern); }


  duelInput(act: string) {
    // The duel runs only in the phaseB lesson.
    const lesson = this.mode as Lesson;
    if (act === 'mask' && this.sim.maskOn) this.duel.begin(this.sim.t);
    else if (act === 'cam:10' || act === 'cam:4') {
      const before = this.duel.lastResult;
      this.duel.mark(this.sim.t, act);
      const r = this.duel.lastResult;
      if (r != null && r !== before) {
        const ok = r <= (lesson.duelTarget ?? 0.7);
        this.duelWins = ok ? this.duelWins + 1 : 0;
        this.ui.setStreak(`${this.duelWins} / ${lesson.target}  (${Math.round(r * 1000)}ms)`);
        if (ok) this.audio.good(); else { this.audio.bad(); buzz(18); }
        if (this.duelWins >= lesson.target) this.pass(`${lesson.target} attacks inside the window.`);
      }
    }
  }

  // Drill scaffolding: keeps the scenario re-arming so you can practise the
  // same 3 seconds over and over instead of waiting a whole night for it.
  drive() {
    const s = this.sim;
    if (this.mode.drill === 'phaseA') {
      // The measurable skill: were the cams DOWN when the 5s interval landed?
      // Reaching the vent opening is not a failure -- he gets there the moment
      // you raise the cams, by design. Phase A decides *when* he arrives.
      if (s.frame % C.MO_FRAMES === 0) {
        const up = s.monitor === 'up' || s.monitor === 'raising';
        if (up) {
          if (this.coach) { this.coach.cycleOk = false; this.coach.streak = 0; this.coach.combo = 0; }
          this.ui.setStreak(`0 / ${this.mode.target}`);
          this.ui.lane.pop('CAMS WERE UP', 'late', s.t);
          this.audio.bad(); this.buzz(30);
        } else {
          this.ui.lane.pop('SAFE', 'good', s.t);
        }
      }
      const vent = C.BB_STAGES - 1;                            // on CAM 05
      if (!s.bb.inOpening && s.bb.stage !== vent) s.bb.stage = vent;
      if (s.bb.inOpening) { s.bbLeave(); s.bb.stage = vent; }   // re-arm, no penalty
    }
    if (this.mode.drill === 'phaseB') {
      if (!s.bb.inOpening) {
        this._rearm = (this._rearm ?? 0) + 1;
        if (this._rearm > 90 && s.monitor === 'up') { s.bbEnterOpening(); this._rearm = 0; }
      } else this._rearm = 0;
    }
  }

  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    if (!this.running || !this.sim) { this.last = now; return; }
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt * (this.settings.speed || 1);
    const step = 1 / C.FPS;
    let guard = 0;
    while (this.acc >= step && guard++ < 8) {
      this.acc -= step;
      this.sim.tick();
      this.coach?.update();
      this.drive();
      this.drainEvents();
      const last = this.coach?.last;
      if (last && last !== this._popped) {
        this._popped = last;
        const txt = last.delta == null || last.grade === 'refused' ? last.grade.toUpperCase()
          : last.grade === 'good' ? 'PERFECT'
          : `${last.delta > 0 ? 'LATE ' : 'EARLY '}${Math.abs(Math.round(last.delta * 1000))}ms`;
        this.ui.lane.pop(txt, last.grade, this.sim.t);
      }
      // The 5-second pulse, always available to lock on to: a strong click on
      // the :X2/:X7 anchors and a quiet one on the 5s intervals between them.
      if (this.settings.metronome && this.sim.frame % C.FPS === 0) {
        const d = Math.floor(this.sim.t) % 10;
        if (d === 2 || d === 7) this.audio.anchorTick(true);
        else if (d === 0 || d === 5) this.audio.anchorTick(false);
      }
      if (!this.sim.alive || this.sim.won) { this.finish(); break; }
    }
    this.ui.render(this.sim, this.coach);
  }

  drainEvents() {
    const s = this.sim;
    for (const ev of s.events) {
      switch (ev.type) {
        case 'laugh': this.audio.laugh(); break;
        case 'vent-bang': this.audio.ventBang(ev.data?.leaving); this.buzz(ev.data?.leaving ? [14, 30, 14] : 30); break;
        case 'gf-appear': case 'gf-hall': this.audio.gfAppear(); break;
        case 'death': this.audio.death(); this.buzz([60, 40, 120]); this.ui.death(); break;
        case 'win': this.audio.win(); break;
        default: break;
      }
    }
    s.events.length = 0;
    // music box metronome tick, every half second while winding
    if (s.winding) {
      const half = Math.floor(s.frame / 30);
      if (half !== this.lastBoxTick) { this.lastBoxTick = half; this.audio.boxTick(); }
    }
    const amb = s.foxy.loc === 'hall';
    if (amb !== this.ambOn) { this.ambOn = amb; this.audio.ambience(amb); }
  }

  finish() {
    this.running = false;
    this.postTrace();
    this.syncFullscreen();
    this.wake?.release?.().catch(() => {});
    this.audio.ambience(false);
    if (this.sim.won && this.mode?.fullNight) { this.pass('Cleared 6 AM.'); return; }
    const sum = buildSummary(this.sim, this.coach);
    // Hold the final frame for a beat before the report covers it. The run is
    // already over -- `running` is false and frame() early-returns -- so this
    // costs no clock, and it is the cheapest diagnostic in the app.
    const hold = this.sim.death && !this.ui.reduce.matches ? 320 : 0;
    setTimeout(() => {
      showPanel('report');
      renderReport(sum, this.sim, this.duel, this.modeKey);
    }, hold);
  }
}

// ---------------------------------------------------------------- reporting
function renderReport(sum: ReturnType<typeof buildSummary>, sim: C.Sim, duel: DuelTimer, modeKey: string | null | undefined) {
  const head = element('rep-head');
  head.textContent = sum.won ? '6 AM — cleared' :
    sim.death ? `Died at ${fmtTime(sum.survived)}` : `Stopped at ${fmtTime(sum.survived)}`;
  head.className = sum.won ? 'win' : 'loss';
  element('rep-why').textContent = sim.death ? sim.death.detail : '';

  const stats: [string, string, string?][] = [];
  if (sum.coach) {
    stats.push(['Inputs on time', `${sum.coach.good}/${sum.coach.total}`]);
    stats.push(['Mean error', `${Math.round(sum.coach.meanAbs * 1000)}ms`]);
  }
  stats.push(['Light used', `${sum.lightUsedSec.toFixed(1)}s of 50s`]);
  stats.push(['Light rate', `${Math.round(sum.lightPerSec * 1000)}ms/s`, sum.lightBudgetOk ? 'good' : 'bad']);
  for (const g of sum.gaps) stats.push([`CAM ${String(g.cam).padStart(2, '0')} lapses`,
    `${g.gaps}${g.gaps ? ` (worst ${g.worstSec.toFixed(2)}s)` : ''}`, g.gaps ? 'bad' : 'good']);
  if (modeKey === 'phaseB' && duel.best) stats.push(['Best duel', `${Math.round(duel.best * 1000)}ms`]);
  element('rep-stats').innerHTML =
    stats.map(([k, v, cls], i) =>
      `<div style="--i:${i}"><b>${k}</b><span class="${cls || ''}">${v}</span></div>`).join('');

  const seen = new Set();
  element('rep-mistakes').innerHTML = sum.mistakes
    .filter(m => { const k = m.code + m.detail; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((m, i) => `<li style="--i:${i}"><code>${fmtTime(m.t)}</code> ${m.detail || m.code}</li>`)
    .join('') || '<li class="none">No flagged mistakes.</li>';

  requestAnimationFrame(() => drawTimeline(element<HTMLCanvasElement>('rep-canvas'), sim));
}

// A statement about a route, as a list item: its evidence label first, as text
// and not colour alone, then what it says, then the record that holds it.
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function factItem(id: string) {
  // Lessons and the page name only registered facts (route-facts.test.ts reads them all).
  const fact = factById(id) as NonNullable<ReturnType<typeof factById>>;
  // JSON.stringify quotes the address, so the bundle holds no quoted href
  // around a template, which build.py's leftover-reference scan would flag.
  const record = fact.record ? ` <a class="rec" href=${JSON.stringify(REPOSITORY + fact.record)} target="_blank"
    rel="noopener" aria-label="evidence record ${fact.record}">record</a>` : '';
  return `<li class="fact"><b class="label label-${fact.label.toLowerCase()}">${fact.label}</b> ` +
    `<span>${escapeHtml(factText(fact))}</span>${record}</li>`;
}
function renderFacts() {
  // The selector matched data-facts, so each list carries it.
  for (const list of document.querySelectorAll<HTMLElement>('[data-facts]'))
    list.innerHTML = (list.dataset.facts as string).split(' ').map(factItem).join('');
}

// The strategy board's pass, drawn from the cycle the lessons teach so the two
// cannot disagree (until 2026-09-30 the board was typed out by hand).
const PASS_KIND: Readonly<Record<string, string>> = { monitor: '', mask: 'k-mask', light: 'k-light', camflash: 'k-cam', cam: 'k-wind', wind: 'k-hold' };
function passWhat(st: Step) {
  const cam = String(st.cam).padStart(2, '0');
  switch (st.action) {
    case 'monitor': return `CAMS ${st.want === 'down' ? '▼' : '▲'}`;
    case 'mask': return `MASK ${st.want === 'on' ? '▲' : '▼'}`;
    case 'light': return 'FLASH HALL';
    case 'camflash': return `CAM ${cam} + LIGHT`;
    case 'cam': return `CAM ${cam}`;
    default: return 'HOLD WIND';
  }
}
function renderPassBoard() {
  const wind = MINUS7_CYCLE[MINUS7_CYCLE.length - 1];
  element('pass-title').textContent =
    `THE PASS — TEN INPUTS IN ${wind.at.toFixed(1)} S, THEN WIND`;
  element('pass-steps').innerHTML = MINUS7_CYCLE.map((st, i) =>
    `<div class="pass-step ${PASS_KIND[st.action]}"><span class="at">+${st.at.toFixed(2)}${
      st.hold ? ` &rarr; +${(st.at + st.hold).toFixed(1)}` : ''}</span><span class="what">${i + 1} &middot; ${
      passWhat(st)}</span></div>`).join('');
}

// ------------------------------------------------------------------- shell
function showPanel(id: string) {
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('shown', p.id === id);
  document.body.classList.toggle('in-run', id === 'run');
}

function note(msg: string) {
  const el = document.getElementById('savemap-note');
  if (el) el.textContent = msg;
}

function loadSettings() {
  let s = { sound: true, coach: true, speed: 1, haptics: true, metronome: true };
  try { Object.assign(s, JSON.parse(localStorage.getItem('m7.settings') || '{}')); } catch { /* defaults */ }
  return s;
}
function saveSettings(s: Settings) { try { localStorage.setItem('m7.settings', JSON.stringify(s)); } catch { /* ignore */ } }

// Set by pass() so the lesson it opened can announce itself exactly once, the
// next time the ladder is drawn.
let pendingUnlock: string | null = null;

function buildMenu() {
  const prog = loadProgress();
  const open = unlockedIndex(prog);
  const cleared = LESSONS.filter(l => prog[l.id]?.passed).length;
  const justUnlocked = pendingUnlock; pendingUnlock = null;
  element('mode-pips').innerHTML = LESSONS
    .map((l, i) => `<i class="${prog[l.id]?.passed ? 'done' : i === open ? 'next' : ''}"></i>`).join('');
  element('mode-cleared').textContent = `${cleared} / ${LESSONS.length} CLEARED`;
  element('mode-list').innerHTML = LESSONS.map((l, i) => {
    const done = !!prog[l.id]?.passed;
    const next = i === open && !done;
    const state = done ? 'done' : next ? 'next' : i < open ? 'done' : 'later';
    const best = prog[l.id]?.best;
    return `<button class="mode ${state}" data-mode="${l.id}" style="--i:${i}"${
      l.id === justUnlocked ? ' data-unlock' : ''}>
      <span class="mode-n">${done ? '✓' : i + 1}</span>
      <b>${l.title}</b>${next ? '<span class="mode-best">▶ GO</span>'
        : best ? `<span class="mode-best">✓ ${best}×</span>` : ''}
      <span class="mode-goal">${l.goal}</span>
    </button>`;
  }).join('');
}

buildMenu();
renderFacts();
renderPassBoard();
window.app = new App();
showPanel('menu');
