import * as C from '@sixam/source/fnaf2';
import { fmtTime } from './report.js';
import { Lane } from './lane.js';

const pad2 = (n) => String(n).padStart(2, '0');

const GRADE_FX = {
  good: '#57DC6E', ok: '#FFB020', late: '#FF5449',
  missed: '#FF5449', skipped: '#FF5449', 'no-flash': '#FF5449', refused: '#FF5449',
};

export class UI {
  constructor(root) {
    this.root = root;
    const saved = loadLayout();
    this.map = saved.map;
    this.widgets = saved.widgets;
    this.calibrating = false;
    this.duelMode = false;
    this.duel = null;
    this.showCues = false;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.build();
  }

  build() {
    this.root.innerHTML = `
      <div id="hud">
        <div class="hud-timer"><span id="t-main">0:00</span><span id="t-dec">.0</span></div>
        <div class="hud-block">
          <div class="hud-label">STUN</div>
          <div class="stuns">
            ${C.TARGET_CAMS.map(c => `
              <div class="stun" data-cam="${c}">
                <span class="stun-name">${pad2(c)}</span>
                <div class="stun-track"><i></i></div>
              </div>`).join('')}
          </div>
        </div>
        <div class="hud-block">
          <div class="hud-label">BOX</div>
          <div class="meter box"><i id="box-fill"></i></div>
        </div>
        <div class="hud-block">
          <div class="hud-label">LIGHT <span id="budget"></span></div>
          <div class="bars" id="bars">${'<i></i>'.repeat(4)}</div>
        </div>
        <div class="hud-block hud-threats">
          <div class="threat" id="th-foxy"><b>FOXY</b><span></span></div>
          <div class="threat" id="th-bb"><b>BB</b><span></span></div>
          <div class="threat" id="th-gf"><b>GF</b><span></span></div>
        </div>
      </div>

      <canvas id="lane"></canvas>
      <div id="coach">
        <div id="coach-next">—</div>
        <div id="coach-bar"><i></i></div>
        <div id="coach-fb"></div>
        <div id="coach-streak"></div>
      </div>

      <div id="office" class="view">
        <div class="hallway"><div class="hall-glow" id="hall-glow"></div><div class="hall-who" id="hall-who"></div></div>
        <div class="desk"></div>
        <div class="mask-overlay" id="mask-ov"></div>
        <div class="blackout" id="blackout-ov"></div>
      </div>

      <div id="monitor" class="view">
        <div class="feed">
          <div class="feed-title"><span id="feed-cam">CAM 11</span><em id="feed-name">Prize Corner</em>
            <i class="feed-rec">REC</i></div>
          <div class="feed-body" id="feed-body"></div>
          <div class="feed-stun" id="feed-stun"></div>
          <button class="wind" data-act="wind" data-mode="hold" data-widget="wind" id="windbtn">WIND</button>
        </div>
        <div class="mapwrap"><div class="map" id="map"></div></div>
      </div>

      <button class="btn light" data-act="light" data-mode="hold" data-widget="light"><span>LIGHT</span></button>
      <button class="btn light camlight" data-act="light" data-mode="hold" data-widget="camlight"><span>CAM LIGHT</span></button>
      <button class="btn tab mask" data-act="mask" data-mode="tap" data-widget="mask"><span>▲</span><em>MASK</em></button>
      <button class="btn tab mon" data-act="monitor" data-mode="tap" data-widget="monitor"><span id="mon-arrow">▲</span><em>MONITOR</em></button>
      <button class="vent" data-act="ventL" data-mode="hold" data-widget="ventL"><span>L</span></button>
      <button class="vent" data-act="ventR" data-mode="hold" data-widget="ventR"><span>R</span></button>

      <div id="fx" aria-hidden="true"><i class="fx-vignette"></i><i class="fx-wipe"></i><i class="fx-scan"></i></div>
    `;
    this.el = {
      tMain: this.root.querySelector('#t-main'),
      tDec: this.root.querySelector('#t-dec'),
      boxFill: this.root.querySelector('#box-fill'),
      bars: [...this.root.querySelectorAll('#bars i')],
      budget: this.root.querySelector('#budget'),
      stuns: C.TARGET_CAMS.map(c => this.root.querySelector(`.stun[data-cam="${c}"] .stun-track i`)),
      stunRows: C.TARGET_CAMS.map(c => this.root.querySelector(`.stun[data-cam="${c}"]`)),
      foxy: this.root.querySelector('#th-foxy span'),
      bb: this.root.querySelector('#th-bb span'),
      gf: this.root.querySelector('#th-gf span'),
      office: this.root.querySelector('#office'),
      monitor: this.root.querySelector('#monitor'),
      hallGlow: this.root.querySelector('#hall-glow'),
      hallWho: this.root.querySelector('#hall-who'),
      maskOv: this.root.querySelector('#mask-ov'),
      blackoutOv: this.root.querySelector('#blackout-ov'),
      feedCam: this.root.querySelector('#feed-cam'),
      feedName: this.root.querySelector('#feed-name'),
      feedBody: this.root.querySelector('#feed-body'),
      feedStun: this.root.querySelector('#feed-stun'),
      wind: this.root.querySelector('#windbtn'),
      map: this.root.querySelector('#map'),
      coachNext: this.root.querySelector('#coach-next'),
      coachFb: this.root.querySelector('#coach-fb'),
      coachStreak: this.root.querySelector('#coach-streak'),
      coachBar: this.root.querySelector('#coach-bar'),
      coachBarFill: this.root.querySelector('#coach-bar i'),
      lane: this.root.querySelector('#lane'),
      monArrow: this.root.querySelector('#mon-arrow'),
      fx: {
        vignette: this.root.querySelector('.fx-vignette'),
        wipe: this.root.querySelector('.fx-wipe'),
        scan: this.root.querySelector('.fx-scan'),
      },
      timer: this.root.querySelector('.hud-timer'),
    };
    this.lane = new Lane(this.el.lane);
    this.buildMap();
    this.applyWidgets();
    this.bindCalibration();
  }

  // Position every touch control from the calibrated geometry.
  applyWidgets() {
    for (const el of this.root.querySelectorAll('[data-widget]')) {
      const w = this.widgets[el.dataset.widget];
      if (!w) {
        // Silently skipping leaves the control stacked at 0,0 with no clue why.
        console.error(`[layout] no geometry for widget "${el.dataset.widget}" — check DEFAULT_WIDGETS`);
        el.classList.add('unpositioned');
        continue;
      }
      el.classList.remove('unpositioned');
      el.style.left = `${w.x * 100}%`; el.style.top = `${w.y * 100}%`;
      el.style.width = `${w.w * 100}%`; el.style.height = `${w.h * 100}%`;
    }
  }

  buildMap() {
    const m = this.el.map;
    m.innerHTML = '';
    for (const [id, r] of Object.entries(this.map)) {
      const b = document.createElement('button');
      b.className = 'camb';
      b.dataset.act = `cam:${id}`;
      b.dataset.mode = 'tap';
      b.dataset.cam = id;
      if (C.TARGET_CAMS.includes(+id)) b.classList.add('is-target');
      if (+id === C.BOX_CAM) b.classList.add('is-box');
      b.style.left = `${r.x * 100}%`; b.style.top = `${r.y * 100}%`;
      b.style.width = `${r.w * 100}%`; b.style.height = `${r.h * 100}%`;
      b.innerHTML = `<b>${pad2(id)}</b><em>${C.CAMS[id].name}</em>`;
      m.appendChild(b);
    }
  }

  // CSS aspect-ratio loses to the height cap inside a flex row, so size the map
  // explicitly: the traced coordinates only hold their shape at 268:199.
  fitMap() {
    const wrap = this.el.map.parentElement;
    const cs = getComputedStyle(wrap);
    const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const w = Math.min(availW, availH * C.MAP_AR);
    this.el.map.style.width = `${w}px`;
    this.el.map.style.height = `${w / C.MAP_AR}px`;
  }

  render(sim, coach) {
    // Phase B runs without a script; its lane shows the stun deadline instead.
    if (this.duelMode) this.lane.drawDuel(sim, this.duel);
    if (this._mapW !== this.el.map.parentElement.clientWidth ||
        this._mapH !== this.el.map.parentElement.clientHeight) {
      this._mapW = this.el.map.parentElement.clientWidth;
      this._mapH = this.el.map.parentElement.clientHeight;
      this.fitMap();
    }
    const t = sim.t;
    const secs = Math.floor(t);
    this.el.tMain.textContent = `${Math.floor(secs / 60)}:${pad2(secs % 60)}`;
    this.el.tDec.textContent = `.${Math.floor((t % 1) * 10)}`;
    const digit = secs % 10;
    this.el.timer.classList.toggle('is-anchor', digit === 2 || digit === 7);
    this.el.timer.classList.toggle('is-interval', digit === 0 || digit === 5);

    // stun bars
    for (let k = 0; k < 3; k++) {
      const camId = C.TARGET_CAMS[k];
      let best = 0;
      for (const u of sim.units) if (!u.done && u.path[u.idx] === camId) best = Math.max(best, u.stunUntil - sim.frame);
      const occupied = sim.units.some(u => !u.done && u.path[u.idx] === camId);
      const v = Math.max(0, best) / C.STUN_FRAMES;
      this.el.stuns[k].style.width = `${v * 100}%`;
      this.el.stunRows[k].classList.toggle('is-empty', occupied && best <= 0);
      this.el.stunRows[k].classList.toggle('is-low', best > 0 && best < 90);
      this.el.stunRows[k].classList.toggle('is-vacant', !occupied);
    }

    this.el.boxFill.style.width = `${sim.box * 100}%`;
    this.el.boxFill.parentElement.classList.toggle('is-low', sim.box < 0.28);
    const bars = sim.bars;
    this.el.bars.forEach((b, i) => b.classList.toggle('on', i < bars));
    this.el.bars.forEach(b => b.classList.toggle('blink', sim.power <= C.POWER_BLINK));
    const used = C.POWER_FRAMES - sim.power;
    const perSec = sim.frame ? (used / sim.frame) : 0;
    this.el.budget.textContent = `${Math.round(perSec * 1000)}ms/s`;
    this.el.budget.className = perSec > C.POWER_FRAMES / C.NIGHT_FRAMES ? 'over' : '';

    this.el.foxy.textContent = sim.foxy.loc === 'hall' ? `HALL D=${sim.foxy.D}` : 'AWAY';
    this.el.foxy.parentElement.className = `threat ${sim.foxy.gotYou ? 'crit' : sim.foxy.loc === 'hall' && sim.foxy.D >= 3 ? 'warn' : ''}`;
    this.el.bb.textContent = sim.bb.inside ? 'IN OFFICE'
      : sim.bb.inOpening ? 'IN VENT' : `${sim.bb.stage}/${C.BB_STAGES}`;
    this.el.bb.parentElement.className = `threat ${sim.bb.inside || sim.bb.inOpening ? 'crit'
      : sim.bb.stage >= C.BB_STAGES - 1 ? 'warn' : ''}`;
    this.el.gf.textContent = sim.gf.present ? 'OFFICE' : sim.gf.inHall ? 'HALL' : '—';
    this.el.gf.parentElement.className = `threat ${sim.gf.present || sim.gf.inHall ? 'crit' : ''}`;

    // A masked player has no other move: hide every control but MASK while it
    // is on (or going on), so the trainer never invites an input the game
    // discards. See docs/android/ANDROID-SOURCE-STATUS.md, "the mask kills every office
    // light".
    if (sim.maskOn !== this.lastMaskOn) {
      this.lastMaskOn = sim.maskOn;
      this.root.classList.toggle('masked', !!sim.maskOn);
    }

    // views
    const up = sim.monitor === 'up' || sim.monitor === 'raising';
    if (up !== this.lastCamsUp) {
      this.applyLightVisibility(up);
      // The MONITOR tab is the same button either way, so its arrow has to say
      // which way it will move the cams -- up when they are down, down when up.
      this.el.monArrow.textContent = up ? '▼' : '▲';
      // A CRT wipe in the direction the view is moving, on #fx. Cross-fading
      // the two views instead would double full-screen paint and, for 250 ms,
      // make "which view am I in" ambiguous -- the one question the whole
      // routine is built on.
      this.fx(this.el.fx.wipe, [
        { opacity: 0, transform: `translateY(${up ? '110%' : '-110%'})` },
        { opacity: 1, offset: 0.35 },
        { opacity: 0, transform: `translateY(${up ? '-110%' : '110%'})` },
      ], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    this.el.monitor.classList.toggle('shown', up);
    this.el.monitor.classList.toggle('arming', sim.monitor === 'raising');
    this.el.office.classList.toggle('dimmed', up);
    this.el.maskOv.classList.toggle('shown', sim.maskOn);
    this.el.blackoutOv.classList.toggle('shown', sim.blackout.active);
    this.el.hallGlow.classList.toggle('on', sim.hallLightOn);
    if (sim.maskOn !== this._maskWas) {
      this._maskWas = sim.maskOn;
      if (sim.maskOn) {
        this.el.fx.vignette.style.setProperty('--fxc', '#FF5449');
        this.fx(this.el.fx.vignette, [{ opacity: .5 }, { opacity: 0 }], { duration: 130 });
      }
    }
    const hallOccupant = sim.foxy.loc === 'hall' ? 'FOXY' : sim.gf.inHall ? '???' : '';
    const who = sim.hallLightOn ? hallOccupant : '';
    // The difference between an empty hall and FOXY is a life, and it used to
    // be a text node quietly appearing for as long as a tap lasts.
    if (who && who !== this._whoWas) {
      this.fx(this.el.hallWho,
        [{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 140 });
    }
    this._whoWas = who;
    this.el.hallWho.textContent = who;
    this.el.office.classList.toggle('ambience', sim.foxy.loc === 'hall');

    // monitor contents
    if (up) {
      // During the raise animation g2 has not restored `viewing` yet; keep a
      // valid feed shell underneath the animation using the sampled/parked cam.
      const viewing = sim.viewing || sim.lastViewed || sim.cam;
      this.el.feedCam.textContent = `CAM ${pad2(viewing)}`;
      this.el.feedName.textContent = C.CAMS[viewing].name;
      const here = sim.units.filter(u => !u.done && u.path[u.idx] === viewing);
      const extra = [];
      if (viewing === 10 && sim.bb.stage === 0) extra.push('BB');
      if (viewing === 5 && sim.bb.stage === C.BB_STAGES - 1) extra.push('BB');
      if (viewing === 11) extra.push(`PUPPET ${sim.puppet.stage}/${C.PUPPET_ESCAPE_STAGES}`);
      this.el.feedBody.innerHTML = here.map(u => {
        const st = Math.max(0, u.stunUntil - sim.frame) / C.STUN_FRAMES;
        return `<span class="chip ${st > 0 ? 'stunned' : 'free'}">${u.short}</span>`;
      }).join('') + extra.map(e => `<span class="chip immune">${e}</span>`).join('');
      const maxStun = Math.max(0, ...here.map(u => u.stunUntil - sim.frame));
      this.el.feedStun.style.width = `${(maxStun / C.STUN_FRAMES) * 100}%`;
      this.el.wind.classList.toggle('shown', viewing === C.BOX_CAM);
      for (const b of this.el.map.children) {
        const id = +b.dataset.cam;
        // The stale marker tile remains lit when a raise restores a different
        // `viewing` camera; two active buttons are the glitch's visible tell.
        b.classList.toggle('active', id === viewing || id === sim.cam);
        let best = -1;
        for (const u of sim.units) if (!u.done && u.path[u.idx] === id) best = Math.max(best, u.stunUntil - sim.frame);
        b.classList.toggle('has', best > -1);
        b.classList.toggle('loose', best === 0);
      }
    }

    // coach
    if (coach && coach.enabled) {
      const e = coach.expected;
      if (e && coach.cycleStart != null) {
        const due = coach.cycleStart + e.at;
        const dt = due - t;
        this.el.coachNext.textContent = `${e.label}`;
        this.el.coachNext.className = dt < -0.35 ? 'late' : dt < 0.15 ? 'now' : '';
      }
      const cue = coach.cue;
      const e0 = coach.expected;
      if (cue && coach.cycleStart != null) {
        const due = e0 ? coach.cycleStart + e0.at : t;
        cue.now = (due - t) <= 0.18;
      }
      // Countdown to the moment the next input is due, so "when" is visible
      // rather than something you are expected to already feel.
      if (e0 && coach.cycleStart != null) {
        const dt = (coach.cycleStart + e0.at) - t;
        const LEAD = 2;
        const frac = Math.max(0, Math.min(1, 1 - dt / LEAD));
        this.el.coachBarFill.style.width = `${frac * 100}%`;
        this.el.coachBar.classList.toggle('now', dt <= 0.12 && dt > -0.5);
        this.el.coachBar.classList.toggle('over', dt < -0.5);
      }
      this.setCue(this.showCues ? cue : null);
      this.lane.draw(coach, sim);
      const last = coach.last;
      if (last && last !== this._lastShown) {
        this._lastShown = last;
        const txt = last.delta == null || last.grade === 'refused' ? last.grade.toUpperCase()
          : `${last.delta > 0 ? '+' : ''}${Math.round(last.delta * 1000)}ms`;
        this.el.coachFb.textContent = `${last.label} ${txt}`;
        this.el.coachFb.className = last.grade;
        // The number swapped silently before, so two consecutive lates looked
        // exactly like one stale one. Restriking makes each judgement countable.
        const bad = !(last.grade === 'good' || last.grade === 'ok');
        this.fx(this.el.coachFb, bad
          ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)', offset: .25 },
             { transform: 'translateX(3px)', offset: .6 }, { transform: 'translateX(0)' }]
          : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
          { duration: bad ? 200 : 180 });
      }
    }
  }

  setCoachVisible(v) {
    this.root.querySelector('#coach').style.display = v ? '' : 'none';
    this.el.lane.style.display = v ? '' : 'none';
  }

  // Show only the controls a lesson actually uses. Fewer things on screen is
  // the main lever for making an early lesson learnable.
  setControls(list) {
    const on = new Set(list || ['light', 'mask', 'monitor', 'cams', 'wind', 'vents']);
    const vis = (sel, show) => this.root.querySelectorAll(sel)
      .forEach(e => e.classList.toggle('hidden-ctrl', !show));
    this.useLight = on.has('light');
    this.useCamLight = on.has('camlight');
    vis('[data-widget="mask"]', on.has('mask'));
    vis('[data-widget="monitor"]', on.has('monitor'));
    vis('[data-widget="ventL"],[data-widget="ventR"]', on.has('vents'));
    vis('[data-widget="wind"]', on.has('wind'));
    this.el.map.classList.toggle('dim-cams', !on.has('cams'));
    this.lockMonitor = !on.has('monitor');
    this.applyLightVisibility();
  }

  // Only the light that belongs to the current view is on screen -- unless we
  // are calibrating, where both need to be reachable.
  applyLightVisibility(camsUp = this.lastCamsUp) {
    this.lastCamsUp = camsUp;
    const office = this.root.querySelector('[data-widget="light"]');
    const cam = this.root.querySelector('[data-widget="camlight"]');
    if (this.calibrating) {
      office.classList.toggle('hidden-ctrl', false);
      cam.classList.toggle('hidden-ctrl', false);
      return;
    }
    office.classList.toggle('hidden-ctrl', !(this.useLight ?? true) || !!camsUp);
    cam.classList.toggle('hidden-ctrl', !(this.useCamLight ?? true) || !camsUp);
  }

  // One-shot additive effect on the #fx layer or on a pointer-events-free strip.
  // WAAPI rather than a class toggle: no forced reflow read per input, and
  // transform/opacity stay off the main thread. Cancels anything in flight so
  // rapid inputs restart cleanly instead of queueing.
  fx(el, frames, opts = {}) {
    if (this.reduce.matches || !el) return;
    for (const a of el.getAnimations()) a.cancel();
    el.animate(frames, { easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'none', ...opts });
  }

  // A grade is currently readable only in the coach strip and the lane -- two
  // places the eye is not, because it is on the button. A screen-edge wash is
  // legible in peripheral vision and, being edge-only, hides nothing.
  grade(g) {
    const el = this.el.fx.vignette;
    el.style.setProperty('--fxc', GRADE_FX[g] || '#FF5449');
    const peak = g === 'good' ? 0.28 : g === 'ok' ? 0.34 : 0.62;
    this.fx(el, [{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: 0 }],
      { duration: 260, easing: 'ease-out' });
  }

  // A scanline sweep as the console comes up. The stage and every control are
  // already live underneath it.
  runEntry() {
    this.fx(this.el.fx.scan, [
      { opacity: 0, transform: 'translateY(-100%)' },
      { opacity: .09, offset: .5 },
      { opacity: 0, transform: 'translateY(100%)' },
    ], { duration: 320, easing: 'linear' });
  }

  cleanPass(t) {
    this.lane.cleanPass(t);
    const el = this.el.lane;
    el.classList.remove('pass');
    for (const a of el.getAnimations()) a.cancel();
    if (!this.reduce.matches) el.classList.add('pass');
  }

  death() {
    const el = this.el.fx.vignette;
    el.style.setProperty('--fxc', '#FF5449');
    this.fx(el, [{ opacity: 0 }, { opacity: .9, offset: .22 }, { opacity: .75 }],
      { duration: 320, fill: 'forwards', easing: 'cubic-bezier(.4,0,1,1)' });
  }

  win() {
    this.el.fx.wipe.style.setProperty('--fxc', '#FFB020');
    this.fx(this.el.fx.wipe, [
      { opacity: 0, transform: 'translateY(110%)' },
      { opacity: 1, offset: .4 },
      { opacity: 0, transform: 'translateY(-110%)' },
    ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  setStreak(text) {
    if (text && text !== this.el.coachStreak.textContent) {
      this.fx(this.el.coachStreak,
        [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 200 });
    }
    this.el.coachStreak.textContent = text || '';
  }

  // Wipe the coach strip between lessons: text from the last one bleeding into
  // a lesson that has no coach reads as live instruction.
  clearCoach() {
    this.el.coachNext.textContent = '';
    this.el.coachNext.className = '';
    this.el.coachFb.textContent = '';
    this.el.coachFb.className = '';
    this.el.coachStreak.textContent = '';
    this.el.coachBarFill.style.width = '0%';
    this.el.coachBar.classList.remove('now', 'over');
    this._lastShown = null;
    this.lane.pops.length = 0;
    this.lane.comboFlash = null;
    // The death wash holds its final frame, so it has to be cleared explicitly
    // or it bleeds into the next run.
    for (const el of Object.values(this.el.fx)) for (const a of el.getAnimations()) a.cancel();
    this.el.lane.classList.remove('pass');
  }

  // Put a pulsing ring on whatever the player should touch next.
  setCue(cue) {
    if (this._cueEl && this._cueSel !== cue?.sel) {
      this._cueEl.classList.remove('cue', 'cue-now');
      this._cueEl = null; this._cueSel = null;
    }
    if (!cue) return;
    if (this._cueSel !== cue.sel) {
      const el = this.root.querySelector(cue.sel);
      if (!el) return;
      this._cueEl = el; this._cueSel = cue.sel;
      el.classList.add('cue');
    }
    this._cueEl?.classList.toggle('cue-now', !!cue.now);
  }

  // Drag-to-calibrate. The geometry shipped in config.js is a reconstruction,
  // so every control -- cameras, light, mask, monitor, vents, wind -- can be
  // dragged to wherever your thumb actually wants it.
  enableCalibration(on) {
    this.calibrating = on;
    this.root.classList.toggle('calibrating', on);
    for (const el of this.root.querySelectorAll('.camb, [data-widget]')) {
      const has = el.querySelector(':scope > .rs');
      if (on && !has) { const h = document.createElement('i'); h.className = 'rs'; el.appendChild(h); }
      else if (!on && has) has.remove();
    }
    this.applyLightVisibility(this.lastCamsUp);
    if (on) { this.el.wind.classList.add('shown'); this.fitMap(); this.checkCollisions(); }
    else for (const el of this.root.querySelectorAll('.collide')) el.classList.remove('collide');
  }

  // Overlapping touch targets silently swallow inputs -- the tap lands on
  // whichever element happens to be on top. Flag them instead of letting the
  // player discover it mid-run.
  checkCollisions() {
    const els = [...this.root.querySelectorAll('.camb, [data-widget]')]
      .filter(e => e.offsetParent !== null);
    const rects = els.map(e => e.getBoundingClientRect());
    els.forEach(e => e.classList.remove('collide'));
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const pair = [els[i].dataset.widget, els[j].dataset.widget];
        if (pair.includes('light') && pair.includes('camlight')) continue; // never both visible
        const a = rects[i], b = rects[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          els[i].classList.add('collide'); els[j].classList.add('collide');
        }
      }
    }
    return els.filter(e => e.classList.contains('collide')).length;
  }

  bindCalibration() {
    let drag = null;
    const target = (e) => e.target.closest('.camb, [data-widget]');

    this.root.addEventListener('pointerdown', (e) => {
      if (!this.calibrating) return;
      const el = target(e); if (!el) return;
      e.stopPropagation(); e.preventDefault();
      const box = el.offsetParent?.getBoundingClientRect();
      if (!box) return;
      const r = el.getBoundingClientRect();
      const resizing = !!e.target.closest('.rs');
      drag = { el, box, resizing,
               dx: e.clientX - r.left, dy: e.clientY - r.top,
               ox: r.left, oy: r.top };
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    }, true);

    this.root.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      if (drag.resizing) {
        // Handle sits at the bottom-right, so width/height follow the pointer.
        const w = (e.clientX - drag.ox) / drag.box.width;
        const h = (e.clientY - drag.oy) / drag.box.height;
        drag.w = Math.max(0.03, Math.min(1, w));
        drag.h = Math.max(0.03, Math.min(1, h));
        drag.el.style.width = `${drag.w * 100}%`;
        drag.el.style.height = `${drag.h * 100}%`;
        return;
      }
      const w = drag.el.offsetWidth / drag.box.width;
      const h = drag.el.offsetHeight / drag.box.height;
      const x = (e.clientX - drag.box.left - drag.dx) / drag.box.width;
      const y = (e.clientY - drag.box.top - drag.dy) / drag.box.height;
      drag.x = Math.max(0, Math.min(1 - w, x));
      drag.y = Math.max(0, Math.min(1 - h, y));
      drag.el.style.left = `${drag.x * 100}%`;
      drag.el.style.top = `${drag.y * 100}%`;
    }, true);

    const end = () => {
      if (!drag) return;
      const { el, x, y, w, h } = drag;
      const rec = el.dataset.widget ? this.widgets[el.dataset.widget] : this.map[el.dataset.cam];
      let changed = false;
      if (x != null) { rec.x = x; rec.y = y; changed = true; }
      if (w != null) { rec.w = w; rec.h = h; changed = true; }
      if (changed) saveLayout(this.map, this.widgets);
      el.classList.remove('dragging');
      drag = null;
      this.checkCollisions();
    };
    this.root.addEventListener('pointerup', end, true);
    this.root.addEventListener('pointercancel', end, true);
  }

  resetMap() {
    this.map = clone(C.DEFAULT_MAP);
    this.widgets = clone(C.DEFAULT_WIDGETS);
    saveLayout(this.map, this.widgets);
    this.buildMap();
    this.fitMap();
    this.applyWidgets();
    if (this.calibrating) this.enableCalibration(true);
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function loadLayout() {
  const out = { map: clone(C.DEFAULT_MAP), widgets: clone(C.DEFAULT_WIDGETS) };
  try {
    const raw = localStorage.getItem('m7.layout');
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(out.map)) if (saved.map?.[k]) Object.assign(out.map[k], saved.map[k]);
      for (const k of Object.keys(out.widgets)) if (saved.widgets?.[k]) {
        // `space` is structural, not user data: never let a saved file change it.
        const v = saved.widgets[k];
        for (const f of ['x', 'y', 'w', 'h']) {
          if (typeof v?.[f] === 'number') out.widgets[k][f] = v[f];
        }
      }
    }
  } catch { /* fall back to defaults */ }
  return out;
}

function saveLayout(map, widgets) {
  try { localStorage.setItem('m7.layout', JSON.stringify({ map, widgets })); } catch { /* ignore */ }
}

export { fmtTime };
