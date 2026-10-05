#!/usr/bin/env node
/** npm run twitch:poc -- [--port 8740] [--runtime-map /external/runtimes.json] [--out /external/session] */
import { mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isRecord } from '@sixam/kernel';
import { isCrowdGame } from '@sixam/source';
import type { CrowdGame } from '@sixam/source';
import { CrowdGrid } from '@sixam/play/recompile/crowd-grid';
import { HttpCrowdRuntime } from '@sixam/play/recompile/crowd-http';
import { crowdServer } from './crowd-server.ts';

const HELP = 'usage: npm run twitch:poc -- [--port 8740] [--runtime-map FILE] [--out DIR]\n'
  + 'Local four-game grid. Without a runtime map every tile awaits its runtime. No phone or Twitch connection.';

async function main(argv: readonly string[]) {
  if (argv.includes('--help')) { console.log(HELP); return; }
  let port = 8740, map: string | null = null, out = resolve('artifacts/twitch-poc', new Date().toISOString().replace(/[:.]/g, '-'));
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i], value = argv[++i];
    if (!value) throw new Error(`Missing value for ${name}`);
    if (name === '--port') port = Number(value);
    else if (name === '--runtime-map') map = resolve(value);
    else if (name === '--out') out = resolve(value);
    else throw new Error(`Unknown option ${name}`);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024 to 65535');
  const runtimes: Partial<Record<CrowdGame, HttpCrowdRuntime>> = {};
  if (map) {
    const config: unknown = JSON.parse(readFileSync(map, 'utf8'));
    if (!isRecord(config)) throw new Error('Runtime map must be an object');
    for (const [game, address] of Object.entries(config)) {
      if (!isCrowdGame(game) || typeof address !== 'string') throw new Error('Runtime map requires FNAF1-4 and HTTP loopback URLs');
      runtimes[game] = new HttpCrowdRuntime(address);
    }
  }
  mkdirSync(out, { recursive: true });
  const log = resolve(out, 'events.jsonl');
  const grid = new CrowdGrid(runtimes, Date.now, event => appendFileSync(log, JSON.stringify(event) + '\n'));
  await grid.connect();
  const server = crowdServer(grid);
  try { await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await grid.close(); throw error; }
  let refreshing = false;
  const timer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void grid.refresh().finally(() => { refreshing = false; });
  }, 500);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    await grid.close();
    const events = readFileSync(log);
    const evidenceId = 'crowd-session-' + createHash('sha256').update(events).digest('hex').slice(0, 16);
    writeFileSync(resolve(out, 'result.json'), JSON.stringify({ schema: 'crowd-session-v1', evidenceId,
      label: Object.values(runtimes).length ? 'UNKNOWN' : 'FIXTURE',
      status: grid.snapshot(), notMeasured: ['native pause fidelity', 'audio freeze', 'Twitch latency', 'retail phone play'] }, null, 2) + '\n');
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    console.log(`Session retained: ${out} (${evidenceId})`);
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  console.log(`Twitch Plays FNaF — http://127.0.0.1:${port}\nSession: ${out}\nRuntime bridges configured: ${Object.keys(runtimes).join(', ') || 'none; awaiting runtimes'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => { console.error(`twitch-poc: ${error.message}\n${HELP}`); process.exitCode = 1; });
