// Headless smoke test over the Chrome DevTools Protocol. No dependencies:
// Node 22 ships a global WebSocket.
import { spawn } from 'node:child_process';
import { chromeBinary, chromeArgs } from '../../../tools/chrome.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] || 'http://localhost:8731/dist/index.html';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'm7-chrome-'));

const chrome = spawn(chromeBinary(), chromeArgs(PORT, profile), { stdio: 'ignore' });

const sleep = (ms) => new Promise<any>(r => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return await r.json(); }
    catch { await sleep(250); }
  }
  throw new Error('chrome did not start');
}

let id = 0;
function rpc(ws, method, params = {}) {
  const mid = ++id;
  return new Promise<any>((res, rej) => {
    const on = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== mid) return;
      ws.removeEventListener('message', on);
      m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

const logs = [], errors = [];

async function main() {
  const t = (await targets()).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise<any>(r => ws.addEventListener('open', r));

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ');
      logs.push(`${m.params.type}: ${txt}`);
      if (m.params.type === 'error') errors.push(txt);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description || d.text);
    }
  });

  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Log.enable');
  await rpc(ws, 'Page.navigate', { url: URL_ });
  await sleep(1500);

  const evalJs = async (expr) => {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) errors.push(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  const step = async (label, expr) => {
    const v = await evalJs(expr);
    console.log(`  ${label}: ${JSON.stringify(v)}`);
    return v;
  };

  console.log('\n— load —');
  await step('title', 'document.title');
  await step('modes rendered', 'document.querySelectorAll("#mode-list .mode").length');
  await step('menu visible', 'document.getElementById("menu").classList.contains("shown")');

  console.log('\n— arcade lab fixture path —');
  await evalJs('localStorage.removeItem("m7.arcade.progress")');
  await evalJs('document.querySelector(\'[data-ui="arcade"]\').click()');
  await sleep(250);
  await step('arcade panel shown', 'document.getElementById("arcade").classList.contains("shown")');
  await step('fixture label visible', 'document.getElementById("arcade").textContent.includes("FIXTURE / PRACTICE")');
  await step('prediction choices', 'document.querySelectorAll("#arcade-choices [data-arcade-answer]").length');
  await evalJs('document.querySelector("#arcade-choices [data-arcade-answer]").click()');
  await sleep(100);
  await step('answer feedback', 'document.getElementById("arcade-feedback").textContent.length > 0');
  await step('local score recorded', 'JSON.parse(localStorage["m7.arcade.progress"]).scored');
  await evalJs('document.getElementById("btn-arcade-export").click()');
  await step('progress export visible', '!document.getElementById("arcade-export").hidden');
  await evalJs('document.getElementById("btn-arcade-reset").click()');
  await step('reset clears score', 'JSON.parse(localStorage["m7.arcade.progress"]).scored');
  await evalJs('document.querySelector("#arcade [data-close]").click()');
  await sleep(150);

  console.log('\n— start a full night —');
  await evalJs('document.querySelector(\'[data-mode="night"]\').click()');
  await sleep(250);
  await step('brief shown', 'document.getElementById("brief").classList.contains("shown")');
  await evalJs('document.getElementById("btn-brief-go").click()');
  await sleep(600);
  await step('run panel shown', 'document.getElementById("run").classList.contains("shown")');
  await step('stage has hud', '!!document.querySelector("#hud .hud-timer")');
  await step('cam buttons', 'document.querySelectorAll("#map .camb").length');
  await step('sim exists', '!!window.app?.sim');
  await sleep(1200);
  await step('sim frame advancing', 'window.app.sim.frame');
  await step('timer text', 'document.getElementById("t-main").textContent');

  console.log('\n— simulate touch input —');
  await evalJs(`(() => {
    const fire = (el, type, id=1) => el.dispatchEvent(new PointerEvent(type, {bubbles:true, pointerId:id, clientX:10, clientY:10}));
    const tap = (sel) => { const el=document.querySelector(sel); fire(el,'pointerdown'); fire(el,'pointerup'); };
    window.__tap = tap;
    tap('[data-act="monitor"]');
    return true;
  })()`);
  await sleep(400);
  await step('monitor state', 'window.app.sim.monitor');
  await evalJs('window.__tap(\'[data-act="cam:10"]\')');
  await sleep(200);
  await step('current cam', 'window.app.sim.cam');
  await evalJs(`(() => { const el=document.querySelector('[data-act="light"]');
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2})); return 1; })()`);
  await sleep(120);
  await step('light held', 'window.app.sim.lightHeld');
  // Flash a room that actually has somebody in it this early in the night.
  await evalJs('(() => { const s = window.app.sim; if (s.monitor !== "up") { s.monitor = "up"; s.monAnim = 0; } return true; })()');
  await sleep(120);
  await evalJs('(() => { const s = window.app.sim; window.__busy = s.units[0].path[s.units[0].idx];'
    + ' window.__tap(`[data-act="cam:${window.__busy}"]`); return window.__busy; })()');
  await sleep(150);
  await step('flashed cam', 'window.__busy');
  await step('stun applied (frames)', 'Math.max(0,...window.app.sim.units.filter(u=>u.path[u.idx]===window.__busy).map(u=>u.stunUntil-window.app.sim.frame))');
  await evalJs(`(() => { const el=document.querySelector('[data-act="light"]');
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2})); return 1; })()`);

  const shot0 = await rpc(ws, 'Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('/tmp/m7-run.png', Buffer.from(shot0.data, 'base64'));

  console.log('\n— report path —');
  // Fast-forward a whole night so the report has something real in it.
  await evalJs(`(() => { const a=window.app; a.running=false;
    while (a.sim.alive && !a.sim.won) { a.sim.tick(); a.sim.events.length=0; }
    a.finish(); return a.sim.frame; })()`);
  await sleep(500);
  await step('report shown', 'document.getElementById("report").classList.contains("shown")');
  await step('report head', 'document.getElementById("rep-head").textContent');
  await step('timeline drawn', 'document.getElementById("rep-canvas").width > 0');
  await step('stats rows', 'document.querySelectorAll("#rep-stats div").length');

  const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(process.argv[3] || '/tmp/m7-report.png', Buffer.from(shot.data, 'base64'));

  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ! ' + e.split('\n')[0]);
  ws.close(); chrome.kill();
  process.exit(errors.length ? 1 : 0);
}

main().catch(e => { console.error(e); chrome.kill(); process.exit(2); });
