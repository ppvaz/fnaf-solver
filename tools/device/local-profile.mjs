#!/usr/bin/env node
/**
 * The handset serial, read on this host only.
 *
 *   node tools/device/local-profile.mjs serial         prints FNAF_SERIAL, else the profile's serial;
 *                                                      exit 2 with how to set it when neither names one
 *   node tools/device/local-profile.mjs set SERIAL     writes the profile (gitignored, never committed)
 *   node tools/device/local-profile.mjs path           the profile file this checkout reads
 *
 * Pedro, 2026-09-29 (ADR 0002, decision 8): the serial is "read from an
 * untracked local profile with no default". Until then 18 scripts defaulted to
 * one handset's serial, so a run on any host addressed that phone by name, and
 * every checkout published it.
 *
 * The profile is `tools/device/local-profile.json`, listed in .gitignore:
 *
 *   { "schema": "device-local-profile-v1", "serial": "<serial>" }
 *
 * `adb devices -l` lists the serial. A worktree reads its own profile if it
 * has one, else the main checkout's, so every worktree on the host resolves the
 * same handset, as the serial lease does (cue_helper_device_lock.state_dir()).
 * FNAF_LOCAL_PROFILE names another file; the tests point it at a fixture.
 * Order: an explicit environment variable (FNAF_SERIAL), then the profile, then
 * a refusal. A dry run needs no serial; only a live run asks for one.
 * tools/test-no-serial.mjs refuses a serial in any tracked file outside the
 * frozen set and its allowlist.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export const PROFILE_SCHEMA = 'device-local-profile-v1';
/** Repository-relative, and gitignored. */
export const PROFILE_PATH = 'tools/device/local-profile.json';
/** What adb accepts as a serial: the same token every runner has checked since 2026-09-12. */
export const SERIAL_TOKEN = /^[A-Za-z0-9._:-]{1,96}$/;
export const HOW_TO = 'set FNAF_SERIAL=<serial> for this command, or write the untracked local profile once per host: '
  + `node tools/device/local-profile.mjs set <serial> (\`adb devices -l\` lists it; ${PROFILE_PATH} is gitignored, never commit it)`;

/** No serial was named: the caller refuses a live run with this message. */
export class SerialUnset extends Error {}

/**
 * The main checkout, seen from it or from any of its worktrees: a worktree's
 * `.git` file names its git dir, whose `commondir` leads to the main `.git`.
 * Mirrors cue_helper_device_lock.py's main_checkout().
 */
export function mainCheckout(root = ROOT) {
  try {
    const marker = join(root, '.git');
    if (existsSync(marker) && lstatSync(marker).isFile()) {
      const text = readFileSync(marker, 'utf8').trim();
      if (text.startsWith('gitdir:')) {
        const gitdir = resolve(root, text.slice('gitdir:'.length).trim());
        const common = join(gitdir, 'commondir');
        if (existsSync(common)) {
          const commonDir = resolve(gitdir, readFileSync(common, 'utf8').trim());
          if (commonDir.endsWith(`${'/'}.git`)) return dirname(commonDir);
        }
      }
    }
  } catch { /* fall through to this checkout */ }
  return root;
}

/** The profile files read, in order: FNAF_LOCAL_PROFILE alone, else this checkout's, then the main checkout's. */
export function profilePaths({ env = process.env, root = ROOT } = {}) {
  if (env.FNAF_LOCAL_PROFILE) return [resolve(env.FNAF_LOCAL_PROFILE)];
  return [...new Set([join(root, PROFILE_PATH), join(mainCheckout(root), PROFILE_PATH)])];
}

/** One profile file's serial. A file that exists but is malformed is an error, never skipped. */
export function readProfile(path) {
  let profile;
  try { profile = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new SerialUnset(`the local profile ${path} is unreadable (${error.message}); ${HOW_TO}`);
  }
  if (profile?.schema !== PROFILE_SCHEMA) throw new SerialUnset(`the local profile ${path} is not ${PROFILE_SCHEMA}; ${HOW_TO}`);
  if (!SERIAL_TOKEN.test(String(profile.serial ?? ''))) throw new SerialUnset(`the local profile ${path} holds no valid serial; ${HOW_TO}`);
  return profile.serial;
}

/**
 * The serial a live run addresses: the first of `names` set in the
 * environment, else the local profile. Throws SerialUnset with how to set it.
 * @returns {{serial: string, source: string}}
 */
export function resolveSerial({ env = process.env, root = ROOT, names = ['FNAF_SERIAL'] } = {}) {
  for (const name of names) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    if (!SERIAL_TOKEN.test(value)) throw new SerialUnset(`${name} is not a device serial token: ${JSON.stringify(value)}`);
    return { serial: value, source: name };
  }
  for (const path of profilePaths({ env, root }))
    if (existsSync(path)) return { serial: readProfile(path), source: path };
  throw new SerialUnset(`no handset serial: ${HOW_TO}`);
}

/** Write the profile where this host's checkouts read it. */
export function writeProfile(serial, { env = process.env, root = ROOT } = {}) {
  if (!SERIAL_TOKEN.test(String(serial ?? ''))) throw new SerialUnset(`not a device serial token: ${JSON.stringify(serial)}`);
  const path = env.FNAF_LOCAL_PROFILE ? resolve(env.FNAF_LOCAL_PROFILE) : join(mainCheckout(root), PROFILE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schema: PROFILE_SCHEMA, serial }, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function main(argv) {
  const [verb, value] = argv;
  try {
    if (verb === 'serial' && argv.length === 1) { process.stdout.write(`${resolveSerial().serial}\n`); return 0; }
    if (verb === 'set' && argv.length === 2) { console.log(`local-profile: wrote ${writeProfile(value)}`); return 0; }
    if (verb === 'path' && argv.length === 1) { console.log(profilePaths().find(existsSync) ?? profilePaths()[0]); return 0; }
  } catch (error) {
    if (!(error instanceof SerialUnset)) throw error;
    console.error(`local-profile: ${error.message}`);
    return 2;
  }
  console.error('usage: local-profile.mjs serial | set SERIAL | path');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
