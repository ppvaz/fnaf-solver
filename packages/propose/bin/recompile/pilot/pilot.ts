#!/usr/bin/env node
/**
 * Lockstep pilot for the rebuilt build-296 games (harness CHOWDREN_PILOT_*).
 *
 *   node packages/propose/bin/recompile/pilot/pilot.ts --game fnaf3|fnaf4 --run DIR --binary FILE --assets FILE
 *        --save FILE --policy NAME [--seed 24850] [--max-ticks 60000] [--knobs JSON]
 *        [--docker] [--stop-frame N] [--no-trace] [--kill-on-loss]
 *        [--prefix PILOT_INPUT --branch UPDATE [--hold N]]
 *
 * The rebuilt game runs natively by default, with SDL's offscreen video driver
 * on a surfaceless EGL display. The same binary gives the same trace as it does
 * in the toolchain container, and runs about four times faster. `--docker` runs
 * it in the container instead (`fnaf2-chowdren:buster`,
 * packages/source/recompile/run-harness.sh). Either way it runs with CHOWDREN_HARNESS=1 and
 * no drawing. `--stop-frame N` ends the run 30 updates into frame N (5, the
 * win frame of both games, after the save is written); `--kill-on-loss` ends
 * it as soon as the policy reports a loss. `--prefix` replays an earlier
 * run's own pilot.input row for row up to update `--branch` of the play
 * frame, then sends no touch for `--hold` updates, and only then hands the
 * night to the policy (search.mjs branches a lost night this way). The
 * summary names the last update seen in the play frame (`lastPlayTick`).
 * After
 * every update the harness writes the watched objects' state over one TCP
 * connection to this process (CHOWDREN_PILOT_CONNECT) and waits for its touches. The policy module for
 * the game (`./<game>.mjs`) turns each state into touches. Every applied touch
 * lands in DIR/pilot.input as a plain CHOWDREN_INPUT row, so
 * `replay.ts` can run the same night on a binary with no pilot at all.
 *
 * Nothing leaves DIR: the save, the trace, the log and the rows stay outside
 * the repository with the game's assets. Host-only; no device is touched.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const IMAGE = 'fnaf2-chowdren:buster';
const MOUNT = '/home/pedro/fnaf-apks';
// The native runtime environment: SDL's offscreen driver on a surfaceless EGL
// display (Mesa llvmpipe), audio to OpenAL Soft's null backend. Forcing
// LIBGL_ALWAYS_SOFTWARE here crashes EGL's device selection.
export const NATIVE_ENV = { SDL_VIDEODRIVER: 'offscreen', EGL_PLATFORM: 'surfaceless', ALSOFT_DRIVERS: 'null' };

export function parseArgs(argv) {
  const o: any = { seed: 24850, maxTicks: 60000, knobs: {}, docker: false, stopFrame: null, trace: true, killOnLoss: false,
    prefix: null, branch: null, hold: 0 };
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
    else if (a === '--docker') o.docker = true;
    else if (a === '--stop-frame') o.stopFrame = Number(v());
    else if (a === '--no-trace') o.trace = false;
    else if (a === '--kill-on-loss') o.killOnLoss = true;
    else if (a === '--prefix') o.prefix = resolve(v());
    else if (a === '--branch') o.branch = Number(v());
    else if (a === '--hold') o.hold = Number(v());
    else throw new Error(`pilot: unknown argument ${a}`);
  }
  for (const k of ['game', 'run', 'binary', 'assets', 'save', 'policy'])
    if (!o[k]) throw new Error(`pilot: --${k} is required`);
  if (o.docker && !o.run.startsWith(MOUNT + '/')) throw new Error(`pilot: --run must sit under ${MOUNT} (the container mount)`);
  if (o.run.startsWith(ROOT)) throw new Error('pilot: --run must be outside the repository');
  if ((o.prefix === null) !== (o.branch === null)) throw new Error('pilot: --prefix and --branch go together');
  return o;
}

/** A pilot.input as rows: { f, t, cmd } in the order the harness applied them. */
export function readRows(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const m = /^(-?\d+) (\d+) (.+)$/.exec(l);
    if (!m) throw new Error(`pilot: bad input row ${l}`);
    return { f: Number(m[1]), t: Number(m[2]), cmd: m[3] };
  });
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

  // The controller serves one TCP connection. A container harness dials
  // host.docker.internal: a FIFO on a bind mount does not leave the VM.
  const policy = policyFactory({ knobs: o.knobs, run: o.run });
  let updates = 0;
  let quit = false;
  let failure = null;
  let child = null;
  let objects = {};
  // The play frame is the one a policy plays the night in.
  const PLAY = game.OFFICE ?? game.LEVEL;
  let lastPlayTick = null;
  // --prefix: rows replayed as they were applied. The harness applies a
  // reply's touches on the update after the state it answers, so a row
  // logged at (f, t) is sent in reply to state (f, t - 1).
  const rows = o.prefix ? readRows(o.prefix) : [];
  let next = 0;
  let replaying = o.prefix !== null;
  let holdLeft = o.hold;
  const server = createServer();
  const served = new Promise<any>((res) => {
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
              // CHOWDREN_PILOT_DELTA: a delta line carries only the objects
              // that changed; merge it into the last full picture.
              const state = JSON.parse(line);
              if (state.delta) state.o = Object.assign(objects, state.o);
              else objects = state.o;
              if (state.f === PLAY) lastPlayTick = state.t;
              if (replaying && state.f === PLAY && state.t + 1 > o.branch) replaying = false;
              if (replaying) {
                while (next < rows.length && rows[next].f === state.f && rows[next].t === state.t + 1) cmds.push(rows[next++].cmd);
              } else if (holdLeft > 0) {
                holdLeft -= 1;
              } else {
                cmds = policy.step(state) ?? [];
              }
              if (policy.done) {
                cmds.push('quit'); quit = true;
                const outcome = policy.summary ? policy.summary().outcome : null;
                if (o.killOnLoss && outcome !== '6AM' && child) child.kill('SIGKILL');
              }
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
  await new Promise<any>((res) => server.listen(0, o.docker ? '0.0.0.0' : '127.0.0.1', res));
  const port = (server.address() as any).port;
  const env: any = {
    CHOWDREN_HARNESS: '1', CHOWDREN_NO_DRAW: '1', CHOWDREN_SEED: String(o.seed),
    CHOWDREN_MAX_TOTAL_TICKS: String(o.maxTicks), CHOWDREN_TIMEOUT_SECONDS: '1200',
    CHOWDREN_PILOT_CONNECT: `${o.docker ? 'host.docker.internal' : '127.0.0.1'}:${port}`,
    CHOWDREN_PILOT_LOG: 'pilot.input', CHOWDREN_PILOT_WATCH: game.WATCH.join(','),
    CHOWDREN_PILOT_MAX_INSTANCES: String(game.MAX_INSTANCES ?? 16), CHOWDREN_PILOT_DELTA: '1',
  };
  if (o.trace) env.CHOWDREN_TRACE = 'trace';
  if (o.stopFrame !== null) { env.CHOWDREN_STOP_FRAME = String(o.stopFrame); env.CHOWDREN_MAX_TICKS = '30'; }
  writeFileSync(join(o.run, 'env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  const logFd = openSync(join(o.run, 'run.log'), 'w');
  if (o.docker) {
    const args = ['run', '--rm', '-v', `${MOUNT}:${MOUNT}`, '-v', `${ROOT}/packages/source/recompile/run-harness.sh:/run-harness.sh:ro`,
      '-w', o.run, '-e', `CHOWDREN_BINARY=${o.binary}`];
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
    args.push(IMAGE, 'bash', '/run-harness.sh');
    child = spawn('docker', args, { stdio: ['ignore', logFd, logFd] });
  } else {
    child = spawn(o.binary, [], { cwd: o.run, stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ...env, ...NATIVE_ENV } });
  }
  const code = await new Promise<any>((res) => child.on('exit', (c, sig) => res(c ?? sig)));
  server.close();
  await Promise.race([served, new Promise<any>((res) => setTimeout(res, 2000))]);
  closeSync(logFd);
  if (failure) throw failure;
  const summary = { exit: code, updates, runtime: o.docker ? 'docker' : 'native', lastPlayTick,
    ...(o.prefix ? { prefix: { rows: next, of: rows.length, branch: o.branch, hold: o.hold } } : {}),
    ...(policy.summary ? policy.summary() : {}) };
  writeFileSync(join(o.run, 'pilot-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2))).then((s) => { console.log(JSON.stringify(s)); },
    (e) => { console.error(e.stack ?? String(e)); process.exit(1); });
}
