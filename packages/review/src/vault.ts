/** Move ignored evidence media between machines and detect when it goes missing.
 *
 * Blobs live outside the repository in a content-addressed vault at
 * $FNAF2_VAULT_DIR. Pack manifests under docs/evidence/packs/ are tracked and
 * record repository-relative paths and content hashes only: a vault location is
 * one machine's private detail, while the hash is the portable identity.
 *
 *     npm run vault -- export --label NAME --paths PATH...
 *     npm run vault -- import PACK_ID [--force]
 *     npm run vault -- verify [PACK_ID]
 *     npm run vault -- refs
 *     npm run vault -- list
 *
 * Exit status: 0 success, 1 refused/invalid, 2 usage or I/O error.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync,
  readdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@sixam/kernel/contracts';
import { isList, isRecord } from '@sixam/kernel';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// FNAF2_REPO relocates the tree under test, as FNAF2_CAPTURES does for session-manifest.py.
const ROOT = resolve(process.env.FNAF2_REPO || join(HERE, '../../..'));
const PACKS = join(ROOT, 'docs', 'evidence', 'packs');
const EVIDENCE = join(ROOT, 'docs', 'evidence');
const PACK_SCHEMA = 'capture-pack-v1';
const EXPORTABLE = new Set(['artifacts', 'captures']);
const UNKNOWN = { kind: 'UNKNOWN', authority: 'UNKNOWN' };
export const KNOWN_FLAGS = new Set(['--label', '--paths', '--force', '--help']);
const SHA256 = /^[0-9a-f]{64}$/;
const PATH_PATTERN = /(?:captures|artifacts)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g;

export const usage = 'usage: npm run vault -- <export|import|verify|refs|list> ' +
  '[--label NAME] [--paths PATH...] [PACK_ID] [--force]';

export class Refused extends Error {}
function refuse(message: string): never { throw new Refused(message); }

/** One retained file of a vault pack: its repository path, its bytes, its sha256, its corpus class. */
type VaultFile = { readonly path: string, readonly bytes: number, readonly sha256: string, readonly class: unknown };
/** A vault pack manifest (docs/evidence/packs/<id>.json). */
type VaultPack = { readonly schema: string, readonly id?: string, readonly label?: string, readonly createdAt?: unknown,
  readonly source?: unknown, readonly objects: readonly string[], readonly files: readonly VaultFile[] };

const vaultRoot = () => process.env.FNAF2_VAULT_DIR || join(homedir(), 'fnaf2-vault');
const objectPath = (hash: string) => join(vaultRoot(), 'objects', hash.slice(0, 2), hash);

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function listValues(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return [];
  const values: string[] = [];
  for (let cursor = index + 1; cursor < process.argv.length; cursor += 1) {
    if (process.argv[cursor].startsWith('--')) break;
    values.push(process.argv[cursor]);
  }
  return values;
}

function sha256File(path: string) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const handle = openSync(path, 'r');
  try {
    for (;;) {
      const read = readSync(handle, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(handle);
  }
  return hash.digest('hex');
}

/** Repository-relative POSIX path, refused unless it sits in an exportable tree. */
function repoRelative(input: string) {
  const absolute = resolve(ROOT, input);
  const rel = relative(ROOT, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    refuse(`${input} lives outside the repository; the vault carries repository paths only`);
  const parts = rel.split(sep);
  if (!EXPORTABLE.has(parts[0]))
    refuse(`${parts.join('/')} is not under artifacts/ or captures/`);
  return parts.join('/');
}

function expand(relPath: string, into: Set<string>): Set<string> {
  const absolute = join(ROOT, relPath);
  if (!existsSync(absolute)) refuse(`${relPath} does not exist`);
  if (statSync(absolute).isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) expand(`${relPath}/${entry}`, into);
    return into;
  }
  into.add(relPath);
  return into;
}

/** Reuse the existing corpus classifier rather than restating its table here. */
function captureClasses(wanted: boolean) {
  const classes = new Map<string, { kind: unknown, authority: unknown }>();
  if (!wanted) return classes;
  const tool = join(HERE, '../bin/legacy', 'index-observations.ts');
  const output = execFileSync(process.execPath, [tool, 'captures', '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const rows: readonly { path: string, kind: unknown, authority: unknown }[] = JSON.parse(output).artifacts;
  for (const row of rows)
    classes.set(`captures/${row.path}`, { kind: row.kind, authority: row.authority });
  return classes;
}

function sourceCommit() {
  const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  return { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0 };
}

/** A path a manifest may name: repository-relative, under an exportable tree, with no `.` or `..` segment. */
const manifestPath = (path: unknown): path is string => typeof path === 'string'
  && EXPORTABLE.has(path.split('/')[0]) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');

/**
 * A tracked manifest is input to a write: import joins its paths to the repository and its
 * hashes to the vault, so each is checked here before either is used.
 */
function validatePack(value: unknown, id: string): VaultPack {
  if (!isRecord(value) || value.schema !== PACK_SCHEMA) refuse(`${id} is not a ${PACK_SCHEMA} manifest`);
  const { objects, files } = value;
  if (!isList(objects) || !objects.every(hash => typeof hash === 'string' && SHA256.test(hash)))
    refuse(`${id}: every object must be a sha256 hex digest`);
  if (!isList(files)) refuse(`${id}: files must be a list`);
  for (const file of files) {
    const path = isRecord(file) ? file.path : file;
    if (!isRecord(file) || !manifestPath(path)) refuse(`${id}: ${JSON.stringify(path)} is not a path under artifacts/ or captures/`);
    if (!objects.includes(file.sha256)) refuse(`${id}: ${path} names no object of the pack`);
    if (!Number.isInteger(file.bytes) || Number(file.bytes) < 0) refuse(`${id}: ${path} has no byte count`);
  }
  return value as unknown as VaultPack;
}

function readPack(id: string): VaultPack {
  if (!/^[\w-]+$/.test(id)) refuse('a safe PACK_ID is required');
  const path = join(PACKS, `${id}.json`);
  if (!existsSync(path)) refuse(`no pack manifest ${id}`);
  return validatePack(JSON.parse(readFileSync(path, 'utf8')), id);
}

const packIds = () => (existsSync(PACKS) ? readdirSync(PACKS) : [])
  .filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();

const bytesOf = (pack: VaultPack) => pack.files.reduce((total, file) => total + file.bytes, 0);

/** Copy-on-write where the filesystem offers it, a plain copy where it does not.
 *
 * `cp -c` is the only clonefile(2) route that works here: node's
 * COPYFILE_FICLONE is a no-op on Darwin and copied all 552 MB of a measured
 * pftrace, while `cp -c` cost zero blocks. A vault on another disk -- an
 * external drive, the usual case -- cannot clone at all and falls back.
 */
function cloneOrCopy(source: string, destination: string) {
  try {
    execFileSync('cp', ['-c', source, destination], { stdio: 'ignore' });
  } catch {
    copyFileSync(source, destination);
  }
}

function storeObject(absolute: string, hash: string) {
  const target = objectPath(hash);
  if (existsSync(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.incoming-${process.pid}`;
  cloneOrCopy(absolute, temporary);
  renameSync(temporary, target);
  return true;
}

function materialize(hash: string, absolute: string) {
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.vault-incoming-${process.pid}`;
  cloneOrCopy(objectPath(hash), temporary);
  renameSync(temporary, absolute);
}

function exportPack() {
  const label = arg('label');
  if (!label || !/^[A-Za-z0-9][\w-]*$/.test(label))
    refuse('--label NAME is required and must be alphanumeric, - or _');
  const requested = listValues('paths');
  if (requested.length === 0) refuse('--paths PATH... is required');

  const paths = new Set<string>();
  for (const input of requested) expand(repoRelative(input), paths);
  const ordered = [...paths].sort();
  const classes = captureClasses(ordered.some(path => path.startsWith('captures/')));

  const files = ordered.map(path => ({
    path,
    bytes: statSync(join(ROOT, path)).size,
    sha256: sha256File(join(ROOT, path)),
    class: classes.get(path) ?? UNKNOWN,
  }));

  let stored = 0;
  for (const file of files) if (storeObject(join(ROOT, file.path), file.sha256)) stored += 1;

  const stamp = new Date().toISOString();
  const id = `${label}-${stamp.replace(/[-:.]/g, '')}`;
  if (existsSync(join(PACKS, `${id}.json`)))
    refuse(`pack manifest ${id} already exists; it would be overwritten`);
  const objects = [...new Set(files.map(file => file.sha256))].sort();
  const pack = {
    schema: PACK_SCHEMA,
    id,
    label,
    createdAt: stamp,
    source: sourceCommit(),
    objects,
    files,
  };
  mkdirSync(PACKS, { recursive: true });
  writeFileSync(join(PACKS, `${id}.json`), canonicalJson(pack));

  const total = bytesOf(pack);
  const empty = files.filter(file => file.bytes === 0).length;
  console.log(`pack ${id}: ${files.length} file(s), ${total} byte(s)`);
  console.log(`  objects=${objects.length} new=${stored} reused=${objects.length - stored}` +
    (empty ? ` empty=${empty}` : ''));
  console.log(`  manifest docs/evidence/packs/${id}.json (commit it; the vault itself is not tracked)`);
}

function importPack() {
  const id = process.argv[3];
  if (!id || id.startsWith('--')) refuse('a PACK_ID is required');
  const pack = readPack(id);
  const force = process.argv.includes('--force');

  const missing = pack.objects.filter(hash => !existsSync(objectPath(hash)));
  if (missing.length > 0)
    refuse(`${missing.length} object(s) absent from this vault, starting with ${missing[0]}; ` +
      `is FNAF2_VAULT_DIR pointing at the vault that holds ${id}?`);

  for (const hash of pack.objects) {
    if (sha256File(objectPath(hash)) !== hash)
      refuse(`vault object ${hash} does not match its own hash; the vault is corrupt`);
  }

  const conflicts = [];
  const landing = [];
  for (const file of pack.files) {
    const absolute = join(ROOT, file.path);
    if (!existsSync(absolute)) { landing.push(file); continue; }
    if (sha256File(absolute) === file.sha256) continue;
    conflicts.push(file);
  }
  if (conflicts.length > 0 && !force)
    refuse(`${conflicts.length} path(s) already hold different content, starting with ` +
      `${conflicts[0].path}; re-run with --force to overwrite`);

  for (const file of [...landing, ...conflicts]) materialize(file.sha256, join(ROOT, file.path));
  const unchanged = pack.files.length - landing.length - conflicts.length;
  console.log(`imported ${id}: ${landing.length} written, ${conflicts.length} overwritten, ` +
    `${unchanged} already present`);
}

function verifyPack() {
  const ids = process.argv[3] && !process.argv[3].startsWith('--') ? [process.argv[3]] : packIds();
  if (ids.length === 0) { console.log('no pack manifests under docs/evidence/packs'); return; }
  let mismatched = 0;
  let absent = 0;
  let present = 0;
  for (const id of ids) {
    const pack = readPack(id);
    for (const file of pack.files) {
      const absolute = join(ROOT, file.path);
      if (!existsSync(absolute)) {
        absent += 1;
        console.log(`ABSENT   ${file.path} (${id})`);
      } else if (sha256File(absolute) !== file.sha256) {
        mismatched += 1;
        console.log(`MISMATCH ${file.path} (${id})`);
      } else present += 1;
    }
  }
  console.log(`${present} verified, ${absent} absent, ${mismatched} mismatched ` +
    `across ${ids.length} pack(s)`);
  if (mismatched > 0) refuse('retained content does not match its manifest');
}

function evidenceFiles(directory: string, into: string[]): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) evidenceFiles(path, into);
    else if (entry.name.endsWith('.json')) into.push(path);
  }
  return into;
}

function checkRefs() {
  const packed = new Map<string, string>();
  for (const id of packIds()) for (const file of readPack(id).files)
    if (!packed.has(file.path)) packed.set(file.path, id);

  const referenced = new Map<string, string>();
  for (const path of evidenceFiles(EVIDENCE, [])) {
    if (path.startsWith(`${PACKS}${sep}`)) continue;
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(PATH_PATTERN)) {
      if (!referenced.has(match[0])) referenced.set(match[0], relative(ROOT, path));
    }
  }

  let dangling = 0;
  let recoverable = 0;
  for (const [target, from] of [...referenced].sort()) {
    if (existsSync(join(ROOT, target))) continue;
    dangling += 1;
    const pack = packed.get(target);
    if (pack) {
      recoverable += 1;
      console.log(`MISSING  ${target}\n         in pack ${pack} -- npm run vault -- import ${pack}`);
    } else {
      console.log(`MISSING  ${target}\n         referenced by ${from}; in no pack manifest`);
    }
  }
  console.log(`${referenced.size} referenced path(s), ${dangling} missing, ` +
    `${recoverable} recoverable from a pack`);
  if (dangling > 0) refuse('tracked evidence references media that is not here');
}

function listPacks() {
  const ids = packIds();
  if (ids.length === 0) { console.log('no pack manifests under docs/evidence/packs'); return; }
  console.log(`vault ${vaultRoot()}${existsSync(vaultRoot()) ? '' : ' (absent)'}`);
  for (const id of ids) {
    const pack = readPack(id);
    const held = pack.objects.filter(hash => existsSync(objectPath(hash))).length;
    console.log(`${id}  files=${pack.files.length} bytes=${bytesOf(pack)} ` +
      `objects=${held}/${pack.objects.length} created=${pack.createdAt}`);
  }
}

/** The vault's verbs; packages/review/bin/vault.ts dispatches them. */
export const COMMANDS: Readonly<Record<string, () => void>> = {
  export: exportPack, import: importPack, verify: verifyPack, refs: checkRefs, list: listPacks,
};
