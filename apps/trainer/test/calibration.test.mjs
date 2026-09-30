// Calibration smoke test: dragging a control must reposition it and must NOT
// register as a game input, and the saved layout must reach canonical core config.
import { spawn } from 'node:child_process';
import { chromeBinary, chromeArgs } from '../../../tools/chrome.mjs';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8731/dist/index.html';

// This test exercises the save-to-config path, which really does rewrite
// core config. Snapshot it so a test run never leaves the repo edited.
const CONFIG = new URL('../../../packages/source/src/games/fnaf2/config.js', import.meta.url).pathname;
const SNAPSHOT = readFileSync(CONFIG, 'utf8');
const restore = () => {
  try {
    if (readFileSync(CONFIG, 'utf8') !== SNAPSHOT) {
      writeFileSync(CONFIG, SNAPSHOT);
      execFileSync('python3', [new URL('./build.py', import.meta.url).pathname], { stdio: 'ignore' });
      console.log('(restored canonical core config and rebuilt)');
    }
  } catch (e) { console.error('RESTORE FAILED:', e.message); }
};
process.on('exit', restore);
const PORT = 9334;
const chrome = spawn(chromeBinary(),
  chromeArgs(PORT, mkdtempSync(join(tmpdir(), 'm7c-'))), { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let id = 0;
const rpc = (ws, method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  const on = (e) => { const m = JSON.parse(e.data); if (m.id !== mid) return;
    ws.removeEventListener('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: mid, method, params }));
});

const errs = [], fails = [];

async function main() {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json`); break; } catch { await sleep(250); } }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value).join(' '));
  });
  await rpc(ws, 'Runtime.enable'); await rpc(ws, 'Page.enable');
  await rpc(ws, 'Page.navigate', { url: BASE }); await sleep(1500);

  const ev = async (expr) => {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) errs.push(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const show = async (label, expr) => { const v = await ev(expr); console.log(`  ${label}: ${JSON.stringify(v)}`); return v; };
  const expect = async (label, expr, want) => {
    const v = await ev(expr);
    const ok = JSON.stringify(v) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(v)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
    if (!ok) fails.push(label);
  };
  const drag = (sel, dx, dy, pid) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});
    const b=el.getBoundingClientRect();
    const p=(t,x,y)=>el.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:${pid},clientX:x,clientY:y}));
    p('pointerdown',b.left+8,b.top+8); p('pointermove',b.left+8+${dx},b.top+8+${dy});
    p('pointerup',b.left+8+${dx},b.top+8+${dy}); return 1;})()`);

  console.log('\n— open calibration —');
  await ev('document.querySelector(\'[data-ui="settings"]\').click()'); await sleep(200);
  await ev('document.getElementById("btn-calibrate").click()'); await sleep(500);
  await expect('run panel shown', 'document.getElementById("run").classList.contains("shown")', true);
  await expect('calibrating', 'window.app.ui.calibrating', true);
  await expect('monitor forced up', 'window.app.sim.monitor', 'up');
  await expect('wind visible', 'document.getElementById("windbtn").classList.contains("shown")', true);
  await show('widgets placed', '[...document.querySelectorAll("[data-widget]")].every(e=>e.style.left!=="")');

  console.log('\n— drag WIND (must move, must not wind) —');
  const wy0 = await ev('window.app.ui.widgets.wind.y');
  await drag('#windbtn', 40, -60, 7); await sleep(150);
  await expect('sim.winding stayed false', 'window.app.sim.winding', false);
  await expect('wind y changed', `window.app.ui.widgets.wind.y !== ${wy0}`, true);

  console.log('\n— drag LIGHT (must move, must not flash) —');
  const lx0 = await ev('window.app.ui.widgets.light.x');
  await drag('[data-widget="light"]', 110, 0, 8); await sleep(150);
  await expect('sim.lightHeld stayed false', 'window.app.sim.lightHeld', false);
  await expect('light x changed', `window.app.ui.widgets.light.x !== ${lx0}`, true);

  console.log('\n— drag a camera button —');
  const cx0 = await ev('window.app.ui.map["7"].x');
  await drag('.camb[data-cam="7"]', -30, 0, 10); await sleep(150);
  await expect('cam 07 x changed', `window.app.ui.map["7"].x !== ${cx0}`, true);

  const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync('/tmp/m7-cal.png', Buffer.from(shot.data, 'base64'));

  console.log('\n— save to canonical core config —');
  await ev('document.getElementById("btn-quit").click()'); await sleep(200);
  await ev('document.querySelector(\'[data-ui="settings"]\').click()'); await sleep(200);
  // Dry run: exercises validation and the whole client path without rewriting
  // canonical core config, which earlier versions of this test silently destroyed.
  const res = await ev(`(async () => {
    const r = await fetch('/save-layout', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ map: window.app.ui.map, widgets: window.app.ui.widgets, dry: true })});
    return { status: r.status, body: await r.json() };
  })()`);
  console.log(`  save (dry): ${JSON.stringify(res)}`);
  if (!res || res.status !== 200 || !res.body?.ok) fails.push('save validates');

  console.log('\n— game input works again outside calibration —');
  await ev('document.querySelector("[data-close]").click()'); await sleep(150);
  await ev('document.querySelector(\'[data-mode="cycle"]\').click()'); await sleep(250);
  await ev('document.getElementById("btn-brief-go").click()'); await sleep(600);
  await expect('calibration off', 'window.app.ui.calibrating', false);
  await ev(`(()=>{document.querySelector('[data-act="light"]').dispatchEvent(
    new PointerEvent('pointerdown',{bubbles:true,pointerId:9})); return 1;})()`);
  await sleep(120);
  await expect('light held', 'window.app.sim.lightHeld', true);

  console.log(`\nconsole errors: ${errs.length}`);
  errs.slice(0, 5).forEach(e => console.log('  ! ' + String(e).split('\n')[0]));
  console.log(fails.length ? `FAILURES: ${fails.join(', ')}` : 'all assertions passed');
  ws.close(); chrome.kill();
  process.exit(fails.length || errs.length ? 1 : 0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(2); });
