#!/usr/bin/env node
/** Rebuild an owned local FNaF APK with the prepared, pinned mobile Chowdren tree. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractCcn } from '@sixam/source/truth';
import { LOCAL_RECOMPILE_GAMES, localRecompileTarget } from '@sixam/source/recompile/targets';
import type { LocalRecompileGame } from '@sixam/source/recompile/targets';
import { isOneOf, isRecord } from '@sixam/kernel';
import { withoutGit } from './lane-kit.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BASE = '9b00bb4227cc3ddd6f7baefe06120368bd7226e9';
const PATCH = join(ROOT, 'packages/source/recompile/mmfparser-chowdren-mobile.patch');
const HELP = 'usage: npm run recompile:local -- [--game fnaf1|fnaf2|fnaf3|fnaf4] [--image-workers 1|2] --apk /external/base.apk --toolchain /external/anaconda --out /external/new-build\n'
  + 'Rebuilds your owned APK. Requires the mobile patch, built mmfparser modules and AndroidSans.dat in the pinned toolchain; Docker images fnaf2-chowdren-phase1:local and fnaf2-play:local. No phone inputs.';
interface LocalBuildOptions { readonly apk: string; readonly toolchain: string; readonly out: string; readonly game?: LocalRecompileGame; readonly imageWorkers?: 1 | 2 }
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function imageInfo(name: string) {
  const value: unknown = JSON.parse(execFileSync('docker', ['image', 'inspect', '--format',
    '{"id":"{{.Id}}","os":"{{.Os}}","arch":"{{.Architecture}}"}', name], { encoding: 'utf8', timeout: 10000 }));
  if (!isRecord(value) || typeof value.id !== 'string' || value.os !== 'linux' || typeof value.arch !== 'string')
    throw new Error('Expected a local Linux Docker image: ' + name);
  return { id: value.id, os: value.os, arch: value.arch };
}

/** Reject repository-owned destinations, including a symlink into the checkout. */
function external(path: string) {
  const resolved = resolve(path);
  let ancestor = resolved;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const actual = resolve(realpathSync(ancestor), relative(ancestor, resolved));
  const rel = relative(realpathSync(ROOT), actual);
  if (!rel || (!rel.startsWith('..' + '/') && !isAbsolute(rel))) throw new Error('Game content must stay outside the repository');
  return resolved;
}

/** Apply Source's selected runtime fixes to a small external overlay, preserving the prepared toolchain. */
export function prepareRuntimeBase(toolchain: string, out: string, game: LocalRecompileGame) {
  const patches = localRecompileTarget(game).runtimePatches;
  if (!patches.length) return { mounts: [], patches: [] };
  const overlay = join(external(out), 'runtime');
  if (existsSync(overlay)) throw new Error('Runtime overlay must be new');
  const base = join(overlay, 'Chowdren/base');
  cpSync(join(external(toolchain), 'Chowdren/base'), base, { recursive: true, preserveTimestamps: true });
  const records = patches.map(name => {
    const path = join(ROOT, 'packages/source/recompile', name);
    execFileSync('git', ['-C', overlay, 'apply', path], { timeout: 10000, env: withoutGit(process.env) });
    return { name, sha256: hash(path) };
  });
  return { mounts: ['-v', base + ':/work/Chowdren/base:ro'], patches: records };
}

export async function dockerStep(out: string, name: string, args: string[], timeoutMs: number) {
  const log = join(out, name + '.log'), fd = openSync(log, 'w');
  const container = 'fnaf2-local-' + randomUUID();
  args.splice(2, 0, '--name', container);
  try {
    const child = spawn('docker', args, { stdio: ['ignore', fd, fd], detached: false });
    let timedOut = false, interrupted = false, ending = false;
    const terminate = () => {
      if (ending) return;
      ending = true;
      try { execFileSync('docker', ['rm', '--force', container], { timeout: 10000, stdio: 'ignore' }); }
      catch { /* The container may already have exited. */ }
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const interrupt = () => { interrupted = true; terminate(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('exit', done); });
      if (interrupted || timedOut || code !== 0) throw new Error(name + ' failed (' + (interrupted ? 'interrupted' : timedOut ? 'deadline' : code) + '); see ' + log);
    } finally {
      clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    }
    appendFileSync(log, '\n' + name + ' exit 0\n');
    console.log(name + ': OK — ' + log);
  } finally {
    closeSync(fd);
    try { execFileSync('docker', ['rm', '--force', container], { timeout: 10000, stdio: 'ignore' }); }
    catch { /* --rm already removed a completed container. */ }
  }
}

export async function localRecompile(options: LocalBuildOptions) {
  const game = options.game ?? 'fnaf2', target = localRecompileTarget(game);
  const imageWorkers = options.imageWorkers ?? 2;
  const out = external(options.out), apk = external(options.apk), toolchain = external(options.toolchain);
  if (existsSync(out)) throw new Error('Output must be a new directory, to prevent reuse of stale generated assets');
  if (!existsSync(apk) || !existsSync(join(toolchain, 'Chowdren/fonts/AndroidSans.dat')))
    throw new Error('Owned APK or prepared AndroidSans.dat missing');
  const base = execFileSync('git', ['-C', toolchain, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000, env: withoutGit(process.env) }).trim();
  if (base !== BASE) throw new Error('Toolchain must use pinned Anaconda ' + BASE);
  execFileSync('git', ['-C', toolchain, 'apply', '--reverse', '--check', PATCH], { timeout: 10000, stdio: 'pipe', env: withoutGit(process.env) });
  const converterImage = imageInfo('fnaf2-chowdren-phase1:local'), buildImage = imageInfo('fnaf2-play:local');
  if (converterImage.arch !== buildImage.arch) throw new Error('Converter and build images must use the same architecture');
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (uid === undefined || gid === undefined) throw new Error('This builder supports macOS and Linux hosts');
  const builderSha256 = hash(fileURLToPath(import.meta.url));
  mkdirSync(join(out, 'android-res-raw'), { recursive: true });
  const ccn = join(out, 'application.ccn');
  if (!extractCcn(apk, ccn)) throw new Error('APK contains no application.ccn');
  const resources = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8', timeout: 30000 })
    .trim().split('\n').filter(path => /^res\/raw\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(path) && !path.endsWith('/application.ccn'));
  if (!resources.length) throw new Error('APK has no res/raw resources');
  execFileSync('unzip', ['-j', '-o', '-q', apk, ...resources, '-d', join(out, 'android-res-raw')], { timeout: 180000 });
  const config = join(ROOT, 'packages/source/recompile', target.config);
  writeFileSync(join(out, target.config), readFileSync(config));
  const mounts = ['--user', uid + ':' + gid, '-v', toolchain + ':/work', '-v', out + ':/input'];
  console.log('Extracted CCN and ' + resources.length + ' raw resources to ' + out);
  await dockerStep(out, 'convert', ['run', '--rm', '--cpus', '2', ...mounts,
    '-e', 'CHOWDREN_IMAGE_COMPRESS=zlib', '-e', 'CHOWDREN_IMAGE_WORKERS=' + imageWorkers, '-e', 'MMFPARSER_ANDROID_RAW_DIR=/input/android-res-raw',
    '-e', 'MMFPARSER_OI_XOR=' + target.oiXor, '-e', 'MMFPARSER_LO_XOR=' + target.loXor,
    '-w', '/work/Chowdren', converterImage.id, 'python', '-u', '-m', 'chowdren.run',
    '--config', '/input/' + target.config, '/input/application.ccn', '/input/gamesrc'], 1200000);
  const runtime = prepareRuntimeBase(toolchain, out, game);
  const buildMounts = [...mounts, ...runtime.mounts];
  await dockerStep(out, 'configure', ['run', '--rm', ...buildMounts, buildImage.id, 'cmake', '-S', '/input/gamesrc',
    '-B', '/input/gamesrc/build-local', '-DCMAKE_BUILD_TYPE=Debug'], 120000);
  await dockerStep(out, 'compile', ['run', '--rm', ...buildMounts, buildImage.id, 'cmake', '--build', '/input/gamesrc/build-local', '--parallel', '2'], 1200000);
  const record = { schema: 'local-recompile-build-v1', label: 'MODEL_ONLY', game, package: target.package, base,
    decoder: { oiXor: target.oiXor, loXor: target.loXor },
    imageCompression: 'zlib-9', imageWorkers, conversionCpus: 2, compileJobs: 2, runtimePatches: runtime.patches,
    hostOS: process.platform, target: { os: buildImage.os, arch: buildImage.arch }, images: { converter: converterImage.id, build: buildImage.id },
    sha256: { apk: hash(apk), ccn: hash(ccn), assets: hash(join(out, 'gamesrc/Assets.dat')),
      binary: hash(join(out, 'gamesrc/build-local/Chowdren')), mobilePatch: hash(PATCH),
      fontBank: hash(join(toolchain, 'Chowdren/fonts/AndroidSans.dat')), config: hash(config), builder: builderSha256 },
    logs: Object.fromEntries(['convert', 'configure', 'compile'].map(name => [name, hash(join(out, name + '.log'))])),
    rawResources: resources.length, open: ['boot qualification', 'rendered pause', 'audio freeze', 'retail encounter fidelity'] };
  const evidenceId = 'local-recompile-' + createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16);
  writeFileSync(join(out, 'build.json'), JSON.stringify({ ...record, evidenceId }, null, 2) + '\n');
  console.log('Local binary compiled: ' + evidenceId);
  return { out, evidenceId };
}

async function main(argv: readonly string[]) {
  if (argv.includes('--help')) { console.log(HELP); return; }
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!['--apk', '--toolchain', '--out', '--game', '--image-workers'].includes(flag) || !value || values.has(flag)) throw new Error(HELP);
    values.set(flag, ['--game', '--image-workers'].includes(flag) ? value : resolve(value));
  }
  const apk = values.get('--apk'), toolchain = values.get('--toolchain'), out = values.get('--out');
  const game = values.get('--game') ?? 'fnaf2';
  if (!isOneOf(LOCAL_RECOMPILE_GAMES, game)) throw new Error(HELP);
  const imageWorkers = Number(values.get('--image-workers') ?? 2);
  if (!isOneOf([1, 2] as const, imageWorkers)) throw new Error(HELP);
  if (!apk || !toolchain || !out) throw new Error(HELP);
  await localRecompile({ apk, toolchain, out, game, imageWorkers });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
