import * as C from '@sixam/source/fnaf2';

// A rhythm lane. The routine is a timing pattern, so show it as one: upcoming
// inputs scroll toward a hit line, each with its tolerance window drawn around
// it. This is what makes "when" visible instead of something you are expected
// to already feel.

// [border, fill] per input kind, matching the chips on the lesson brief and
// the strategy board -- one colour per control, everywhere it appears.
const COLORS = {
  cam:     ['#4FD2EE', '#0C2833'],
  light:   ['#FFB020', '#33270A'],
  mask:    ['#FF5449', '#331110'],
  monitor: ['#C9D2C3', '#20261F'],
  wind:    ['#C983F5', '#2A1140'],
};
const INK = { dim: '#8A9483', dimmer: '#5C6656', line: '#161C16',
              good: '#57DC6E', ok: '#FFB020', bad: '#FF5449', violet: '#C983F5' };
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

export function glyphFor(step) {
  switch (step.action) {
    case 'monitor': return { text: step.want === 'up' ? 'CAMS ▲' : 'CAMS ▼', kind: 'monitor' };
    case 'mask': return { text: 'MASK', kind: 'mask' };
    case 'light': return { text: 'FLASH', kind: 'light' };
    case 'wind': return { text: 'WIND', kind: 'wind' };
    case 'cam':
    case 'camflash': return { text: String(step.cam).padStart(2, '0'), kind: 'cam' };
    default: return { text: '?', kind: 'monitor' };
  }
}

// A picture of a lesson's pattern, for the briefing screen: the shape of the
// routine laid out on a timeline before you have to play it. With `head` set,
// a playhead is drawn at that offset and the glyphs it has already passed are
// lit -- see sweepPattern below for why that is worth the extra parameter.
export function drawPattern(canvas, script, head = null) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H || !script?.length) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const last = script[script.length - 1];
  const span = Math.max(2, last.at + (last.hold || 0) + 0.4);
  const padL = 20, padR = 14, padB = 20, padT = 14;
  const xOf = (at) => padL + (at / span) * (W - padL - padR);

  // Ten inputs land inside 1.5 s, so three rows is not enough to lay them out
  // without collisions -- take as many as the box is tall enough to hold.
  const ROW_H = 20, headBand = 24;   // headBand keeps row 0 clear of the anchor label
  const nRows = Math.max(3, Math.min(6, Math.floor((H - padT - padB - headBand) / ROW_H)));
  const yOf = (row) => padT + headBand + 10 + row * ROW_H;

  // second gridlines
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let sec = 0; sec <= span; sec += 0.5) {
    const x = xOf(sec);
    ctx.strokeStyle = sec % 1 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    if (sec % 1 === 0) { ctx.fillStyle = INK.dimmer; ctx.fillText(`+${sec}s`, x, H - padB + 5); }
  }
  // the anchor itself, marked on the timeline rather than labelled beside it
  ctx.strokeStyle = 'rgba(255,176,32,0.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(0), padT); ctx.lineTo(xOf(0), H - padB); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = `700 9px ${MONO}`;
  ctx.fillStyle = '#FFB020';
  ctx.fillText(':X2 / :X7', xOf(0) + 6, padT + 2);

  if (head != null) {
    const x = xOf(Math.min(head, span));
    ctx.strokeStyle = '#FFB020'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    ctx.lineWidth = 1;
  }

  ctx.font = `600 10px ${MONO}`;
  const rowEnd = new Array(nRows).fill(-1e9);
  for (const step of script) {
    const g = glyphFor(step);
    const [fg, bg] = COLORS[g.kind];
    const x = xOf(step.at);
    const tw = ctx.measureText(g.text).width + 12;
    let row = 0;
    while (row < nRows - 1 && x - tw / 2 < rowEnd[row] + 4) row++;
    rowEnd[row] = x + tw / 2;
    const y = yOf(row);
    if (step.hold) {
      const x2 = xOf(Math.min(span, step.at + step.hold));
      ctx.fillStyle = 'rgba(201,131,245,0.16)';
      roundRect(ctx, x, y - 7, Math.max(4, x2 - x), 14, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(201,131,245,0.5)';
      roundRect(ctx, x, y - 7, Math.max(4, x2 - x), 14, 5); ctx.stroke();
    }
    // Dim until the playhead reaches it, so the sweep reads as the routine
    // being performed rather than a line sliding over a finished picture.
    ctx.globalAlpha = head != null && step.at > head ? 0.4 : 1;
    ctx.fillStyle = bg;
    roundRect(ctx, x - tw / 2, y - 8, tw, 16, 5); ctx.fill();
    ctx.strokeStyle = fg;
    roundRect(ctx, x - tw / 2, y - 8, tw, 16, 5); ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.text, x, y + 1);
    ctx.globalAlpha = 1;
  }
}

// Play the pattern through once at 1.00x, then leave it drawn.
//
// This is the only place the tempo of the routine can be shown before a single
// tap is graded: the brief used to teach the ORDER of ten inputs but nothing
// about them landing inside 1.5 seconds. Linear is not a stylistic choice --
// any easing here would teach a tempo the game does not have.
export function sweepPattern(canvas, script, isLive) {
  if (!script?.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    requestAnimationFrame(() => drawPattern(canvas, script));
    return;
  }
  const last = script[script.length - 1];
  const span = last.at + (last.hold || 0) + 0.4;
  let t0 = null;
  const step = (now) => {
    if (!isLive()) return;
    if (t0 == null) t0 = now;
    const head = (now - t0) / 1000;
    drawPattern(canvas, script, Math.min(head, span));
    if (head < span) requestAnimationFrame(step);
    else drawPattern(canvas, script);
  };
  requestAnimationFrame(step);
}

export class Lane {
  declare canvas: any;
  declare ctx: any;
  declare pops: any[];
  declare flash: number;
  declare pps: number;
  declare comboFlash: any;
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pops = [];           // floating judgement text
    this.flash = 0;           // whole-lane flash on a clean pass
    // Lookahead must exceed one 5s cycle, or the lane sits empty between
    // passes and stops telling you anything.
    this.pps = 105;
  }

  pop(label, grade, t) {
    this.pops.push({ label, grade, t, born: t });
    if (this.pops.length > 8) this.pops.shift();
  }

  cleanPass(t) { this.flash = t; }
  milestone(t) { this.comboFlash = t; }

  // Phase B has no script to follow, so the lane shows the thing that actually
  // matters there: how much stun is left before the animatronics break loose.
  drawDuel(sim, duel) {
    const cv = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = 12, barW = W - pad * 2, mid = H / 2;
    let least = C.STUN_FRAMES, occupied = false;
    for (const cam of C.TARGET_CAMS) {
      for (const u of sim.units) {
        if (u.done || u.path[u.idx] !== cam) continue;
        occupied = true;
        least = Math.min(least, Math.max(0, u.stunUntil - sim.frame));
      }
    }
    const frac = occupied ? least / C.STUN_FRAMES : 1;

    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK.dim;
    const label = sim.bb.inOpening ? 'BB IS IN THE VENT — mask on, wait for the bang'
      : sim.maskOn ? 'masked — react the instant he leaves'
      : 'stun remaining before they break loose';
    ctx.fillText(label, pad, mid - 13);

    ctx.fillStyle = INK.line;
    roundRect(ctx, pad, mid, barW, 12, 6); ctx.fill();
    ctx.fillStyle = frac > 0.4 ? INK.good : frac > 0.15 ? INK.ok : INK.bad;
    roundRect(ctx, pad, mid, Math.max(3, barW * frac), 12, 6); ctx.fill();

    ctx.textAlign = 'right';
    ctx.fillStyle = INK.dim;
    const last = duel?.lastResult != null ? `${Math.round(duel.lastResult * 1000)}ms` : '—';
    const best = duel?.best != null ? `${Math.round(duel.best * 1000)}ms` : '—';
    ctx.fillText(`last ${last}   best ${best}`, W - pad, mid - 13);
  }

  draw(coach, sim) {
    const cv = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const t = sim.t;
    const hitX = Math.round(W * 0.12);
    const mid = H / 2 + 2;

    // Clean-pass phosphor sweep. A clean pass is the unit of progress in eight
    // of ten lessons and used to be a flat wash you would not notice while
    // looking at CAM 07; a directional sweep reads from the corner of the eye.
    const since = t - this.flash;
    if (since >= 0 && since < 0.42) {
      const k = since / 0.42;
      ctx.fillStyle = `rgba(87,220,110,${0.16 * (1 - k)})`;
      ctx.fillRect(0, 0, W, H);
      const cx = -60 + k * (W + 120);
      const g = ctx.createLinearGradient(cx - 60, 0, cx + 60, 0);
      g.addColorStop(0, 'rgba(87,220,110,0)');
      g.addColorStop(0.5, `rgba(87,220,110,${0.3 * (1 - k)})`);
      g.addColorStop(1, 'rgba(87,220,110,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // rail
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

    // hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hitX, 4); ctx.lineTo(hitX, H - 4); ctx.stroke();
    ctx.lineWidth = 1;

    if (coach?.enabled) {
      const notes = coach.upcoming(Math.max(5.6, (W - hitX) / this.pps));
      ctx.font = `600 11px ${MONO}`;

      // Steps 0.2s apart would draw on top of each other, so lay them out in
      // rows: a note drops to the next row if it would collide with the last
      // one placed there.
      const ROWS = [-15, 0, 15];
      const rowEnd = [-1e9, -1e9, -1e9];
      const placed = [];
      for (const n of notes) {
        const x = hitX + (n.due - t) * this.pps;
        if (x < -60 || x > W + 60) continue;
        const g = glyphFor(n.step);
        const tw = ctx.measureText(g.text).width + 14;
        let row = 0;
        while (row < ROWS.length - 1 && x - tw / 2 < rowEnd[row] + 4) row++;
        rowEnd[row] = x + tw / 2;
        placed.push({ n, x, g, tw, y: mid + ROWS[row] });
      }

      for (const { n, x, g, tw, y } of placed) {
        const [fg, bg] = COLORS[g.kind];

        // A held input draws as a bar for as long as it must be held down.
        if (n.step.hold) {
          const x2 = x + n.step.hold * this.pps;
          const live = sim.isWinding && t >= n.due && t <= n.due + n.step.hold;
          ctx.fillStyle = live ? 'rgba(201,131,245,0.30)' : 'rgba(201,131,245,0.12)';
          roundRect(ctx, x, y - 7, Math.max(4, x2 - x), 14, 5); ctx.fill();
          ctx.strokeStyle = live ? fg : 'rgba(201,131,245,0.45)';
          roundRect(ctx, x, y - 7, Math.max(4, x2 - x), 14, 5); ctx.stroke();
        }

        // Lopsided on purpose: a step's early and late tolerances differ, and
        // the shape is the lesson -- the mask cannot be late, the hall flash
        // cannot be early.
        const tol = coach.tolFor(n.step);
        const wl = tol.okEarly * this.pps, wr = tol.okLate * this.pps;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x - wl, y - 10, wl + wr, 20);

        ctx.globalAlpha = n.due < t - 0.05 ? 0.45 : 1;
        ctx.fillStyle = bg;
        roundRect(ctx, x - tw / 2, y - 9, tw, 18, 5); ctx.fill();
        ctx.strokeStyle = fg;
        roundRect(ctx, x - tw / 2, y - 9, tw, 18, 5); ctx.stroke();
        ctx.fillStyle = fg;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(g.text, x, y + 1);
        ctx.globalAlpha = 1;
      }
    }

    // Judgement pops, striking and falling away just past the hit line. Held at
    // full for the first quarter so the text is readable, then eased out; 0.7s
    // rather than 0.85 because at ten inputs per cycle the old window stacked
    // up to eight of these on top of each other.
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      const age = t - p.born;
      if (age > 0.7) { this.pops.splice(i, 1); continue; }
      const k = age / 0.7;
      ctx.globalAlpha = k < 0.25 ? 1 : 1 - ((k - 0.25) / 0.75) ** 1.6;
      ctx.font = `700 12px ${MONO}`;
      ctx.fillStyle = p.grade === 'good' ? INK.good : p.grade === 'ok' ? INK.ok : INK.bad;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(p.label, hitX - 8, mid - (1 - (1 - k) ** 2) * 12);
      ctx.globalAlpha = 1;
    }

    // Combo. The app's only continuous reward, and crossing 10 or 20 used to be
    // a silent colour change. It sits in the far corner of the lane, so scaling
    // it disturbs nothing.
    if (coach?.combo > 2) {
      const k = this.comboFlash != null ? Math.min(1, (t - this.comboFlash) / 0.36) : 1;
      const col = coach.combo >= 20 ? INK.violet : coach.combo >= 10 ? INK.good : INK.dim;
      ctx.save();
      ctx.translate(W - 8, mid);
      ctx.scale(1 + 0.6 * (1 - k) ** 2, 1 + 0.6 * (1 - k) ** 2);
      ctx.font = `700 13px ${MONO}`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      if (k < 1) { ctx.shadowColor = col; ctx.shadowBlur = 14 * (1 - k); }
      ctx.fillStyle = col;
      ctx.fillText(`${coach.combo}x`, 0, 0);
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { C };
