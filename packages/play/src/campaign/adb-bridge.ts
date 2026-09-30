/**
 * Closed ADB device port for discovery and preflight. The preflight capture
 * restart is explicit; every other operation remains a fixed read-only query.
 *
 * This is deliberately not a generic shell wrapper.  Each operation below is
 * a fixed, reviewable command with bounded output and timeout.  Actuation is
 * still supplied by the qualified device composition; merely seeing a phone
 * here never promotes a claim level.
 *
 * Preflight also records the venue identity (ADR 0002, principle 12): the
 * game's version and its install and update times, the OS build fingerprint
 * and security patch, the Companion version and a hash of the serial, read by
 * four more fixed read-only queries. It is compared with whatever the run is
 * bound to (a qualification-v2, or a venue-binding-v1 naming the profile or
 * winner). Drift refuses. An unbound venue is recorded, and a live run
 * (`requireVenueBinding`) refuses it, because drift cannot be checked against
 * nothing (ADR 0002, decision 1). An inspection records it and says so.
 * The record is `device-preflight-v2` (v1 plus `venue`); readers take both.
 * CONTRACT:device-adb-preflight-v1. CONTRACT:venue-check-v1.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCompanionLogEndpoint } from './physical-ports.ts';
import { restartCompanionCapture as defaultRestartCompanionCapture } from './companion-capture.ts';
import { readVenueIdentity } from '@sixam/play';
import { compareVenueIdentity } from '@sixam/kernel/contracts';

const execFile = promisify(execFileCallback);
const GAME_PACKAGE = 'com.scottgames.fnaf2';
const HELPER_PACKAGE = 'com.ppvaz.fnafcompanion';
const PRELIGHT_SCHEMA = 'device-preflight-v2';
const PRELIGHT_SCHEMAS = Object.freeze(['device-preflight-v1', PRELIGHT_SCHEMA]);
const PRELIGHT_VERSION = 2;
const CLOCK_SAMPLE_SCHEMA = 'device-clock-sample-v1';
const UPTIME_SAMPLE_SCHEMA = 'device-uptime-sample-v1';
const CAPTURE_MAX_BUFFER = 16 * 1024 * 1024;

const check = (id, status, detail) => Object.freeze({ id, status, detail });

export function parseAdbDevices(text) {
  if (typeof text !== 'string') throw new TypeError('adb devices output must be text');
  return text.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).map(line => {
    const [serial, status, ...rest] = line.split(/\s+/);
    return { serial, status, details: rest };
  }).filter(device => device.serial && device.status);
}

function packageBuild(text) {
  const versionName = text.match(/\bversionName=([^\s]+)/)?.[1] ?? null;
  const versionCode = text.match(/\bversionCode=(\d+)\b/)?.[1] ?? null;
  return versionName && versionCode ? `${versionName}+${versionCode}` : null;
}

function expectedBuildSuffix(targetBuild) {
  const match = typeof targetBuild === 'string' && targetBuild.match(/^[^:]+:(.+)$/);
  return match?.[1] ?? targetBuild;
}

function focusHas(text, packageName) {
  return typeof text === 'string' && text.split(/\r?\n/).some(line =>
    /mCurrentFocus=/.test(line) && line.includes(packageName));
}

function awakeAndUnlocked(text) {
  if (typeof text !== 'string') return null;
  if (/mWakefulness=Asleep|mWakefulness=Dozing|mDreamingLockscreen=true|isKeyguardShowing=true|mShowingLockscreen=true/i.test(text)) return false;
  if (/mWakefulness=Awake/i.test(text) && /isKeyguardShowing=false|mInputRestricted=false|keyguardgoingaway=false/i.test(text)) return true;
  return null;
}

// A venue check becomes a preflight check: drift refuses, an unreadable bound
// field holds, and an unbound venue refuses a live run and passes an inspection.
const VENUE_CHECK_STATUS = Object.freeze({ MATCH: 'PASS', DRIFT: 'FAIL', UNKNOWN: 'HOLD' });

/**
 * The command that records a binding from the phone, as a remedy line.
 */
export function unboundVenueRemedy(profileId: string | null) {
  const profile = profileId ?? '<profile>';
  return 'on the phone and game build the qualification was measured on, record the identity with ' +
    `\`npm run device:preflight -- --profile ${profile} --bind-venue FILE --by NAME\` and pass ` +
    '`--venue-binding FILE` to the campaign, or pass a qualification-v2 with `--qualification`';
}

function venueIdentityCheck(venue: any, requireVenueBinding: boolean, profileId: string | null) {
  if (venue.status === 'UNBOUND') {
    const remedy = unboundVenueRemedy(profileId);
    return requireVenueBinding
      ? check('venue-identity', 'FAIL', `${venue.message}; drift is UNKNOWN, so a live run refuses. Remedy: ${remedy}`)
      : check('venue-identity', 'PASS', `${venue.message}; a live run refuses an unbound venue. Remedy: ${remedy}`);
  }
  return check('venue-identity', VENUE_CHECK_STATUS[venue.status],
    venue.remedy ? `${venue.message}. Remedy: ${venue.remedy}` : venue.message);
}

/**
 * The venue a device preflight recorded, or null for a v1 record (which
 * predates it) and for anything that is not a device preflight.
 */
export function preflightVenue(preflight: any) {
  if (!PRELIGHT_SCHEMAS.includes(preflight?.schema)) return null;
  return preflight.schema === 'device-preflight-v1' ? null : (preflight.venue ?? null);
}

function readyStatus(checks) {
  if (checks.some(item => item.status === 'FAIL')) return 'FAIL';
  if (checks.some(item => item.status === 'HOLD' || item.status === 'UNKNOWN')) return 'HOLD';
  return 'READY';
}

export class AdbDeviceBridge {
  declare adb: string;
  declare serial: string;
  declare timeoutMs: number;
  declare maxBuffer: number;
  declare captureRestart: Function;
  declare runPort: Function;
  recordObservation: ((observation: { script: string, png: Buffer, stdout: string, stderr: string, code: number }) => Promise<void>) | undefined;

  constructor({ adb = 'adb', serial, timeoutMs = 10000, maxBuffer = 2 * 1024 * 1024, run,
    captureRestart = defaultRestartCompanionCapture }: {adb?: string, serial?: string, timeoutMs?: number, maxBuffer?: number, run?: Function, captureRestart?: Function} = {}) {
    this.adb = adb; this.serial = serial; this.timeoutMs = timeoutMs; this.maxBuffer = maxBuffer;
    if (typeof captureRestart !== 'function') throw new TypeError('captureRestart must be a function');
    this.captureRestart = captureRestart;
    this.runPort = run ?? (async (args, options: any = {}) => {
      try {
        const result = await execFile(this.adb, args, { encoding: options.encoding === null ? null : (options.encoding ?? 'utf8'),
          timeout: options.timeoutMs ?? this.timeoutMs, maxBuffer: options.maxBuffer ?? this.maxBuffer });
        return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      } catch (error) {
        return { ok: false, code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? '' };
      }
    });
  }

  async #command(args, options = {}) { return this.runPort(args, options); }

  async devices() {
    const result = await this.#command(['devices', '-l']);
    if (!result.ok) return { status: 'HOLD', reason: 'adb-unavailable', detail: result.stderr };
    return { status: 'READY', devices: parseAdbDevices(result.stdout) };
  }

  async selectDevice() {
    const listed = await this.devices();
    if (listed.status !== 'READY') return listed;
    const ready = listed.devices.filter(device => device.status === 'device');
    if (this.serial) {
      const selected = ready.find(device => device.serial === this.serial);
      return selected ? { status: 'READY', serial: selected.serial, device: selected } :
        { status: 'HOLD', reason: 'requested-device-not-ready', serial: this.serial, devices: listed.devices };
    }
    if (ready.length !== 1) return {
      status: 'HOLD', reason: ready.length === 0 ? 'no-ready-device' : 'multiple-ready-devices',
      devices: listed.devices,
    };
    return { status: 'READY', serial: ready[0].serial, device: ready[0] };
  }

  async #shell(serial, args) { return this.#command(['-s', serial, 'shell', ...args]); }

  /**
   * The venue identity through fixed read-only queries. `dump` is the game's
   * `dumpsys package` the build check already read.
   */
  async #venueIdentity(serial: string, targetPackage: string, dump: any, requireHelper: boolean) {
    const fingerprint = await this.#shell(serial, ['getprop', 'ro.build.fingerprint']);
    const securityPatch = await this.#shell(serial, ['getprop', 'ro.build.version.security_patch']);
    const timeZone = await this.#shell(serial, ['getprop', 'persist.sys.timezone']);
    const companion = requireHelper ? await this.#shell(serial, ['dumpsys', 'package', HELPER_PACKAGE]) : null;
    return readVenueIdentity({ packageName: targetPackage, serial, game: dump, fingerprint, securityPatch,
      timeZone, companion, companionPackage: HELPER_PACKAGE });
  }

  /**
   * The venue identity, read as preflight reads it, for the check at a night's
   * terminal (a drift during the run makes it an Invalid run); null when no
   * device is ready to read.
   */
  async venueIdentity({ targetPackage = GAME_PACKAGE, requireHelper = true }: {targetPackage?: string, requireHelper?: boolean} = {}) {
    const selected: any = await this.selectDevice();
    if (selected.status !== 'READY') return null;
    const dump = await this.#shell(selected.serial, ['dumpsys', 'package', targetPackage]);
    return this.#venueIdentity(selected.serial, targetPackage, dump, requireHelper);
  }

  async preflight({ targetPackage = GAME_PACKAGE, targetBuild, requireHelper = true,
    requireHid = true, restartCapture = false, venueBindings = [], requireVenueBinding = false,
    profileId = null }: {targetPackage?: string, targetBuild?: string, requireHelper?: boolean, requireHid?: boolean, restartCapture?: boolean, venueBindings?: {source: string, id: string, identity: any}[], requireVenueBinding?: boolean, profileId?: string | null} = {}) {
    const selected: any = await this.selectDevice();
    if (selected.status !== 'READY') return {
      schema: PRELIGHT_SCHEMA, version: PRELIGHT_VERSION, status: 'HOLD', reason: selected.reason,
      checks: [check('adb-device', selected.status, selected.detail ?? selected.reason)], devices: selected.devices ?? [],
      venue: compareVenueIdentity({ observed: null, bindings: venueBindings }),
    };
    const serial = selected.serial;
    const checks = [check('adb-device', 'PASS', serial)];
    const state = await this.#command(['-s', serial, 'get-state']);
    checks.push(check('device-state', state.ok && state.stdout.trim() === 'device' ? 'PASS' : 'FAIL', state.ok ? state.stdout.trim() : state.stderr.trim()));

    const packagePath = await this.#shell(serial, ['pm', 'path', targetPackage]);
    checks.push(check('target-installed', packagePath.ok && /^\s*package:/.test(packagePath.stdout) ? 'PASS' : 'FAIL', targetPackage));
    const dump = await this.#shell(serial, ['dumpsys', 'package', targetPackage]);
    const installedBuild = packageBuild(dump.stdout);
    const expectedBuild = expectedBuildSuffix(targetBuild);
    checks.push(check('target-build', installedBuild && expectedBuild && installedBuild === expectedBuild ? 'PASS' : 'FAIL', { expected: expectedBuild, installed: installedBuild }));
    const venue = compareVenueIdentity({
      observed: await this.#venueIdentity(serial, targetPackage, dump, requireHelper), bindings: venueBindings });
    checks.push(venueIdentityCheck(venue, requireVenueBinding, profileId));
    const unboundRefused = requireVenueBinding && venue.status === 'UNBOUND';

    const power = await this.#shell(serial, ['dumpsys', 'power']);
    const windows = await this.#shell(serial, ['dumpsys', 'window']);
    const unlocked = awakeAndUnlocked(`${power.stdout}\n${windows.stdout}`);
    checks.push(check('awake-unlocked', unlocked === true ? 'PASS' : unlocked === false ? 'FAIL' : 'HOLD', unlocked === null ? 'state-unreadable' : unlocked));
    checks.push(check('game-focused', focusHas(windows.stdout, targetPackage) ? 'PASS' : 'HOLD', targetPackage));

    const display = await this.#shell(serial, ['wm', 'size']);
    const displayMatch = display.stdout.match(/(?:Physical|Override) size:\s*(\d+)x(\d+)/i);
    const geometry = displayMatch ? `${displayMatch[1]}x${displayMatch[2]}` : null;
    const landscapePair = displayMatch && ((displayMatch[1] === '2400' && displayMatch[2] === '1080') ||
      (displayMatch[1] === '1080' && displayMatch[2] === '2400'));
    checks.push(check('display-geometry', landscapePair ? 'PASS' : 'HOLD',
      geometry ?? (display.ok ? 'size-unreadable' : display.stderr.trim())));

    if (requireHid) {
      const hid = await this.#shell(serial, ['ls', '/system/bin/hid']);
      checks.push(check('hid-transport', hid.ok && /\/system\/bin\/hid/.test(hid.stdout) ? 'PASS' : 'FAIL', hid.ok ? hid.stdout.trim() : hid.stderr.trim()));
    }
    if (requireHelper) {
      if (restartCapture) {
        let restarted;
        try {
          restarted = await this.restartCompanionCapture({ serial, target: 'fnaf2' });
        } catch (error) {
          restarted = { status: 'FAIL', detail: error.message };
        }
        const status = restarted?.status === 'READY' ? 'PASS'
          : restarted?.status === 'HOLD' ? 'HOLD' : 'FAIL';
        checks.push(check('cue-helper-capture-restart', status,
          restarted?.output ?? restarted?.detail ?? 'capture restart returned no detail'));
      }
      const helper = await this.#shell(serial, ['pidof', HELPER_PACKAGE]);
      checks.push(check('cue-helper-running', helper.ok && helper.stdout.trim().length > 0 ? 'PASS' : 'HOLD', helper.ok ? helper.stdout.trim() : helper.stderr.trim()));
      if (helper.ok && helper.stdout.trim().length > 0) {
        const endpoint = await this.#shell(serial, ['logcat', '-d', `--pid=${helper.stdout.trim().split(/\s+/)[0]}`, '-v', 'brief', '-s', 'FnafCueHelper:I', '*:S']);
        try { checks.push(check('cue-helper-endpoint', 'PASS', parseCompanionLogEndpoint(endpoint.stdout))); }
        catch (error) { checks.push(check('cue-helper-endpoint', 'HOLD', error.message)); }
      }
    }
    return { schema: PRELIGHT_SCHEMA, version: PRELIGHT_VERSION, status: readyStatus(checks), serial, checks,
      reason: venue.refuses ? 'venue-identity-drift' : unboundRefused ? 'venue-identity-unbound' : null, venue };
  }

  /**
   * This bridge is the FNaF 2 campaign's (GAME_PACKAGE), so it names FNaF 2
   * explicitly; setup itself has no default game.
   */
  async restartCompanionCapture({ serial = this.serial, target = 'fnaf2', screen = 'menu', waitSeconds = 30 } = {}) {
    return this.captureRestart({ serial, adb: this.adb, target, screen, waitSeconds });
  }

  async capturePng(serial) {
    const result = await this.#command(['-s', serial, 'exec-out', 'screencap', '-p'], {
      encoding: null, timeoutMs: 15000, maxBuffer: CAPTURE_MAX_BUFFER,
    });
    return result.ok && Buffer.isBuffer(result.stdout) ? result.stdout : null;
  }

  /**
   * Return the game to a clean process before a failed attempt can be retried.
   * This is deliberately a closed recovery operation: the package is fixed to
   * the calibrated target and the launcher is resolved by Package Manager,
   * rather than accepting arbitrary shell text from a caller.
   */
  async restartGame({ serial = this.serial } = {}) {
    const stopped = await this.#command(['-s', serial, 'shell', 'am', 'force-stop', GAME_PACKAGE]);
    if (!stopped.ok) return Object.freeze({ status: 'FAIL', stage: 'force-stop', detail: stopped.stderr });
    const resolved = await this.#command(['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', GAME_PACKAGE]);
    const launcher = String(resolved.stdout ?? '').split(/\r?\n/).map(line => line.trim())
      .reverse().find(line => line.startsWith(`${GAME_PACKAGE}/`));
    if (!resolved.ok || !launcher)
      return Object.freeze({ status: 'FAIL', stage: 'resolve-launcher', detail: resolved.stderr || resolved.stdout });
    const started = await this.#command(['-s', serial, 'shell', 'am', 'start', '-n', launcher]);
    return Object.freeze({ status: started.ok ? 'READY' : 'FAIL', stage: 'start', launcher,
      detail: started.ok ? launcher : started.stderr });
  }

  /**
   * Read device wall time through one fixed, read-only command. The midpoint
   * and round-trip bound let callers turn a host-triggered night-start marker
   * into a conservative 16-bit seed window without granting shell access.
   *
   * This does not identify when the game seeded its RNG; it only calibrates
   * the host/device clock relationship. The caller must pair it with a
   * separately recorded start marker.
   */
  async clockSample({ serial = this.serial } = {}) {
    let selectedSerial = serial;
    if (!selectedSerial) {
      const selected: any = await this.selectDevice();
      if (selected.status !== 'READY') return { schema: CLOCK_SAMPLE_SCHEMA, ...selected };
      selectedSerial = selected.serial;
    }
    const beforeEpochMs = Date.now();
    const beforeMonoNs = process.hrtime.bigint();
    const result = await this.#command(
      ['-s', selectedSerial, 'shell', 'date', '+%s%3N'],
      { timeoutMs: Math.min(this.timeoutMs, 5000) });
    const afterMonoNs = process.hrtime.bigint();
    if (!result.ok) return {
      schema: CLOCK_SAMPLE_SCHEMA, status: 'HOLD', serial: selectedSerial,
      reason: 'device-clock-unavailable', detail: result.stderr,
    };
    const text = String(result.stdout).trim();
    if (!/^\d+$/.test(text)) return {
      schema: CLOCK_SAMPLE_SCHEMA, status: 'HOLD', serial: selectedSerial,
      reason: 'device-clock-unparseable', detail: text,
    };
    const roundTripMs = Number(afterMonoNs - beforeMonoNs) / 1e6;
    const hostMidMs = beforeEpochMs + roundTripMs / 2;
    const deviceMs = Number(text);
    const uncertaintyMs = Math.max(1, Math.ceil(roundTripMs / 2) + 1);
    return Object.freeze({
      schema: CLOCK_SAMPLE_SCHEMA, version: 1, status: 'READY', serial: selectedSerial,
      deviceMs, hostBeforeMs: beforeEpochMs, hostMidMs,
      hostAfterMs: beforeEpochMs + roundTripMs, roundTripMs,
      offsetMs: deviceMs - hostMidMs, uncertaintyMs,
      deviceWindow: Object.freeze({
        startMs: Math.max(0, deviceMs - uncertaintyMs),
        endMs: deviceMs + uncertaintyMs,
      }),
    });
  }

  /**
   * One monotonic anchor sample for clock-map-v1 fitting: the device's
   * uptime (the CLOCK_BOOTTIME family the capture helpers stamp with) read
   * through one fixed, read-only command inside a host-monotonic bracket.
   * `/proc/uptime` reports centiseconds, so the source reading carries a
   * ±5 ms quantization on top of the round-trip midpoint bound. The boot id
   * is the source session identity: a reboot changes it and every map built
   * on the previous boot must be refused. No game state is read or written.
   */
  async uptimeSample({ serial = this.serial } = {}) {
    let selectedSerial = serial;
    if (!selectedSerial) {
      const selected: any = await this.selectDevice();
      if (selected.status !== 'READY') return { schema: UPTIME_SAMPLE_SCHEMA, ...selected };
      selectedSerial = selected.serial;
    }
    const beforeMonoMs = Number(process.hrtime.bigint()) / 1e6;
    const result = await this.#command(
      ['-s', selectedSerial, 'shell', 'cat /proc/uptime; cat /proc/sys/kernel/random/boot_id'],
      { timeoutMs: Math.min(this.timeoutMs, 5000) });
    const afterMonoMs = Number(process.hrtime.bigint()) / 1e6;
    if (!result.ok) return {
      schema: UPTIME_SAMPLE_SCHEMA, status: 'HOLD', serial: selectedSerial,
      reason: 'device-uptime-unavailable', detail: result.stderr,
    };
    const [uptimeText, bootText] = String(result.stdout).trim().split(/\r?\n/);
    const uptimeMatch = uptimeText?.match(/^(\d+)\.(\d{2})\s/);
    const bootId = bootText?.match(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)?.[0];
    if (!uptimeMatch || !bootId) return {
      schema: UPTIME_SAMPLE_SCHEMA, status: 'HOLD', serial: selectedSerial,
      reason: 'device-uptime-unparseable', detail: String(result.stdout).trim().slice(0, 200),
    };
    const sourceMs = Number(uptimeMatch[1]) * 1000 + Number(uptimeMatch[2]) * 10;
    return Object.freeze({
      schema: UPTIME_SAMPLE_SCHEMA, version: 1, status: 'READY', serial: selectedSerial,
      bootId, sourceMs, targetBeforeMs: beforeMonoMs, targetAfterMs: afterMonoMs,
      roundTripMs: afterMonoMs - beforeMonoMs, quantizationMs: 5,
    });
  }
}

export const devicePreflightSchema = PRELIGHT_SCHEMA;
export const devicePreflightSchemas = PRELIGHT_SCHEMAS;
export const deviceClockSampleSchema = CLOCK_SAMPLE_SCHEMA;
export const deviceUptimeSampleSchema = UPTIME_SAMPLE_SCHEMA;
