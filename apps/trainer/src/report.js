import * as C from '@sixam/source/fnaf2';

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

// The post-run view. The important row is stun coverage: three bars that must
// never touch zero. Everything else explains why they did.
export function drawTimeline(canvas, sim) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const rec = sim.rec;
  const n = rec.n;
  if (!n) return;
  const pad = 52, plotW = W - pad - 10;
  const stunRow = (k) => ({
    label: `CAM ${String(C.TARGET_CAMS[k]).padStart(2, '0')}`,
    get: i => rec.stun[k][i] / C.STUN_FRAMES,
    color: '#4FD2EE',
    // Red only when somebody is standing in that room with no stun left.
    // An empty room is not a mistake.
    danger: i => (rec.occ[i] & (1 << k)) !== 0 && rec.stun[k][i] === 0,
    idle: i => (rec.occ[i] & (1 << k)) === 0,
  });
  const rows = [
    stunRow(0), stunRow(1), stunRow(2),
    { label: 'FOXY D', get: i => Math.min(1, rec.d[i] / 8), color: '#FFB020', danger: i => rec.d[i] >= 4 },
    { label: 'POWER',  get: i => rec.power[i] / C.POWER_FRAMES, color: '#57DC6E' },
    { label: 'BOX',    get: i => rec.box[i] / 255, color: '#C983F5' },
  ];
  const rowH = Math.floor((H - 26) / rows.length);

  ctx.font = `500 8.5px ${MONO}`;
  rows.forEach((row, r) => {
    const y0 = r * rowH + 4, h = rowH - 8;
    ctx.fillStyle = '#8A9483';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(row.label, pad - 8, y0 + h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(pad, y0, plotW, h);
    for (let x = 0; x < plotW; x++) {
      const i = Math.floor(x / plotW * n);
      const v = Math.max(0, Math.min(1, row.get(i)));
      const danger = row.danger ? row.danger(i) : v <= 0.001;
      const idle = row.idle ? row.idle(i) : false;
      if (idle && v <= 0.001) { ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(pad + x, y0 + h - 1, 1, 1); continue; }
      ctx.fillStyle = danger ? '#FF5449' : row.color;
      const bh = danger ? h : Math.max(1, v * h);
      ctx.fillRect(pad + x, y0 + h - bh, 1, bh);
    }
  });

  // Ticks: in-game hours for a real night, seconds for a short drill run.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = '#5C6656'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const useHours = n >= C.HOUR_FRAMES;
  const stepF = useHours ? C.HOUR_FRAMES : Math.max(C.FPS * 5, Math.round(n / 6 / C.FPS) * C.FPS);
  for (let k = 0; k * stepF <= n; k++) {
    const f = k * stepF;
    const x = pad + (f / n) * plotW;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 20); ctx.stroke();
    ctx.fillText(useHours ? (k === 0 ? '12AM' : `${k}AM`) : `${Math.round(f / C.FPS)}s`, x, H - 18);
  }
  // death marker
  if (sim.death) {
    const x = pad + (sim.death.frame / n) * plotW;
    ctx.strokeStyle = '#FF5449'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 20); ctx.stroke();
  }
}

export function buildSummary(sim, coach) {
  const s = coach ? coach.summary : null;
  const survived = sim.frame / C.FPS;
  const hour = Math.min(6, Math.floor(sim.frame / C.HOUR_FRAMES));
  const lightUsed = C.POWER_FRAMES - sim.power;
  const budget = lightUsed / Math.max(1, sim.frame); // ms of light per ms of night
  const gaps = countStunGaps(sim);
  return {
    survived, hour, won: sim.won,
    death: sim.death,
    lightUsedSec: lightUsed / C.FPS,
    lightPerSec: budget,
    lightBudgetOk: budget <= (C.POWER_FRAMES / C.NIGHT_FRAMES),
    gaps,
    coach: s,
    mistakes: sim.mistakes.slice(-40),
  };
}

// How often each stalled camera actually lapsed while somebody was standing in it.
function countStunGaps(sim) {
  const rec = sim.rec, out = [];
  for (let k = 0; k < 3; k++) {
    let gaps = 0, inGap = false, worst = 0, cur = 0;
    for (let i = 0; i < rec.n; i++) {
      const occupied = (rec.occ[i] & (1 << k)) !== 0;
      const lapsed = occupied && rec.stun[k][i] === 0;
      if (lapsed) { if (!inGap) { inGap = true; gaps++; cur = 0; } cur++; worst = Math.max(worst, cur); }
      else inGap = false;
    }
    out.push({ cam: C.TARGET_CAMS[k], gaps, worstSec: worst / C.FPS });
  }
  return out;
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = (sec % 60);
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
