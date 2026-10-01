#!/usr/bin/env node
// Which of README.md's routes this machine is ready for: `npm run probe`.
//
// README.md names what each route needs -- Node 20+ for the checkout routes, and for the full
// test suite what CI installs: Java 17, Python 3.12 with Pillow, NumPy and SciPy, ffmpeg and a
// clone with full history; Docker for the rebuild. A newcomer used to find out one failed test
// at a time. This asks the machine once and prints one line per check, a `Ready:` line per
// route, and one `Next:` suggestion. The versions CI uses are read from ci.yml, so the probe
// cannot drift from the job it describes.
//
// It only reads this machine: version flags, `git rev-parse`, and `docker info` on a local
// socket. It never touches the phone (the Phone route is reported as not checked) or the
// network -- a Docker daemon reached over TCP or SSH is named, not contacted. It uses Node's
// built-ins only, so it runs before `npm ci`. It exits 0 whatever is missing: it informs, it
// does not gate.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

/** The versions and pins ci.yml gives its runner, or the README's when ci.yml is unreadable. */
function ciVersions() {
  let text = '';
  try { text = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'); } catch { /* the README's numbers below */ }
  const pins = {};
  for (const line of text.split('\n').filter(item => /pip install/.test(item)))
    for (const match of line.matchAll(/'([A-Za-z0-9_.-]+)==([^']+)'/g)) pins[match[1].toLowerCase()] = match[2];
  return {
    node: Number(text.match(/node-version:\s*'?(\d+)/)?.[1] ?? 22),
    java: Number(text.match(/java-version:\s*'?(\d+)/)?.[1] ?? 17),
    python: text.match(/python-version:\s*'([\d.]+)'/)?.[1] ?? '3.12',
    pins,
  };
}

/** Run a local program for its version output; null when it is not on PATH or does not answer. */
function ask(command, args, timeout = 5000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status === null) return null;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const MIN_NODE = 20;
const CI = ciVersions();
const MODULES = [['PIL', 'Pillow'], ['numpy', 'NumPy'], ['scipy', 'SciPy']];

function probe() {
  const checks = {};
  // `fix` is what the Next line suggests when this check blocks a route.
  const set = (key, name, status, detail, fix = null) => { checks[key] = { name, status, detail, fix }; };

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  set('node', 'Node', nodeMajor >= MIN_NODE ? 'ok' : 'missing', `${process.versions.node} (${MIN_NODE}+ needed; CI uses ${CI.node})`,
    `install Node ${MIN_NODE} or newer (CI uses ${CI.node})`);

  const installed = existsSync(join(ROOT, 'node_modules/@sixam/kernel'));
  set('deps', 'npm ci', installed ? 'ok' : 'missing', installed ? 'workspace dependencies installed' : 'not run in this checkout',
    'run `npm ci`');

  const java = ask('java', ['-version']);
  const javaVersion = java ? `${java.stderr}${java.stdout}`.match(/version "(\d+)(?:\.(\d+))?[^"]*"/) : null;
  const javaMajor = javaVersion ? (javaVersion[1] === '1' ? Number(javaVersion[2]) : Number(javaVersion[1])) : null;
  const installJava = `install Java ${CI.java}`;
  if (!java) set('java', 'Java', 'missing', `not on PATH (${CI.java} needed)`, installJava);
  else if (javaMajor === null) set('java', 'Java', 'warn', `java answered without a version (${CI.java} needed)`);
  else set('java', 'Java', javaMajor === CI.java ? 'ok' : javaMajor > CI.java ? 'warn' : 'missing',
    `${javaMajor} (${CI.java} needed${javaMajor > CI.java ? `; CI uses ${CI.java} and a newer one may differ` : ''})`, installJava);

  const script = 'import importlib, json, sys\n'
    + 'found = {}\n'
    + `for name in ${JSON.stringify(MODULES.map(([module]) => module))}:\n`
    + '    try: found[name] = getattr(importlib.import_module(name), "__version__", "present")\n'
    + '    except Exception: found[name] = None\n'
    + 'print(json.dumps({"version": "%d.%d.%d" % sys.version_info[:3], "modules": found}))';
  const python = ask('python3', ['-c', script], 15000);
  let parsed = null;
  try { parsed = python?.status === 0 ? JSON.parse(python.stdout.trim().split('\n').pop()) : null; } catch { parsed = null; }
  const installPython = `install Python ${CI.python} with Pillow, NumPy and SciPy`;
  if (!python) set('python', 'Python', 'missing', `python3 not on PATH (${CI.python} with Pillow, NumPy and SciPy needed)`, installPython);
  else if (!parsed) set('python', 'Python', 'missing', 'python3 did not report its version and modules', installPython);
  else {
    const absent = MODULES.filter(([module]) => !parsed.modules?.[module]).map(([, label]) => label);
    const listed = MODULES.map(([module, label]) => `${label} ${parsed.modules?.[module] ?? 'missing'}`).join(', ');
    const sameMinor = parsed.version.split('.').slice(0, 2).join('.') === CI.python;
    const pins = Object.entries(CI.pins).map(([name, version]) => `${name}==${version}`).join(' ');
    set('python', 'Python', absent.length ? 'missing' : sameMinor ? 'ok' : 'warn',
      `${parsed.version} with ${listed}${absent.length ? ` (install ${absent.join(', ')})` : ''}`
        + `${sameMinor ? '' : ` (CI uses ${CI.python}; another version may differ)`}`,
      `install ${absent.join(', ')} for python3${pins ? ` (CI pins ${pins})` : ''}`);
  }

  const ffmpeg = ask('ffmpeg', ['-version']);
  const ffmpegVersion = ffmpeg?.stdout.match(/^ffmpeg version (\S+)/m)?.[1];
  set('ffmpeg', 'ffmpeg', ffmpeg && ffmpeg.status === 0 ? 'ok' : 'missing',
    ffmpeg && ffmpeg.status === 0 ? (ffmpegVersion ?? 'present') : 'not on PATH', 'install ffmpeg');

  const git = ask('git', ['-C', ROOT, 'rev-parse', '--is-shallow-repository']);
  const shallow = git?.status === 0 ? git.stdout.trim() : null;
  if (!git) set('clone', 'Clone', 'missing', 'git not on PATH', 'install git');
  else if (shallow === 'false') set('clone', 'Clone', 'ok', 'full history');
  else if (shallow === 'true') set('clone', 'Clone', 'missing', 'shallow; `git fetch --unshallow` fetches the rest',
    'fetch the full history (`git fetch --unshallow`)');
  else set('clone', 'Clone', 'missing', 'not a git checkout (the full tests read its history)', 'work in a git clone of the repository');

  const docker = ask('docker', ['--version']);
  const dockerVersion = docker?.stdout.match(/version ([\w.+-]+)/)?.[1] ?? 'present';
  // A daemon is asked only on a local socket. DOCKER_HOST, or the current context, may point
  // at another machine: that is named and left alone.
  const endpoint = process.env.DOCKER_HOST
    ?? (docker ? ask('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])?.stdout.trim() : '') ?? '';
  const local = !endpoint || /^(unix|npipe):\/\//.test(endpoint);
  if (!docker || docker.status !== 0) set('docker', 'Docker', 'missing', 'not on PATH (the rebuild route only)', 'install Docker');
  else if (!local) set('docker', 'Docker', 'warn', `client ${dockerVersion}; its daemon at ${endpoint} is not contacted, the probe stays off the network (the rebuild route only)`);
  else {
    const info = ask('docker', ['info', '--format', '{{.ServerVersion}}'], 10000);
    const server = info?.status === 0 ? info.stdout.trim() : '';
    set('docker', 'Docker', server ? 'ok' : 'missing', server ? `${dockerVersion}, daemon ${server} answering (the rebuild route only)`
      : `client ${dockerVersion}, but the daemon does not answer (the rebuild route only)`, 'start Docker');
  }
  return checks;
}

/** One route: ready when none of what it needs is missing; what differs from CI is said. */
function route(checks, keys) {
  const blocking = keys.filter(key => checks[key].status === 'missing');
  const differs = keys.filter(key => checks[key].status === 'warn').map(key => checks[key].name);
  return { ready: !blocking.length, blocking, differs };
}

function report(checks) {
  const lines = ['probe: what this machine has for the routes in README.md (reads only this machine: no phone, no network)'];
  for (const key of ['node', 'deps', 'java', 'python', 'ffmpeg', 'clone', 'docker'])
    lines.push(`  ${checks[key].status.padEnd(9)}${checks[key].name}: ${checks[key].detail}`);
  const checkout = ['node', 'deps'];
  const full = ['node', 'deps', 'java', 'python', 'ffmpeg', 'clone'];
  const routes: Record<string, [{ ready: boolean, blocking: string[], differs: string[] }, string]> = {
    Story: [{ ready: true, blocking: [], differs: [] }, 'nothing to install; README.md and the clips in it'],
    Strategies: [route(checks, checkout), '`npm run research -- --help`'],
    Claims: [route(checks, checkout), '`npm run evidence -- promotions`'],
    'Full tests': [route(checks, full), '`npm test` and `npm run test:unit:slow`'],
    'Rebuild (owner only)': [route(checks, ['docker']), 'Docker answers; it also needs your own copy of the game (not checked)'],
  };
  for (const [name, [state, how]] of Object.entries(routes)) {
    if (!state.ready) lines.push(`Ready: ${name} -- no: needs ${state.blocking.map(key => checks[key].name).join(', ')}`);
    // The one warning Docker gives is a daemon on another machine, which was not asked.
    else if (name.startsWith('Rebuild') && state.differs.length)
      lines.push(`Ready: ${name} -- not checked: Docker's daemon is on another machine, which the probe does not contact`);
    else lines.push(`Ready: ${name} -- yes: ${how}${state.differs.length ? `; ${state.differs.join(', ')} differ from CI` : ''}`);
  }
  lines.push('Ready: Phone -- not checked here, no phone access (needs a Moto g56 and the game)');
  const fixes = keys => keys.map(key => checks[key].fix).join('; ');
  const [claims] = routes.Claims;
  const [tests] = routes['Full tests'];
  lines.push(`Next: ${!claims.ready ? `${fixes(claims.blocking)}; then \`npm run evidence -- promotions\``
    : !tests.ready ? `\`npm run evidence -- promotions\` works now; for the full tests: ${fixes(tests.blocking)}`
      : '`npm run evidence -- promotions` re-checks every committed run pack against the promotion gate'}`);
  return lines;
}

try {
  for (const line of report(probe())) console.log(line);
} catch (error) {
  console.log(`probe: could not finish (${error.message}); it is informational, so nothing is blocked`);
}
process.exitCode = 0;
