// Drives lessons 7 (Phase A) and 8 (Phase B) in a real browser. These are the
// two lessons that have only ever been checked headlessly.
//
// Until 2026-10-02 Phase A's one assertion, that cameras up on the 5 s interval
// reset the streak to 0, passed whether or not there was a streak to reset,
// and Phase B asserted only that the lesson was running: its duel was printed.
// Both now wait for the state they test, with a deadline, instead of sleeping.
//
//   node apps/trainer/test/phase.test.ts [url]   # default: the dev server on :8731
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { is, openApp } from './cdp.ts';
import type { Page } from './cdp.ts';

let page: Page;
before(async () => {
  page = await openApp({ freshProgress: true });
});
after(async () => {
  await page?.evaluate('clearInterval(window.__duel); clearInterval(window.__auto); true').catch(() => {});
  await page?.close();
});

const atLeast = (floor: number) => (value: unknown) => typeof value === 'number' && value >= floor;

// Plays the coached cycle, holding inputs that must be held.
const CYCLE_BOT = `window.__auto && clearInterval(window.__auto);
window.__held=null;
window.__rel=()=>{if(window.__held){window.__held.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:31}));window.__held=null;}};
window.__auto=setInterval(()=>{const app=window.app;
 if(!app||!app.running||!app.coach||!app.coach.enabled)return;
 const c=app.coach,e=c.expected; if(!e||c.cycleStart==null)return;
 if(app.sim.t<c.cycleStart+e.at)return;
 const cue=c.cue; if(!cue)return; const el=document.querySelector(cue.sel); if(!el)return;
 if(window.__held===el)return;
 window.__rel();
 el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:31}));
 if(e.hold)window.__held=el; else el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:31}));
},8); true`;

// Reacts to a Balloon Boy attack: mask up, then un-mask and re-flash the moment
// he leaves. Deliberately fast, to exercise the duel window.
const DUEL_BOT = `window.__duel && clearInterval(window.__duel);
window.__phase='idle';
const tapSel=(s)=>{const el=document.querySelector(s); if(!el)return false;
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:33}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:33})); return true;};
window.__duel=setInterval(()=>{const app=window.app; if(!app||!app.running)return;
 const s=app.sim;
 if(s.bb.inOpening && !s.maskOn && window.__phase==='idle'){
   tapSel('.camb[data-cam="10"]'); tapSel('[data-widget="camlight"]');
   tapSel('.camb[data-cam="4"]');  tapSel('[data-widget="camlight"]');
   tapSel('.camb[data-cam="7"]');  tapSel('[data-widget="camlight"]');
   tapSel('[data-widget="monitor"]');
   window.__phase='masking';
   setTimeout(()=>tapSel('[data-widget="mask"]'),40);
   return;
 }
 if(window.__phase==='masking' && s.maskOn && !s.bb.inOpening){
   tapSel('[data-widget="mask"]');            // un-mask: starts the duel clock
   tapSel('[data-widget="monitor"]');
   setTimeout(()=>{tapSel('.camb[data-cam="10"]'); tapSel('.camb[data-cam="4"]');},20);
   window.__phase='idle';
 }
},8); true`;

/** Leave whatever is running, open lesson `id`'s brief and start it. */
async function openLesson(id: string) {
  await page.evaluate('clearInterval(window.__auto); window.__rel && window.__rel(); true');
  await page.evaluate('document.getElementById("btn-quit")?.click(); document.querySelector("[data-close]")?.click(); true');
  await page.evaluate(`document.querySelector('[data-mode="${id}"]').click()`);
  await page.waitFor(`the ${id} brief`, 'document.getElementById("brief").classList.contains("shown")', is(true), 2_000);
  await page.evaluate('document.getElementById("btn-brief-go").click()');
  await page.waitFor(`the ${id} lesson running`, 'window.app.running && window.app.modeKey', is(id), 3_000);
}

test('Phase A grades the cameras being down when the 5 s interval lands', async () => {
  await openLesson('phaseA');
  assert.equal(await page.evaluate('window.app.mode.drill'), 'phaseA');
  assert.equal(await page.evaluate('window.app.coach.script.some(step => step.id === "drop-for-bb")'), true,
    'the lesson teaches the drop for BB');
  await page.evaluate(CYCLE_BOT);
  // A perfect player builds a streak: the precondition for the reset below
  // to mean anything (it read 4 of 6 after 22 s on 2026-10-02).
  await page.waitFor('a streak from the perfect player', 'window.app.coach.streak', atLeast(1), 40_000);
  assert.equal(await page.evaluate('window.app.sim.alive'), true, 'the player is alive');
  assert.equal(await page.evaluate('window.app.sim.death?.reason ?? null'), null, 'BB never entered the office');
  assert.deepEqual(await page.evaluate('window.app.coach.results.filter(r => r.grade !== "good" && r.grade !== "ok").map(r => r.grade)'), [],
    'every graded press was on time');
  await page.screenshot('phaseA-streak.png');

  // The point of the lesson: cams up when the interval lands must fail you.
  await page.evaluate('clearInterval(window.__auto); window.__rel && window.__rel(); true');
  await page.evaluate(`(async () => {
    const s = window.app.sim;
    // Pin the monitor up straight through the next 5 s interval.
    const target = (Math.floor(s.frame / 300) + 1) * 300;
    while (s.frame < target + 20) { s.monitor = 'up'; s.monAnim = 0; await new Promise(r => setTimeout(r, 6)); }
    return true; })()`);
  await page.waitFor('the streak reset', 'window.app.coach.streak', is(0), 2_000);
  assert.equal(await page.evaluate('window.app.ui.lane.pops.some(p => p.label === "CAMS WERE UP")'), true,
    'the lane says why');
});

test('Phase B times the duel after BB leaves', async () => {
  await openLesson('phaseB');
  assert.equal(await page.evaluate('window.app.coach.enabled'), false, 'the duel is not coached on cues');
  assert.equal(await page.evaluate('window.app.ui.duelMode'), true, 'the duel lane is drawn');
  assert.equal(await page.evaluate('getComputedStyle(document.getElementById("lane")).display'), 'block');
  await page.evaluate(DUEL_BOT);
  // A fast player wins a duel inside the lesson's 700 ms target (one win at
  // 17 ms within 25 s on 2026-10-02); each attack re-arms after 90 frames.
  await page.waitFor('a duel won', 'window.app.duelWins', atLeast(1), 60_000);
  const result = await page.evaluate('window.app.duel.lastResult');
  assert.ok(typeof result === 'number' && result >= 0 && result <= 0.7, `the last duel, ${String(result)} s, is inside 0.7 s`);
  assert.equal(await page.evaluate('window.app.duel.marks.length > 0'), true, 'the attempt is marked');
  assert.match(String(await page.evaluate('document.getElementById("coach-streak").textContent')), /^\d+ \/ 6 {2}\(\d+ms\)$/,
    'the streak shows wins of six and the last time');
  assert.equal(await page.evaluate('window.app.sim.alive'), true);
  await page.screenshot('phaseB-duel.png');
});

test('no console error or uncaught exception', () => {
  assert.deepEqual(page.problems, []);
});
