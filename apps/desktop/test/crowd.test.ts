import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { parseCrowdCommand } from '@sixam/source';
import type { CrowdAction } from '@sixam/source';
import { CrowdGrid } from '@sixam/play/recompile/crowd-grid';
import { HttpCrowdRuntime } from '@sixam/play/recompile/crowd-http';
import { readCrowdStatus } from '@sixam/play/recompile/crowd-runtime';
import type { CrowdObservation, CrowdRuntime, CrowdRuntimeStatus } from '@sixam/play/recompile/crowd-runtime';
import { crowdServer } from '../src/crowd-server.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class Fixture implements CrowdRuntime {
  value: CrowdRuntimeStatus = { sequence: 1, tick: 100, paused: true, terminal: null, night: 1, hour: '12 AM',
    imageRevision: 1, label: 'FIXTURE', commands: ['wind', 'cam10', 'mask', 'wait'],
    capabilities: { renderedPause: true, audioPause: true, disconnectStopsGame: true } };
  calls: string[] = [];
  disconnected = false;
  failHold = false;
  pending: ReturnType<typeof deferred<CrowdObservation>> | null = null;
  change(fields: Partial<CrowdObservation>) { this.value = { ...this.value, ...fields, sequence: this.value.sequence + 1 }; return this.value; }
  async status() { if (this.disconnected) throw new Error('Bridge disconnected'); return this.value; }
  async action(action: CrowdAction) {
    this.calls.push(action.name);
    if (this.pending) return this.pending.promise;
    return this.change({ tick: this.value.tick + action.durationMs * 60 / 1000, imageRevision: (this.value.imageRevision ?? 0) + 1 });
  }
  async hold(paused: boolean) {
    if (this.failHold) throw new Error('Hold failed');
    this.calls.push('hold:' + paused); return this.change({ paused: true });
  }
  async frame() { return new Uint8Array([255, 216, 255, 217]); }
  async close() { this.disconnected = true; }
}
const tile = (grid: CrowdGrid, game = 'FNAF2') => {
  const value = grid.snapshot().tiles.find(row => row.game === game);
  assert.ok(value); return value;
};

 test('grammar accepts game prefixes and bounded named actions, rejects shell/coordinates and unversioned input', () => {
  assert.equal(parseCrowdCommand('FNAF2 wind 1s @1').action.durationMs, 1000);
  assert.equal(parseCrowdCommand('FNAF1 doorL close 500ms @42').action.name, 'doorl');
  assert.equal(parseCrowdCommand('ALL pause @1').action.durationMs, 0);
  for (const text of ['FNAF2 wind', 'FNAF2 wind 6s @1', 'FNAF2 wind 49ms @1', 'FNAF2 tap 20 30 @1',
    'FNAF2 wind; ls @1', 'ALL wind @1', 'FNAF2 pause 1s @1', 'FNAF2 wind @0']) assert.throws(() => parseCrowdCommand(text));
});
 test('offline tiles never accept inputs or claim paused games', async () => {
  const grid = new CrowdGrid({}, () => 0); await grid.connect();
  assert.deepEqual(grid.snapshot().tiles.map(row => row.phase), ['OFFLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE']);
  await assert.rejects(grid.command('ALL pause @1'), /No available/);
  await assert.rejects(grid.command('FNAF2 wind @1'), /not awaiting/);
  await grid.close();
});
 test('await-input consumes each round once and advances only the addressed game', async () => {
  const runtime = new Fixture(), other = new Fixture();
  const grid = new CrowdGrid({ FNAF2: runtime, FNAF3: other }, () => 0); await grid.connect();
  await grid.command('FNAF2 wind 1s @1');
  assert.equal(tile(grid).phase, 'AWAITING_INPUT'); assert.equal(tile(grid).observation?.tick, 160);
  assert.equal(tile(grid, 'FNAF3').observation?.tick, 100);
  await assert.rejects(grid.command('FNAF2 wind 1s @1'), /Stale/);
  await assert.rejects(grid.command('FNAF2 bed @2'), /unavailable/);
  assert.deepEqual(runtime.calls, ['wind']); await grid.close();
});
 test('manual and global holds are independent; resume returns to await-input', async () => {
  const runtime = new Fixture(), grid = new CrowdGrid({ FNAF2: runtime }, () => 0); await grid.connect();
  await grid.command('FNAF2 pause @1'); await grid.command('ALL pause @1');
  await grid.command('FNAF2 resume @2');
  assert.equal(tile(grid).phase, 'PAUSED'); assert.equal(tile(grid).global, true);
  await assert.rejects(grid.command('FNAF2 wind @3'), /not awaiting/);
  await grid.command('ALL resume @2'); assert.equal(tile(grid).phase, 'AWAITING_INPUT');
  assert.deepEqual(runtime.calls, ['hold:true', 'hold:false']); await grid.close();
});
 test('manual pause can interrupt an action; polling cannot admit a second action', async () => {
  const runtime = new Fixture(); runtime.pending = deferred<CrowdObservation>();
  const grid = new CrowdGrid({ FNAF2: runtime }, () => 0); await grid.connect();
  const action = grid.command('FNAF2 wind @1'); await grid.refresh();
  assert.equal(tile(grid).phase, 'EXECUTING');
  await assert.rejects(grid.command('FNAF2 mask @2'), /not awaiting/);
  await grid.command('FNAF2 pause @2'); assert.equal(tile(grid).phase, 'PAUSED');
  runtime.pending.resolve(runtime.change({ tick: 130, imageRevision: 2 })); await action;
  assert.equal(tile(grid).phase, 'PAUSED'); await grid.close();
});
 test('global pause attempts all games even if one bridge fails', async () => {
  const failed = new Fixture(), held = new Fixture(); failed.failHold = true;
  const grid = new CrowdGrid({ FNAF2: failed, FNAF3: held }, () => 0); await grid.connect();
  await assert.rejects(grid.command('ALL pause @1'), /Hold failed/);
  assert.equal(tile(grid).phase, 'FAULT'); assert.equal(failed.disconnected, true);
  assert.equal(tile(grid, 'FNAF3').phase, 'PAUSED'); await grid.close();
});
 test('a dropped bridge aborts an action and its late reply cannot revive the tile', async () => {
  const runtime = new Fixture(); runtime.pending = deferred<CrowdObservation>();
  const grid = new CrowdGrid({ FNAF2: runtime }, () => 0); await grid.connect();
  const failed = assert.rejects(grid.command('FNAF2 wait @1'), /disconnected/);
  runtime.disconnected = true; await grid.refresh(); await failed;
  runtime.pending.resolve(runtime.change({ tick: 160, imageRevision: 2 }));
  await Promise.resolve(); assert.equal(tile(grid).phase, 'FAULT'); await grid.close();
});
 test('terminal games refuse further inputs and missing pause capabilities are rejected', async () => {
  const runtime = new Fixture(), grid = new CrowdGrid({ FNAF2: runtime }, () => 0); await grid.connect();
  runtime.change({ terminal: '6AM' }); await grid.refresh();
  await assert.rejects(grid.command('FNAF2 wind @1'), /not awaiting/);
  assert.equal(tile(grid).phase, 'TERMINAL');
  assert.throws(() => readCrowdStatus({ ...runtime.value, capabilities: { ...runtime.value.capabilities, audioPause: false } }), /lacks/);
  await grid.close();
});
 test('HTTP bridge validates observations, rejects external endpoints and bounds network waits', async () => {
  for (const url of ['http://example.com/', 'https://127.0.0.1/', 'http://user:pass@127.0.0.1/'])
    assert.throws(() => new HttpCrowdRuntime(url), /loopback/);
  const fixture = new Fixture();
  const server = createServer((req, res) => {
    if (req.url === '/hang/status') return;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.value));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + address.port;
  try {
    const runtime = new HttpCrowdRuntime(base);
    assert.equal((await runtime.status(AbortSignal.timeout(1000))).label, 'FIXTURE');
    await assert.rejects(new HttpCrowdRuntime(base + '/hang').status(AbortSignal.timeout(50)), /abort|timeout/i);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
 test('grid HTTP serves four views, enforces origin, refuses stale input and keeps an event ledger', async () => {
  const fixture = new Fixture(), grid = new CrowdGrid({ FNAF2: fixture }, () => 0); await grid.connect();
  const server = crowdServer(grid); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + address.port;
  const command = (origin: string, text: string) => fetch(base + '/api/command', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  try {
    assert.match(await (await fetch(base)).text(), /Four game views/);
    assert.equal((await command('https://foreign.example', 'FNAF2 wind @1')).status, 403);
    assert.equal((await command(base, 'FNAF2 wind @1')).status, 200);
    assert.equal((await command(base, 'FNAF2 wind @1')).status, 409);
    assert.equal(grid.snapshot().events.filter(event => event.kind === 'applied').length, 1);
  } finally { await grid.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
