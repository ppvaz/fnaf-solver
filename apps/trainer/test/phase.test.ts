// Drives lessons 7 (Phase A) and 8 (Phase B) in a real browser. These are the
// two lessons that have only ever been checked headlessly.
import { spawn } from 'node:child_process';
import { chromeBinary, chromeArgs } from '../../../tools/chrome.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8731/dist/index.html';
const PORT = 9345;
const chrome = spawn(chromeBinary(),
  chromeArgs(PORT, mkdtempSync(join(tmpdir(), 'm7p-'))), { stdio: 'ignore' });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** An entry of Chrome's /json target list; a fresh Chrome opens about:blank, a page target. */
interface Target { readonly type: string, readonly webSocketDebuggerUrl: string }
interface ExceptionDetails { readonly exception?: { readonly description?: string } }
/** What this test reads of each DevTools method's reply; any other reply it ignores. */
interface Replies {
  'Runtime.evaluate': { readonly result?: { readonly value?: unknown } };
  'Page.captureScreenshot': { readonly data: string };
}
type Reply<M extends string> = M extends keyof Replies ? Replies[M] : unknown;
/** A DevTools message: the reply to a request carries its id, and its result or an error. */
interface Message<R> { readonly id?: number, readonly result: R, readonly error?: { readonly message: string } }
/** The event this test reads; it passes over every other message. */
interface CdpEvent { readonly method: 'Runtime.exceptionThrown', readonly params: { readonly exceptionDetails: ExceptionDetails } }
let id = 0;
const rpc = <M extends string>(ws: WebSocket, m: M, p = {}) => new Promise<Reply<M>>((res, rej) => { const mid = ++id;
  const on = (e: MessageEvent) => { const x: Message<Reply<M>> = JSON.parse(e.data); if (x.id !== mid) return;
    ws.removeEventListener('message', on); x.error ? rej(new Error(x.error.message)) : res(x.result); };
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });

const errs: (string | undefined)[] = [], fails: string[] = [];

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

async function main() {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json`); break; } catch { await sleep(200); } }
  const t: Target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x: Target) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise<Event>(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m: CdpEvent = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); });
  await rpc(ws, 'Runtime.enable'); await rpc(ws, 'Page.enable');
  await rpc(ws, 'Page.navigate', { url: BASE }); await sleep(1500);

  const ev = async (e: string) => (await rpc(ws, 'Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const show = async (l: string, e: string) => { const v = await ev(e); console.log(`  ${l}: ${JSON.stringify(v)}`); return v; };
  const expect = async (l: string, e: string, want: unknown) => { const v = await ev(e);
    const ok = JSON.stringify(v) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}: ${JSON.stringify(v)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
    if (!ok) fails.push(l); return v; };
  const open = async (id: string) => { await ev('document.getElementById("btn-quit")?.click()');
    await ev('document.querySelector("[data-close]")?.click()'); await sleep(150);
    await ev(`document.querySelector('[data-mode="${id}"]').click()`); await sleep(200);
    await ev('document.getElementById("btn-brief-go").click()'); await sleep(600); };

  await ev('localStorage.removeItem("m7.progress")'); await ev('location.reload()'); await sleep(1300);

  console.log('\n— Phase A (lesson 7) —');
  await open('phaseA');
  await expect('running', 'window.app.running', true);
  await show('drill', 'window.app.mode.drill');
  await ev(CYCLE_BOT);
  await sleep(22000);
  await show('BB stage', 'window.app.sim.bb.stage');
  await show('BB in opening', 'window.app.sim.bb.inOpening');
  await show('cams up at the 5s interval?', `(() => {
    const s = window.app.sim; return { monitor: s.monitor, t: s.t.toFixed(2) }; })()`);
  await show('streak', 'document.getElementById("coach-streak").textContent');
  await show('alive', 'window.app.sim.alive');
  await show('BB entered office', 'window.app.sim.death?.reason || "no"');
  await show('flagged grades', 'window.app.coach.results.slice(-6).map(r=>r.grade).join()');
  // Does the lesson actually grade the thing it claims to teach?
  await show('script ids', 'window.app.coach.script.map(s=>s.id).join()');

  // The point of the lesson: cams up when the interval lands must fail you.
  await show('streak before', 'window.app.coach.streak');
  await ev('clearInterval(window.__auto); window.__rel && window.__rel();');
  await ev(`(async () => {
    const s = window.app.sim;
    // pin the monitor up straight through the next 5s interval
    const target = (Math.floor(s.frame / 300) + 1) * 300;
    while (s.frame < target + 20) { s.monitor = 'up'; s.monAnim = 0; await new Promise(r => setTimeout(r, 6)); }
    return true; })()`);
  await sleep(400);
  await expect('cams up at interval resets the streak', 'window.app.coach.streak', 0);
  await show('lane said', 'window.app.ui.lane.pops.map(p=>p.label).slice(-3).join(" | ")');
  writeFileSync('/tmp/m7-phaseA.png', Buffer.from((await rpc(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  console.log('\n— Phase B (lesson 8) —');
  await ev('clearInterval(window.__auto); window.__rel && window.__rel()');
  await open('phaseB');
  await expect('running', 'window.app.running', true);
  await show('coach enabled', 'window.app.coach.enabled');
  await show('lane shown', 'getComputedStyle(document.getElementById("lane")).display');
  await ev(DUEL_BOT);
  await sleep(25000);
  await show('duel attempts', 'window.app.duel.marks.length');
  await show('last duel (ms)', 'window.app.duel.lastResult ? Math.round(window.app.duel.lastResult*1000) : null');
  await show('best duel (ms)', 'window.app.duel.best ? Math.round(window.app.duel.best*1000) : null');
  await show('duel wins', 'window.app.duelWins');
  await show('streak text', 'document.getElementById("coach-streak").textContent');
  await show('passed?', 'document.getElementById("passed").classList.contains("shown")');
  await show('alive', 'window.app.sim.alive');
  await show('duel lane drawn', 'window.app.ui.duelMode');
  writeFileSync('/tmp/m7-phaseB.png', Buffer.from((await rpc(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await ev('clearInterval(window.__duel); clearInterval(window.__auto)');
  console.log(`\nconsole errors: ${errs.length}`);
  errs.slice(0, 5).forEach(e => console.log('  ! ' + String(e).split('\n')[0]));
  console.log(fails.length ? `FAILURES: ${fails.join(', ')}` : 'no hard failures');
  ws.close(); chrome.kill(); process.exit(fails.length || errs.length ? 1 : 0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(2); });
