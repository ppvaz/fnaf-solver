// The office flashlight and the camera light are separate controls in separate
// places; exactly one must be on screen at a time, and the coach must cue the
// one that is actually visible.
import { spawn } from 'node:child_process';
import { chromeBinary, chromeArgs } from '../../../tools/chrome.ts';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const PORT = 9339;
const chrome = spawn(chromeBinary(),
  chromeArgs(PORT, mkdtempSync(join(tmpdir(), 'm7g-'))), { stdio: 'ignore' });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** An entry of Chrome's /json target list; a fresh Chrome opens about:blank, a page target. */
interface Target { readonly type: string, readonly webSocketDebuggerUrl: string }
interface ExceptionDetails { readonly exception?: { readonly description?: string } }
/** What this test reads of each DevTools method's reply; any other reply it ignores. */
interface Replies { 'Runtime.evaluate': { readonly result?: { readonly value?: unknown } } }
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
const fails: string[] = [], errs: (string | undefined)[] = [];
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json`); break; } catch { await sleep(200); } }
const t: Target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x: Target) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise<Event>(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => { const m: CdpEvent = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); });
await rpc(ws, 'Runtime.enable'); await rpc(ws, 'Page.enable');
await rpc(ws, 'Page.navigate', { url: process.argv[2] || 'http://localhost:8731/dist/index.html' }); await sleep(1500);
const ev = async (e: string) => (await rpc(ws, 'Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const expect = async (l: string, e: string, want: unknown) => { const v = await ev(e);
  const ok = JSON.stringify(v) === JSON.stringify(want);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}: ${JSON.stringify(v)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  if (!ok) fails.push(l); };
const visible = `[...document.querySelectorAll('[data-widget]')]
  .filter(e=>!e.classList.contains('hidden-ctrl')).map(e=>e.dataset.widget).sort().join()`;
const openLesson = async (id: string) => { await ev('document.getElementById("btn-quit")?.click()');
  await ev('document.querySelector("[data-close]")?.click()'); await sleep(120);
  await ev(`document.querySelector('[data-mode="${id}"]').click()`); await sleep(200);
  await ev('document.getElementById("btn-brief-go").click()'); await sleep(500); };

console.log('\n— sweep lesson: cams up, so the CAMERA light —');
await ev('localStorage.removeItem("m7.progress")'); await ev('location.reload()'); await sleep(1300);
await openLesson('sweep');
await expect('visible controls', visible, 'camlight');
await expect('first cue is CAM 10', 'window.app.coach.cue.sel', '.camb[data-cam="10"]');
// the light cue only appears once the camera has been selected
await ev(`(()=>{const el=document.querySelector('.camb[data-cam="10"]');
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:41}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:41}));return 1})()`);
await sleep(150);
await expect('then cues camlight', 'window.app.coach.cue.sel', '[data-widget="camlight"]');

console.log('\n— office lesson: cams down, so the OFFICE flashlight —');
await openLesson('office');
await expect('starts with cams up', 'window.app.sim.camsUp', true);
await ev('window.app.sim.setMonitor(false); window.app.sim.monAnim=0; window.app.sim.monitor="down"'); await sleep(150);
await expect('office light showing', visible, 'light,mask,monitor');
await expect('coach cues office light', 'window.app.coach.lightSel', '[data-widget="light"]');

console.log('\n— full cycle: they swap as the monitor moves —');
await openLesson('cycle');
await ev('window.app.sim.monitor="down"'); await sleep(120);
await expect('down -> office light', visible, 'light,mask,monitor,wind');
await ev('window.app.sim.monitor="up"'); await sleep(120);
await expect('up -> camera light', visible, 'camlight,mask,monitor,wind');

console.log('\n— both reachable while calibrating —');
await ev('document.getElementById("btn-quit").click()'); await sleep(150);
await ev('document.querySelector(\'[data-ui="settings"]\').click()'); await sleep(150);
await ev('document.getElementById("btn-calibrate").click()'); await sleep(400);
await expect('both lights draggable', `[...document.querySelectorAll('[data-widget]')]
  .filter(e=>!e.classList.contains('hidden-ctrl')).map(e=>e.dataset.widget).sort().join()`,
  'camlight,light,mask,monitor,ventL,ventR,wind');
await expect('overlap not flagged', 'document.querySelectorAll(".collide").length', 0);

console.log(`\nerrors: ${errs.length}`);
console.log(fails.length ? `FAILURES: ${fails.join(', ')}` : 'all assertions passed');
ws.close(); chrome.kill(); process.exit(fails.length || errs.length ? 1 : 0);
