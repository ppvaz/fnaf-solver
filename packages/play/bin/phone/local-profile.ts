#!/usr/bin/env node
/**
 * The handset serial, read on this host only.
 *
 *   node packages/play/bin/phone/local-profile.ts serial         prints FNAF_SERIAL, else the profile's serial;
 *                                                      exit 2 with how to set it when neither names one
 *   node packages/play/bin/phone/local-profile.ts set SERIAL     writes the profile (gitignored, never committed)
 *   node packages/play/bin/phone/local-profile.ts path           the profile file this checkout reads
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
 * same handset, as the serial lease does (companion_device_lock.state_dir()).
 * FNAF_LOCAL_PROFILE names another file; the tests point it at a fixture.
 * Order: an explicit environment variable (FNAF_SERIAL), then the profile, then
 * a refusal. A dry run needs no serial; only a live run asks for one.
 * tools/test-no-serial.ts refuses a serial in any tracked file outside the
 * frozen set and its allowlist.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRecord } from '@sixam/kernel';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');

export const PROFILE_SCHEMA = 'device-local-profile-v1';
/** Repository-relative, and gitignored. */
export const PROFILE_PATH = 'tools/device/local-profile.json';
/** What adb accepts as a serial: the same token every runner has checked since 2026-09-12. */
export const SERIAL_TOKEN = /^[A-Za-z0-9._:-]{1,96}$/;
export const HOW_TO = 'set FNAF_SERIAL=<serial> for this command, or write the untracked local profile once per host: '
  + `node packages/play/bin/phone/local-profile.ts set <serial> (\`adb devices -l\` lists it; ${PROFILE_PATH} is gitignored, never commit it)`;

/** A device detail the profile should hold is not set: the caller refuses with this message. */
export class ProfileUnset extends Error {}
/** No serial was named: the caller refuses a live run with this message. */
export class SerialUnset extends ProfileUnset {}
/** What BlueZ accepts as the phone's Bluetooth address. */
export const BT_MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
export const BT_MAC_HOW_TO = 'set FNAF_BT_MAC=<mac> for this command, or write it into the untracked local profile once per host: '
  + `node packages/play/bin/phone/local-profile.ts set-bt-mac <mac> (bluetoothctl devices lists it; ${PROFILE_PATH} is gitignored)`;

/**
 * The main checkout, seen from it or from any of its worktrees: a worktree's
 * `.git` file names its git dir, whose `commondir` leads to the main `.git`.
 * Mirrors companion_device_lock.py's main_checkout().
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
export function readProfile(path: string) {
  let profile;
  try { profile = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new SerialUnset(`the local profile ${path} is unreadable (${(error as Error).message}); ${HOW_TO}`);
  }
  if (profile?.schema !== PROFILE_SCHEMA) throw new SerialUnset(`the local profile ${path} is not ${PROFILE_SCHEMA}; ${HOW_TO}`);
  if (!SERIAL_TOKEN.test(String(profile.serial ?? ''))) throw new SerialUnset(`the local profile ${path} holds no valid serial; ${HOW_TO}`);
  return profile.serial;
}

/**
 * The serial a live run addresses: the first of `names` set in the
 * environment, else the local profile. Throws SerialUnset with how to set it.
 */
export function resolveSerial({ env = process.env, root = ROOT, names = ['FNAF_SERIAL'] } = {}): {serial: string, source: string} {
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

/**
 * The phone's Bluetooth address for the A2DP capture: FNAF_BT_MAC, else the local profile's `btMac`. Throws
 * ProfileUnset with how to set it; a committed default would publish the handset's address, as a serial would.
 */
export function resolveBtMac({ env = process.env, root = ROOT } = {}): {mac: string, source: string} {
  const value = env.FNAF_BT_MAC;
  if (value !== undefined && value !== '') {
    if (!BT_MAC.test(value)) throw new ProfileUnset(`FNAF_BT_MAC is not a Bluetooth address: ${JSON.stringify(value)}`);
    return { mac: value, source: 'FNAF_BT_MAC' };
  }
  for (const path of profilePaths({ env, root })) {
    if (!existsSync(path)) continue;
    const mac = profileFields(path).btMac;
    if (typeof mac === 'string' && BT_MAC.test(mac)) return { mac, source: path };
    throw new ProfileUnset(`the local profile ${path} holds no Bluetooth address; ${BT_MAC_HOW_TO}`);
  }
  throw new ProfileUnset(`no Bluetooth address: ${BT_MAC_HOW_TO}`);
}

/** The profile's fields, or none when it is missing or not this schema. */
function profileFields(path: string): Record<string, unknown> {
  try {
    const profile: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(profile) && profile.schema === PROFILE_SCHEMA ? profile : {};
  } catch { return {}; }
}

/** The path this host's checkouts write the profile to. */
function writablePath({ env = process.env, root = ROOT } = {}) {
  return env.FNAF_LOCAL_PROFILE ? resolve(env.FNAF_LOCAL_PROFILE) : join(mainCheckout(root), PROFILE_PATH);
}

/** Merge `fields` into the profile where this host's checkouts read it, keeping what it already holds. */
function mergeProfile(fields: Record<string, string>, options: { env?: NodeJS.ProcessEnv, root?: string } = {}) {
  const path = writablePath(options);
  mkdirSync(dirname(path), { recursive: true });
  const profile = { ...profileFields(path), schema: PROFILE_SCHEMA, ...fields };
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/** Write the serial into the profile where this host's checkouts read it. */
export function writeProfile(serial: unknown, options: { env?: NodeJS.ProcessEnv, root?: string } = {}) {
  if (!SERIAL_TOKEN.test(String(serial ?? ''))) throw new SerialUnset(`not a device serial token: ${JSON.stringify(serial)}`);
  return mergeProfile({ serial: String(serial) }, options);
}

/** Write the phone's Bluetooth address into the profile. */
export function writeBtMac(mac: unknown, options: { env?: NodeJS.ProcessEnv, root?: string } = {}) {
  if (!BT_MAC.test(String(mac ?? ''))) throw new ProfileUnset(`not a Bluetooth address: ${JSON.stringify(mac)}`);
  return mergeProfile({ btMac: String(mac) }, options);
}

function main(argv: readonly string[]) {
  const [verb, value] = argv;
  try {
    if (verb === 'serial' && argv.length === 1) { process.stdout.write(`${resolveSerial().serial}\n`); return 0; }
    if (verb === 'set' && argv.length === 2) { console.log(`local-profile: wrote ${writeProfile(value)}`); return 0; }
    if (verb === 'path' && argv.length === 1) { console.log(profilePaths().find(existsSync) ?? profilePaths()[0]); return 0; }
    if (verb === 'bt-mac' && argv.length === 1) { process.stdout.write(`${resolveBtMac().mac}\n`); return 0; }
    if (verb === 'set-bt-mac' && argv.length === 2) { console.log(`local-profile: wrote ${writeBtMac(value)}`); return 0; }
  } catch (error) {
    if (!(error instanceof ProfileUnset)) throw error;
    console.error(`local-profile: ${error.message}`);
    return 2;
  }
  console.error('usage: local-profile.ts serial | set SERIAL | path | bt-mac | set-bt-mac MAC');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
