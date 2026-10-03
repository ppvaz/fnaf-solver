#!/usr/bin/env node
/** Covers the vault round trip, dedup, tamper refusal, and the no-private-paths rule.
 *
 * The tree under test is a throwaway git repository reached through FNAF2_REPO,
 * so no assertion touches the real captures/ or artifacts/. No device.
 */
import { execFileSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const HERE = fileURLToPath(new URL('.', import.meta.url));
const TOOL = join(HERE, '../bin/vault.ts');

const scratch = mkdtempSync(join(tmpdir(), 'fnaf2-vault-'));
const repo = join(scratch, 'repo');
const vault = join(scratch, 'vault');

// Never the caller's repository. A GIT_DIR inherited from a git hook points
// every git command below at the real repository whatever the cwd: on
// 2026-09-25 this test's `git init` ran under push-gate's pre-push hook and
// reinitialised the real repository as bare (core.bare=true), and its
// `commit -m root` landed on the pushing worktree's branch.
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const run = (args: string[]) => execFileSync(process.execPath, [TOOL, ...args], {
  cwd: repo,
  encoding: 'utf8',
  // Expected refusals are assertions here, not output; keep them off the parent's stderr.
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...gitEnv, FNAF2_REPO: repo, FNAF2_VAULT_DIR: vault },
});

function refused(args: string[]) {
  try {
    run(args);
  } catch (thrown) {
    const error = thrown as Error & SpawnSyncReturns<string>; // execFileSync throws the child's result
    check(error.status === 1, `expected exit 1 from "${args.join(' ')}", got ${error.status}`);
    return error.stderr;
  }
  throw new Error(`expected a refusal from "vault ${args.join(' ')}"`);
}

const write = (relative: string, body: string | Buffer) => {
  mkdirSync(dirname(join(repo, relative)), { recursive: true });
  writeFileSync(join(repo, relative), body);
};

const treeState = (base: string) => Object.fromEntries((readdirSync(base, { recursive: true }) as string[]) // utf8 names, the default
  .filter(entry => statSync(join(base, entry)).isFile())
  .map(entry => [entry, readFileSync(join(base, entry)).toString('base64')]));

const packName = () => {
  const names = readdirSync(join(repo, 'docs', 'evidence', 'packs'));
  check(names.length === 1, `expected exactly one pack manifest, saw ${names.length}`);
  return names[0].slice(0, -5);
};

const objectCount = () => (existsSync(join(vault, 'objects'))
  ? (readdirSync(join(vault, 'objects'), { recursive: true }) as string[]) // utf8 names, the default
    .filter(entry => statSync(join(vault, 'objects', entry)).isFile()).length
  : 0);

try {
  mkdirSync(join(repo, 'docs', 'evidence'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo, env: gitEnv });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q',
    '--allow-empty', '-m', 'root'], { cwd: repo, env: gitEnv });

  write('captures/run-a-video.mp4', Buffer.from('a video payload'));
  write('captures/run-a.hid', Buffer.from('hid report stream'));
  write('captures/empty-one.hid', Buffer.alloc(0));
  write('captures/empty-two.hid', Buffer.alloc(0));
  write('captures/empty-three.hid', Buffer.alloc(0));
  write('artifacts/run-a/result.json', '{"outcome":"PASS"}\n');

  const before = treeState(join(repo, 'captures'));

  // Export is read-only over its inputs and stores one object per distinct content.
  const exported = run(['export', '--label', 'nightfive', '--paths', 'captures', 'artifacts']);
  check(exported.includes('6 file(s)'), `expected six files exported:\n${exported}`);
  check(exported.includes('empty=3'), `expected the three empty files flagged:\n${exported}`);
  check(/objects=4 new=4 reused=0/.test(exported), `expected four distinct objects:\n${exported}`);
  check(JSON.stringify(treeState(join(repo, 'captures'))) === JSON.stringify(before),
    'export modified a capture');

  const pack = packName();
  const manifestText = readFileSync(join(repo, 'docs', 'evidence', 'packs', `${pack}.json`), 'utf8');
  check(!manifestText.includes(vault), 'manifest leaked the private vault location');
  check(!manifestText.includes(repo), 'manifest leaked an absolute repository path');
  check(!/"[^"]*":\s*"\//.test(manifestText), 'manifest recorded an absolute path');
  const manifest: { schema: string, files: { path: string, class: { kind: string } }[] } = JSON.parse(manifestText);
  check(manifest.schema === 'capture-pack-v1', 'unexpected pack schema');
  check(manifest.files.every(file => !file.path.startsWith('/')), 'manifest path is not relative');
  check(manifest.files.find(file => file.path === 'captures/run-a-video.mp4')?.class.kind === 'run-video',
    'expected the corpus classifier to label the run video');
  check(manifest.files.find(file => file.path === 'artifacts/run-a/result.json')?.class.kind === 'UNKNOWN',
    'expected UNKNOWN rather than an invented class for an artifact path');

  // A second export of unchanged content stores nothing new.
  const again = run(['export', '--label', 'nightfive', '--paths', 'captures']);
  check(/new=0 reused=/.test(again), `expected a fully deduplicated re-export:\n${again}`);
  const packsAfter = readdirSync(join(repo, 'docs', 'evidence', 'packs'));
  check(packsAfter.length === 2, 'expected the second export to write its own manifest');
  rmSync(join(repo, 'docs', 'evidence', 'packs', packsAfter.find(name => !name.startsWith(pack)) as string)); // the second of the two

  // Round trip: a deleted tree comes back byte-identical, empty files included.
  rmSync(join(repo, 'captures'), { recursive: true });
  rmSync(join(repo, 'artifacts'), { recursive: true });
  const imported = run(['import', pack]);
  check(imported.includes('6 written'), `expected six files written:\n${imported}`);
  check(JSON.stringify(treeState(join(repo, 'captures'))) === JSON.stringify(before),
    'round trip did not restore byte-identical captures');
  check(['empty-one.hid', 'empty-two.hid', 'empty-three.hid']
    .every(name => statSync(join(repo, 'captures', name)).size === 0),
  'three distinct empty paths did not survive sharing one object');

  run(['verify', pack]);

  // A capture edited in place is reported and fails verify, but the vault is unharmed.
  writeFileSync(join(repo, 'captures', 'run-a-video.mp4'), 'tampered in the working tree');
  const verified = refused(['verify', pack]);
  check(verified.includes('does not match its manifest'), `expected a verify refusal:\n${verified}`);
  run(['import', pack, '--force']);
  run(['verify', pack]);

  // Import refuses to overwrite divergent content unless forced, and writes nothing meanwhile.
  writeFileSync(join(repo, 'captures', 'run-a.hid'), 'local edit worth keeping');
  const clobber = refused(['import', pack]);
  check(clobber.includes('--force'), `expected the refusal to name --force:\n${clobber}`);
  check(readFileSync(join(repo, 'captures', 'run-a.hid'), 'utf8') === 'local edit worth keeping',
    'a refused import still wrote to the working tree');

  // A corrupt vault object is caught before anything lands.
  const objects = join(vault, 'objects');
  const victim = (readdirSync(objects, { recursive: true }) as string[]) // utf8 names, the default
    .map(entry => join(objects, entry))
    .find(path => statSync(path).isFile() && statSync(path).size > 0) as string; // the export stored non-empty objects
  chmodSync(victim, 0o644);
  writeFileSync(victim, 'corrupted blob');
  const corrupt = refused(['import', pack, '--force']);
  check(corrupt.includes('vault is corrupt'), `expected a corruption refusal:\n${corrupt}`);
  check(readFileSync(join(repo, 'captures', 'run-a.hid'), 'utf8') === 'local edit worth keeping',
    'a corrupt vault still wrote to the working tree');

  // A tracked manifest is input: a path that leaves the two trees, or an object that is not a
  // sha256, is refused before anything is read or written.
  const hostilePacks: [string, (manifest: { objects: string[], files: { path: string, sha256: string }[] }) => void, string][] = [
    ['escape', manifest => { manifest.files[0].path = 'captures/../../escaped.txt'; }, 'not a path under artifacts/ or captures/'],
    ['absolute', manifest => { manifest.files[0].path = '/tmp/escaped.txt'; }, 'not a path under artifacts/ or captures/'],
    ['object', manifest => { manifest.objects[0] = '../../../escaped'; manifest.files[0].sha256 = '../../../escaped'; }, 'sha256'],
    ['unlisted', manifest => { manifest.files[0].sha256 = 'f'.repeat(64); }, 'names no object of the pack'],
  ];
  for (const [name, edit, reason] of hostilePacks) {
    const manifest = JSON.parse(manifestText);
    edit(manifest);
    writeFileSync(join(repo, 'docs', 'evidence', 'packs', `hostile-${name}.json`), JSON.stringify(manifest));
    const answer = refused(['import', `hostile-${name}`, '--force']);
    check(answer.includes(reason), `expected the ${name} manifest refused for "${reason}":\n${answer}`);
    check(!existsSync(join(scratch, 'escaped.txt')) && !existsSync('/tmp/escaped.txt'), `the ${name} manifest wrote outside the trees`);
    rmSync(join(repo, 'docs', 'evidence', 'packs', `hostile-${name}.json`));
  }

  // Refuse anything outside the two exportable trees.
  const outside = refused(['export', '--label', 'stray', '--paths', 'docs/evidence']);
  check(outside.includes('not under artifacts/ or captures/'), `expected a scope refusal:\n${outside}`);

  // refs resolves a dangling tracked reference to the pack that holds it.
  writeFileSync(join(repo, 'docs', 'evidence', 'night.json'),
    '{"trace":"captures/gone-input.pftrace (402658959 bytes, not committed)",' +
    '"inputs":["captures/run-a.hid"]}\n');
  rmSync(join(repo, 'captures', 'run-a.hid'));
  const refs = refused(['refs']);
  check(refs.includes('references media that is not here'), `expected a refs refusal:\n${refs}`);
  const report = (() => {
    try { run(['refs']); } catch (error) { return (error as SpawnSyncReturns<string>).stdout; }
    throw new Error('vault refs exited 0 over dangling references');
  })();
  check(report.includes('captures/gone-input.pftrace'), `expected the dangling trace:\n${report}`);
  check(report.includes('in no pack manifest'), `expected the unrecoverable note:\n${report}`);
  check(new RegExp(`captures/run-a.hid\\n\\s+in pack ${pack}`).test(report),
    `expected run-a.hid to be recoverable from ${pack}:\n${report}`);
  check(report.includes('2 missing, 1 recoverable'), `expected the refs summary:\n${report}`);

  check(objectCount() === 4, 'vault object count drifted across the run');
  console.log('vault: export/import round trip, dedup, empty-file fan-out, tamper and clobber ' +
    'refusals, scope guard, and dangling-reference report pass');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
