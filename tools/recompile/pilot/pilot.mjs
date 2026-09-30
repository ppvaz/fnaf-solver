#!/usr/bin/env node
/**
 * Lockstep pilot for the rebuilt build-296 games (harness CHOWDREN_PILOT_*).
 *
 *   node tools/recompile/pilot/pilot.mjs --game fnaf3|fnaf4 --run DIR --binary FILE --assets FILE
 *        --save FILE --policy NAME [--seed 24850] [--max-ticks 60000] [--knobs JSON]
 *
 * The rebuilt game runs in the toolchain container (`fnaf2-chowdren:buster`,
 * tools/recompile/run-harness.sh) with CHOWDREN_HARNESS=1 and no drawing. After
 * every update the harness writes the watched objects' state over one TCP
 * connection to this process (CHOWDREN_PILOT_CONNECT) and waits for its touches. The policy module for
 * the game (`./<game>.mjs`) turns each state into touches. Every applied touch
 * lands in DIR/pilot.input as a plain CHOWDREN_INPUT row, so
 * `replay.mjs` can run the same night on a binary with no pilot at all.
 *
 * Nothing leaves DIR: the save, the trace, the log and the rows stay outside
 * the repository with the game's assets. Host-only; no device is touched.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { closeSync, copyFileSync, mkdirSync, openSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const IMAGE = 'fnaf2-chowdren:buster';
const MOUNT = '/home/pedro/fnaf-apks';

export function parseArgs(argv) {
  const o = { seed: 24850, maxTicks: 60000, knobs: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--game') o.game = v();
    else if (a === '--run') o.run = resolve(v());
    else if (a === '--binary') o.binary = resolve(v());
    else if (a === '--assets') o.assets = resolve(v());
    else if (a === '--save') o.save = resolve(v());
    else if (a === '--policy') o.policy = v();
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--max-ticks') o.maxTicks = Number(v());
    else if (a === '--knobs') o.knobs = JSON.parse(v());
    else throw new Error(`pilot: unknown argument ${a}`);
  }
  for (const k of ['game', 'run', 'binary', 'assets', 'save', 'policy'])
    if (!o[k]) throw new Error(`pilot: --${k} is required`);
  if (!o.run.startsWith(MOUNT + '/')) throw new Error(`pilot: --run must sit under ${MOUNT} (the container mount)`);
  if (o.run.startsWith(ROOT)) throw new Error('pilot: --run must be outside the repository');
  return o;
}

export async function run(o) {
  const game = await import(`./${o.game}.mjs`);
  const policyFactory = game.POLICIES[o.policy];
  if (!policyFactory) throw new Error(`pilot: ${o.game} has no policy ${o.policy} (${Object.keys(game.POLICIES).join(', ')})`);
  mkdirSync(o.run, { recursive: true });
  for (const f of ['pilot.input', 'trace', 'run.log', game.SAVE_NAME, 'Assets.dat'])
    rmSync(join(o.run, f), { force: true });
  copyFileSync(o.save, join(o.run, 'save-before.ini'));
  copyFileSync(o.save, join(o.run, game.SAVE_NAME));
  symlinkSync(o.assets, join(o.run, 'Assets.dat'));

  // The controller serves one TCP connection; the harness in the container
  // dials host.docker.internal (a FIFO on a bind mount does not leave the VM).
  const policy = policyFactory({ knobs: o.knobs, run: o.run });
  let updates = 0;
  let quit = false;
  let failure = null;
  const server = createServer();
  const served = new Promise((res) => {
    server.on('connection', (sock) => {
      server.close();
      sock.setNoDelay(true);
      let acc = '';
      sock.on('data', (chunk) => {
        acc += chunk.toString('utf8');
        let nl;
        let reply = '';
        while ((nl = acc.indexOf('\n')) >= 0) {
          const line = acc.slice(0, nl);
          acc = acc.slice(nl + 1);
          updates += 1;
          let cmds = [];
          if (!quit && !failure) {
            try {
              cmds = policy.step(JSON.parse(line)) ?? [];
              if (policy.done) { cmds.push('quit'); quit = true; }
            } catch (e) { failure = e; cmds = ['quit']; quit = true; }
          }
          reply += (cmds.length ? cmds.join('\n') + '\n' : '') + 'E\n';
        }
        if (reply) sock.write(reply);
      });
      sock.on('close', res);
      sock.on('error', res);
    });
  });
  await new Promise((res) => server.listen(0, '0.0.0.0', res));
  const port = server.address().port;
  const env = {
    CHOWDREN_HARNESS: '1', CHOWDREN_NO_DRAW: '1', CHOWDREN_SEED: String(o.seed),
    CHOWDREN_MAX_TOTAL_TICKS: String(o.maxTicks), CHOWDREN_TIMEOUT_SECONDS: '1200',
    CHOWDREN_TRACE: 'trace', CHOWDREN_PILOT_CONNECT: `host.docker.internal:${port}`,
    CHOWDREN_PILOT_LOG: 'pilot.input', CHOWDREN_PILOT_WATCH: game.WATCH.join(','),
    CHOWDREN_PILOT_MAX_INSTANCES: String(game.MAX_INSTANCES ?? 16),
  };
  writeFileSync(join(o.run, 'env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  const args = ['run', '--rm', '-v', `${MOUNT}:${MOUNT}`, '-v', `${ROOT}/tools/recompile/run-harness.sh:/run-harness.sh:ro`,
    '-w', o.run, '-e', `CHOWDREN_BINARY=${o.binary}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(IMAGE, 'bash', '/run-harness.sh');
  const logFd = openSync(join(o.run, 'run.log'), 'w');
  const child = spawn('docker', args, { stdio: ['ignore', logFd, logFd] });
  const code = await new Promise((res) => child.on('exit', (c) => res(c)));
  server.close();
  await Promise.race([served, new Promise((res) => setTimeout(res, 2000))]);
  closeSync(logFd);
  if (failure) throw failure;
  const summary = { exit: code, updates, ...(policy.summary ? policy.summary() : {}) };
  writeFileSync(join(o.run, 'pilot-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2))).then((s) => { console.log(JSON.stringify(s)); },
    (e) => { console.error(e.stack ?? String(e)); process.exit(1); });
}
