#!/usr/bin/env node
/** CLI composition root for the campaign executor: nothing here touches a phone without --live --confirm-live. */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AdbDeviceBridge } from '@sixam/play/campaign/adb-bridge';
import { CampaignStateMachine, DEFAULT_CAMPAIGN_NIGHTS, makeCampaignSpec } from '@sixam/play/campaign/campaign';
import { type CampaignPorts, DeviceCampaignRunner } from '@sixam/play/campaign/campaign-runner';
import { guidedCalibrationSteps, validateCustomNightCalibration } from '@sixam/play/campaign/custom-night';
import { evaluateCampaignPreflight } from '@sixam/play/campaign/campaign-preflight';
import { validateCampaignBundle } from '@sixam/play/campaign/campaign-bundle';
import { AdbCompanionPort } from '@sixam/play/campaign/physical-ports';
import { installCampaignSignalHandlers } from '@sixam/play/campaign/campaign-signal';
import { bindVenueFromPreflight, dryRunVenue, loadVenueBindings, renderVenueCheck } from '@sixam/play/campaign/venue';
import { fitClockMap, CompanionControlTransport } from '@sixam/play';
import { resolveDeviceProfile } from '@sixam/source';
import { isOneOf, isRecord } from '@sixam/kernel';
import { stableHash } from '@sixam/kernel/contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROFILES = join(ROOT, 'packages/play/profiles/fnaf2/moto-g56');

function help() {
  console.log(`fnaf2-device — the campaign executor's command line (night-run.sh drives it)

Usage:
  npm run device:campaign -- --bundle DIR --nights N --profile hid-mediaprojection   (dry run)
  npm run device:campaign -- --bundle DIR --nights N --profile hid-mediaprojection --live --confirm-live
  npm run device:preflight -- --profile hid-mediaprojection [--qualification FILE] [--venue-binding FILE]
  npm run device:preflight -- --profile hid-mediaprojection --bind-venue FILE --by NAME
  npm run device:campaign -- --guided
  npm run device:clockmap -- --count 12 --span-ms 30000 --out FILE

Commands:
  campaign      validate the campaign chain, bundle and proof gates; with --live --confirm-live, play it
  preflight     inspect one ADB phone without sending game input
  clockmap      measure device->host monotonic clock anchors (read-only, no game input)
  grade RUN_ID  show a retained result

Options:
  --profile ID  resolved profile under packages/play/profiles/fnaf2/moto-g56
  --serial ID   select one explicit ADB device
  --nights 1-7  campaign target nights, one ascending chain (default: 1,2,3,4,5,6,7)
  --max-attempts N  campaign attempts per target (default: 3)
  --json        print machine-readable output for preflight/campaign
  --guided      print the one-time Custom Night calibration checklist
  --calibration FILE  measured Custom Night calibration artifact
  --bundle DIR  validated device bundle containing the requested plans
  --forbid-mechanic ID  campaign only: refuse, before any phone is opened, a bundle whose strategy
                requires this mechanic (fnaf2.camera-split); repeatable. The bundle's own
                forbidden mechanics apply too, and the spec and its first event carry them
  --qualification FILE  DEVICE_MEASURED qualification artifact (a qualification-v2 also binds its venue)
  --venue-binding FILE  venue-binding-v1 naming this profile or winner; repeatable. Preflight
                refuses when the observed venue identity drifted from any binding, and a live
                campaign refuses when neither this nor a qualification-v2 binds the venue
  --bind-venue FILE  preflight only: write a venue-binding-v1 for --profile over the identity
                this preflight read (refused on drift, on an unread field or on another build)
  --by NAME     who binds the venue (required with --bind-venue)
  --ports MODULE  explicit campaign-port composition module
  --machine-only  run an explicit MODEL_ONLY machine-input experiment; no claim promotion
  --arm-observe-once  run the double-camera check once without blocking the schedule; abort only on a definite mismatch
  --allow-save-reset  authorize the measured New Game confirmation for a fresh story chain
  --night-anchor-aim-ms N  release the night schedule at the helper's latched onset + N ms (mod 1000)
  --night-anchor-max-k K  refuse (release unanchored) when the aim needs more than K whole periods past the onset
  --night-anchor-period-ms P  the game timer period the aim is a phase of (default 1000; Night 6's Foxy roll grid is 5000)
  --night-anchor-strict  refuse (abort the attempt) instead of releasing unanchored when the aim cannot be met
  --night-anchor-authorize-on-latch  release on the helper's latched onset alone once the aim is past its hold
  --teach-overlay  narrate the schedule on the Companion's teach panel for a person watching (needs an anchor)
  --no-helper   preflight without requiring Companion
  --no-hid      preflight without requiring /system/bin/hid
  --live        explicitly enable physical actuation
  --confirm-live  acknowledge the bounded live-device safety gate
  --count N     clockmap anchor count (default: 12)
  --span-ms MS  clockmap measurement span (default: 30000)
  --source WHO  clockmap device domain: uptime (/proc/uptime boottime) or helper (System.nanoTime capture domain)
  --out FILE    retain the clock-map-v1 artifact at this path`);
}

/** The commands. Only `campaign` touches a phone; tools/architecture-test.ts reads this list. */
const COMMANDS = ['help', 'grade', 'preflight', 'campaign', 'clockmap'] as const;
/** Every option; a value-taking one reads `--name VALUE` and `--name=VALUE`. */
const FLAGS = {
  help: { type: 'boolean', short: 'h' }, 'dry-run': { type: 'boolean' }, live: { type: 'boolean' }, 'confirm-live': { type: 'boolean' },
  json: { type: 'boolean' }, guided: { type: 'boolean' }, 'machine-only': { type: 'boolean' },
  'arm-observe-once': { type: 'boolean' }, 'arm-none': { type: 'boolean' }, 'night7-dials': { type: 'string' },
  'allow-save-reset': { type: 'boolean' }, 'night-anchor-aim-ms': { type: 'string' }, 'night-anchor-max-k': { type: 'string' },
  'night-anchor-period-ms': { type: 'string' }, 'night-anchor-strict': { type: 'boolean' },
  'night-anchor-authorize-on-latch': { type: 'boolean' }, 'teach-overlay': { type: 'boolean' },
  'no-helper': { type: 'boolean' }, 'no-hid': { type: 'boolean' }, serial: { type: 'string' }, nights: { type: 'string' },
  'max-attempts': { type: 'string' }, 'story-start': { type: 'string' }, 'save-cursor': { type: 'string' },
  profile: { type: 'string' }, calibration: { type: 'string' }, bundle: { type: 'string' }, qualification: { type: 'string' },
  'venue-binding': { type: 'string', multiple: true }, 'forbid-mechanic': { type: 'string', multiple: true },
  'bind-venue': { type: 'string' }, by: { type: 'string' }, count: { type: 'string' }, 'span-ms': { type: 'string' },
  source: { type: 'string' }, out: { type: 'string' }, ports: { type: 'string' },
} as const;

/** The command line, as parse() reads it. */
interface Options {
  command: (typeof COMMANDS)[number], run: string | undefined, profile: string, live: boolean, confirmLive: boolean, json: boolean, serial: string | undefined, nights: number[],
  maxAttempts: number, storyStart: string | undefined, saveCursor: number | undefined, requireHelper: boolean, requireHid: boolean,
  guided: boolean, machineOnly: boolean, armMode: 'blocking' | 'observe-once' | 'none', allowSaveReset: boolean,
  nightAnchorAimMs: number | null, nightAnchorMaxK: number | null, nightAnchorPeriodMs: number, nightAnchorStrict: boolean,
  nightAnchorAuthorizeOnLatch: boolean, teachOverlay: boolean, calibration: string | undefined, bundle: string | undefined,
  qualification: string | undefined, venueBindings: string[], bindVenue: string | undefined, by: string | undefined,
  ports: string | undefined, forbidMechanics: string[], count: number, spanMs: number, out: string | undefined, source: string,
  night7Dials?: unknown,
}

function parse(argv: string[]): Options {
  const [first = 'help'] = argv;
  // The fixture dry-run that used to be the default left with the service path
  // on 2026-09-25; options without a command are refused rather than guessed.
  if (first.startsWith('-') && first !== '--help' && first !== '-h') throw new Error(`a command is required before ${first}; see --help`);
  const { values, positionals } = parseArgs({ args: argv, options: FLAGS, allowPositionals: true, strict: true });
  const [named = 'help', ...rest] = positionals;
  if (!isOneOf(COMMANDS, named)) throw new Error(`unknown command: ${named}`);
  const command = values.help ? 'help' : named;
  if (rest.length > (command === 'grade' ? 1 : 0)) throw new Error(`${command} takes no argument ${rest.join(' ')}`);
  const text = (name: keyof typeof FLAGS, value: string | undefined) => {
    if (value === '') throw new Error(`--${name} requires a value`);
    return value;
  };
  const number = (value: string | undefined, absent: number) => (value === undefined ? absent : Number(value));
  let night7Dials: unknown;
  if (values['night7-dials'] !== undefined) {
    try { night7Dials = JSON.parse(values['night7-dials']); } catch { throw new Error('--night7-dials must be valid JSON'); }
  }
  const options: Options = { command, run: rest[0], profile: values.profile ?? 'hid-mediaprojection',
    // Dry unless --live, and --dry-run wins over it wherever it stands.
    live: values.live === true && values['dry-run'] !== true, confirmLive: values['confirm-live'] === true,
    json: values.json === true, serial: values.serial,
    nights: values.nights === undefined ? [...DEFAULT_CAMPAIGN_NIGHTS] : values.nights.split(',').map(Number),
    maxAttempts: number(values['max-attempts'], 3), storyStart: values['story-start'],
    saveCursor: values['save-cursor'] === undefined ? undefined : Number(values['save-cursor']),
    requireHelper: values['no-helper'] !== true, requireHid: values['no-hid'] !== true,
    guided: values.guided === true, machineOnly: values['machine-only'] === true,
    armMode: values['arm-none'] ? 'none' : values['arm-observe-once'] ? 'observe-once' : 'blocking',
    allowSaveReset: values['allow-save-reset'] === true,
    nightAnchorAimMs: values['night-anchor-aim-ms'] === undefined ? null : Number(values['night-anchor-aim-ms']),
    nightAnchorMaxK: values['night-anchor-max-k'] === undefined ? null : Number(values['night-anchor-max-k']),
    nightAnchorPeriodMs: number(values['night-anchor-period-ms'], 1000), nightAnchorStrict: values['night-anchor-strict'] === true,
    nightAnchorAuthorizeOnLatch: values['night-anchor-authorize-on-latch'] === true, teachOverlay: values['teach-overlay'] === true,
    calibration: values.calibration, bundle: values.bundle, qualification: values.qualification,
    venueBindings: values['venue-binding'] ?? [], bindVenue: text('bind-venue', values['bind-venue']), by: text('by', values.by),
    ports: values.ports, forbidMechanics: values['forbid-mechanic'] ?? [], count: number(values.count, 12),
    spanMs: number(values['span-ms'], 30000), out: text('out', values.out), source: values.source ?? 'uptime',
    ...(night7Dials === undefined ? {} : { night7Dials }) };
  // Refused before any phone is queried: a binding names who made it.
  if (options.bindVenue !== undefined && options.command !== 'preflight')
    throw new Error('--bind-venue belongs to preflight');
  if (options.bindVenue !== undefined && options.by === undefined)
    throw new Error('--bind-venue requires --by NAME, who binds the venue');
  if (options.forbidMechanics.length && options.command !== 'campaign')
    throw new Error('--forbid-mechanic belongs to campaign');
  return options;
}

// A stored device-profile-v1, resolved against its game's control catalog: the
// game is the package half of targetBuild, and the control map may name only
// that game's controls, cameras and points. The object is returned unchanged,
// because its bytes are hashed into every bundle bound to it.
async function profile(id: string) {
  try { return resolveDeviceProfile(JSON.parse(await readFile(join(PROFILES, `${id}.json`), 'utf8'))); }
  catch (error) { throw new Error(`profile ${id} is not available: ${(error as Error).message}`); }
}

async function jsonFile(path: string | undefined, label: string): Promise<unknown> {
  if (!path) return null;
  try { return JSON.parse(await readFile(resolve(path), 'utf8')); }
  catch (error) { throw new Error(`${label} is not readable: ${(error as Error).message}`); }
}

type Bundle = typeof import('../../../packages/propose/bin/plans/bundle.ts');
type Ports = Partial<CampaignPorts> & { readonly deviceLocal?: boolean };
/** What a ports module's factory returns: a composition holding its ports (createCampaignPorts), or the ports themselves. */
type Composition = Ports & { readonly ports?: Ports, readonly evidenceDirectory?: string };

async function campaignBundle(path: string | undefined, spec: ReturnType<typeof makeCampaignSpec>, profileId: string) {
  if (!path) return null;
  const { validateBundle }: Bundle = await import(pathToFileURL(join(ROOT, 'packages/propose/bin/plans/bundle.ts')).href);
  const validated = validateBundle(resolve(path));
  if (!validated.compiled) throw new Error('campaign bundle has no compiled artifact');
  if (validated.profile.id !== profileId) throw new Error(`campaign bundle profile ${validated.profile.id} does not match ${profileId}`);
  const requested = new Set(spec.nights.map(target => target.night));
  const plans = validated.compiled.filter(plan => requested.has(plan.night));
  const campaign = validateCampaignBundle({ spec, plans });
  const selectedPlans = validated.plans.filter(plan => requested.has(plan.night));
  const selectedWinner = validated.winner;
  const planOptions = isRecord(selectedWinner.planOptions) ? selectedWinner.planOptions : undefined;
  return { ...campaign, artifact: { winnerHash: validated.manifest.winnerHash,
    engineHash: validated.manifest.engineHash, profileHash: validated.manifest.profile.sha256 },
    // Host-only handoff metadata for the explicit machine experiment. The
    // executor still receives only the validated compiled request plus the
    // exact emitted plan bytes, never loose strategy knobs.
    planTexts: Object.fromEntries(selectedPlans.map(plan => [plan.night, plan.text])),
    planHashes: Object.fromEntries(selectedPlans.map(plan => [plan.night, plan.sha256])),
    machine: { claimLevel: selectedWinner.gate.claimLevel,
      pilotOffsetMs: selectedWinner.knobs?.pilotOffset ?? 10,
      deviceSpacingMs: planOptions?.deviceSpacingMs ?? null,
      contactMs: planOptions?.sweepContactMs ?? null,
      tapContactMs: planOptions?.tapContactMs ?? null },
    bundleDirectory: resolve(path) };
}

/**
 * The bundle's timing per night, and the mechanics the run carries: what its
 * strategy requires and what its build and this run forbid, refused here,
 * before any phone is opened, when they meet (Pedro, 2026-09-30).
 */
async function campaignTiming(path: string | undefined, nights: number[], forbid: string[] = []) {
  if (!path) {
    if (forbid.length) throw new Error('--forbid-mechanic needs the --bundle it constrains');
    return { timingByNight: {}, mechanics: undefined };
  }
  const { runMechanics, validateBundle }: Bundle = await import(pathToFileURL(join(ROOT, 'packages/propose/bin/plans/bundle.ts')).href);
  const validated = validateBundle(resolve(path));
  if (!validated.compiled) throw new Error('campaign bundle has no compiled artifact');
  const requested = new Set(nights);
  return { timingByNight: Object.fromEntries(validated.compiled
    .filter(plan => requested.has(plan.night))
    .map(plan => [String(plan.night), plan.timing])),
  mechanics: runMechanics(validated.manifest, forbid) };
}

/** A resolved device profile, as profile() returns it. */
type Profile = Awaited<ReturnType<typeof profile>>;

/** Measure device->host monotonic clock anchors and fit a clock-map-v1 (read-only, no game input). */
async function clockmap(options: Options) {
  if (options.live) throw new Error('clockmap is a read-only measurement; --live does not apply');
  if (!['uptime', 'helper'].includes(options.source))
    throw new Error('--source must be uptime (device boottime via /proc/uptime) or helper (System.nanoTime, the capture domain)');
  if (!Number.isInteger(options.count) || options.count < 4 || options.count > 64) throw new Error('--count must be 4..64');
  if (!Number.isInteger(options.spanMs) || options.spanMs < 10000 || options.spanMs > 600000)
    throw new Error('--span-ms must be 10000..600000');
  const hostBoot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(hostBoot))
    throw new Error('host boot identity is unavailable; refusing to fabricate a clock session');
  const bridge = new AdbDeviceBridge({ serial: options.serial });
  let helperTransport = null as CompanionControlTransport | null;
  if (options.source === 'helper') {
    const selected = await bridge.selectDevice();
    if (selected.status !== 'READY') throw new Error(`clockmap needs one ready device: ${selected.reason ?? 'unavailable'}`);
    const port = new AdbCompanionPort({ serial: selected.serial });
    const endpoint = port.discover();
    helperTransport = new CompanionControlTransport({ request: line => port.request(line), token: endpoint.token });
  }
  const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
  const samples: {bootId: string, quantizationMs: number, sourceMs: number, targetBeforeMs: number, targetAfterMs: number}[] = [];
  for (let index = 0; index < options.count; index += 1) {
    if (index) await sleep(Math.floor(options.spanMs / (options.count - 1)));
    if (options.source === 'helper') {
      const targetBeforeMs = Number(process.hrtime.bigint()) / 1e6;
      // Built above whenever the source is the helper.
      const fields = (helperTransport as CompanionControlTransport).snapshot();
      const targetAfterMs = Number(process.hrtime.bigint()) / 1e6;
      if (!/^\d+$/.test(fields.snapshotNs ?? '')) throw new Error('helper snapshot has no monotonic timestamp');
      const identity = await bridge.uptimeSample();
      if (identity.status !== 'READY') throw new Error(`boot identity is unavailable: ${identity.reason ?? 'unavailable'}`);
      samples.push({ bootId: identity.bootId, quantizationMs: 1,
        sourceMs: Number(BigInt(fields.snapshotNs) / 1000000n), targetBeforeMs, targetAfterMs });
      continue;
    }
    const sample = await bridge.uptimeSample();
    if (sample.status !== 'READY') throw new Error(`clockmap anchor ${index} is ${sample.status}: ${sample.reason ?? 'unavailable'}`);
    samples.push({ bootId: sample.bootId, quantizationMs: sample.quantizationMs,
      sourceMs: sample.sourceMs, targetBeforeMs: sample.targetBeforeMs, targetAfterMs: sample.targetAfterMs });
  }
  if (samples.some(sample => sample.bootId !== samples[0].bootId))
    throw new Error('device rebooted during sampling; the clock session changed');
  const anchors = samples.map(sample => ({ sourceMs: sample.sourceMs,
    targetBeforeMs: sample.targetBeforeMs, targetAfterMs: sample.targetAfterMs }));
  const quantizationMs = Math.max(...samples.map(sample => sample.quantizationMs));
  // The session name carries the measured domain: helper GET stamps
  // System.nanoTime (suspend-excluding), /proc/uptime is boottime
  // (suspend-including). The two drift apart across device suspends, so a
  // capture composition must stamp the matching convention.
  const sourceSession = `${samples[0].bootId}#${options.source === 'helper' ? 'monotonic' : 'boottime'}`;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = stableHash({ anchors, sourceSession, hostBoot,
    spanMs: options.spanMs, count: options.count }).slice(6, 12);
  const id = `clockmap-${stamp}-${samples[0].bootId.slice(0, 8)}-${suffix}`;
  const artifact = fitClockMap({ samples: anchors,
    sourceClock: 'device-monotonic-ms', targetClock: 'host-monotonic-ms',
    sourceSession, targetSession: hostBoot,
    id, evidenceId: id, sourceUncertaintyMs: quantizationMs + (options.source === 'helper' ? 0 : 1) });
  const { mapClockInterval } = await import('@sixam/play');
  const check = anchors[anchors.length - 2];
  const mapped = mapClockInterval({ clock: 'device-monotonic-ms', value: check.sourceMs }, {
    targetClock: 'host-monotonic-ms', targetSession: hostBoot, sourceSession,
    uncertaintyMs: quantizationMs, mapping: artifact });
  // Self-check: the conservative interval must still bracket the observed
  // host bracket of an interior anchor it was fitted from. The final anchor
  // sits on the validity edge by construction and cannot carry uncertainty.
  if (mapped.latestMs < check.targetBeforeMs || mapped.earliestMs > check.targetAfterMs)
    throw new Error('fitted map does not bracket its own anchors; refusing to retain it');
  if (options.out) await writeFile(resolve(options.out), JSON.stringify(artifact, null, 2) + '\n');
  console.log(options.json ? JSON.stringify(artifact, null, 2) :
    `clockmap READY rate=${artifact.rate.toFixed(6)} errorMs=${artifact.errorMs} ` +
    `rateErrorPpm=${artifact.rateErrorPpm} span=${artifact.spanMs}ms anchors=${artifact.sampleCount} ` +
    `source=${artifact.sourceSession.replace(/^[0-9a-f-]+#/, '')} evidence=${artifact.evidenceId}` +
    (options.out ? ` out=${resolve(options.out)}` : ''));
}

/** Inspect one ADB phone without sending game input, and bind its venue when asked. */
async function preflight(options: Options, selected: Profile) {
  const venueBindings = await loadVenueBindings({ profileId: selected.id,
    qualification: await jsonFile(options.qualification, 'qualification'), paths: options.venueBindings });
  const bridge = new AdbDeviceBridge({ serial: options.serial });
  const result = await bridge.preflight({ targetBuild: selected.targetBuild,
    requireHelper: options.requireHelper, requireHid: options.requireHid,
    restartCapture: true, venueBindings, profileId: selected.id });
  console.log(options.json ? JSON.stringify(result, null, 2) :
    `${result.status} ${result.serial ?? ''} ${result.reason ?? ''}\n` +
    result.checks.map(item => `  ${item.status.padEnd(7)} ${item.id}: ${typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail)}`).join('\n') +
    `\n${renderVenueCheck(result.venue)}`);
  if (options.bindVenue) {
    // parse() refuses --bind-venue without --by.
    const binding = bindVenueFromPreflight({ preflight: result, profileId: selected.id, boundBy: options.by as string,
      boundAt: new Date().toISOString().slice(0, 10) });
    const path = resolve(options.bindVenue);
    await writeFile(path, JSON.stringify(binding, null, 2) + '\n');
    console.error(`venue binding ${binding.evidenceId} written to ${path}; pass --venue-binding ${path} to a live campaign`);
  }
  if (result.status === 'FAIL') process.exitCode = 1;
}

/** Validate the campaign chain, bundle and proof gates; with --live --confirm-live, play it. */
async function campaign(options: Options, selected: Profile) {
  if (!options.nights.every(Number.isInteger) || options.nights.length < 1 || options.nights.length > 7 ||
      options.nights.some(night => night < 1 || night > 7) || new Set(options.nights).size !== options.nights.length)
    throw new Error('--nights must be a unique set of nights in 1..7');
  const { timingByNight, mechanics } = await campaignTiming(options.bundle, options.nights, options.forbidMechanics);
  const spec = makeCampaignSpec({ profile: selected.id, targetBuild: selected.targetBuild,
    timingByNight, nights: options.nights, maxAttempts: options.maxAttempts, storyStart: options.storyStart,
    storySaveCursor: options.saveCursor, ...(mechanics === undefined ? {} : { mechanics }),
    ...(options.night7Dials ? { night7Dials: options.night7Dials } : {}) });
  const machine = new CampaignStateMachine({ spec });
  const calibration = await jsonFile(options.calibration, 'calibration');
  if (calibration) validateCustomNightCalibration(calibration, { targetBuild: selected.targetBuild });
  if (options.guided) {
    const output = { schema: 'device-campaign-guidance-v1', version: 1, status: 'GUIDED',
      targetBuild: selected.targetBuild, steps: guidedCalibrationSteps({ targetBuild: selected.targetBuild }) };
    console.log(options.json ? JSON.stringify(output, null, 2) : output.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'));
    return;
  }
  if (!options.live) {
    const bundle = await campaignBundle(options.bundle, spec, selected.id);
    // Host files only: what a live run would bind the venue to, and what the dry run could not check.
    const venue = dryRunVenue({ profileId: selected.id, bindings: await loadVenueBindings({ profileId: selected.id,
      winnerHash: bundle?.artifact?.winnerHash ?? null, qualification: await jsonFile(options.qualification, 'qualification'),
      paths: options.venueBindings }) });
    const output = { status: 'READY', mode: 'dry-run', spec, state: machine.snapshot(), bundle, venue,
      note: 'configuration and proof gates validated; no phone or input transport opened',
      next: 'run this command with --live --confirm-live after the guided calibration and qualification gates pass' };
    console.log(options.json ? JSON.stringify(output, null, 2) :
      `campaign READY (dry-run): ${spec.nights.map(entry => `Night ${entry.night} ${entry.mode}`).join(' -> ')}\n` +
      'proof gates: positive 6 AM plus save/menu advancement; retries: 3\n' +
      `venue ${venue.status} (${venue.reason}): ${venue.live}`);
    return;
  }
  if (!options.confirmLive) throw new Error('live campaign requires --confirm-live');
  // The bundle and qualification are host files; they are read before the
  // phone is queried so the preflight can compare the venue they bind.
  const bundle = await campaignBundle(options.bundle, spec, selected.id);
  const qualification = await jsonFile(options.qualification, 'qualification');
  const venueBindings = await loadVenueBindings({ profileId: selected.id,
    winnerHash: bundle?.artifact?.winnerHash ?? null, qualification, paths: options.venueBindings });
  const bridge = new AdbDeviceBridge({ serial: options.serial });
  machine.startPreflight();
  const device = await bridge.preflight({ targetBuild: selected.targetBuild,
    requireHelper: options.requireHelper, requireHid: options.requireHid,
    restartCapture: true, venueBindings, requireVenueBinding: true, profileId: selected.id });
  machine.acceptPreflight(device);
  let composition = null as Composition | null;
  const useDefaultModernPorts = bundle && selected.actuator === 'hid-multi' && selected.visualSensor === 'mediaprojection';
  if (options.ports || useDefaultModernPorts) {
    const modulePath = options.ports
      ? resolve(options.ports)
      : join(ROOT, 'packages/play/src/campaign/modern-campaign-ports.ts');
    const module: { createCampaignPorts?: unknown, default?: unknown } = await import(pathToFileURL(modulePath).href);
    const factory = module.createCampaignPorts ?? module.default;
    if (typeof factory !== 'function') throw new Error('ports module must export createCampaignPorts()');
    composition = await (factory as (options: object) => Promise<Composition> | Composition)({ spec, bundle, profile: selected, calibration, calibrationPath: options.calibration ?? null, qualification,
      serial: device.serial, machineOnly: options.machineOnly,
      armMode: options.armMode === 'none' ? undefined : options.armMode,
      allowSaveReset: options.allowSaveReset, captureRestarted: true,
      nightAnchorAimMs: options.nightAnchorAimMs, nightAnchorMaxK: options.nightAnchorMaxK,
      nightAnchorPeriodMs: options.nightAnchorPeriodMs, nightAnchorStrict: options.nightAnchorStrict,
      nightAnchorAuthorizeOnLatch: options.nightAnchorAuthorizeOnLatch,
      teachOverlay: options.teachOverlay, venueBindings });
  }
  const ports = composition?.ports ?? composition;
  // Once a live composition exists, an operator interrupt must release the
  // HID process before the Node process exits. The modern composition's
  // cleanup also force-stops/restarts the game and verifies the title state.
  const signalHandlers = installCampaignSignalHandlers({
    cleanup: reason => typeof ports?.cleanup === 'function'
      ? ports.cleanup(reason) : ports?.releaseAll?.(),
  });
  const requiredPorts: (keyof CampaignPorts)[] = ['preflight', 'menu', 'intro', 'executeAttempt', 'terminal',
    'terminalVerification', 'save', 'retryReady', 'releaseAll'];
  if (spec.nights.some(target => target.mode === 'custom')) requiredPorts.push('customNight');
  const capabilities = {
    terminal: typeof ports?.terminal === 'function', save: typeof ports?.save === 'function',
    portsReady: requiredPorts.every(name => typeof ports?.[name] === 'function'),
    deviceLocal: composition?.deviceLocal === true || ports?.deviceLocal === true,
  };
  const campaignPreflight = evaluateCampaignPreflight({ spec, device, profile: selected,
    calibration, bundle, qualification, allowSaveReset: options.allowSaveReset,
    machineOnly: options.machineOnly, executor: capabilities });
  // The venue is printed with the gates: a refused campaign retains no
  // result.json, and night-run.sh's campaign.log is then its only record.
  const output = { status: campaignPreflight.status, mode: 'live', preflight: campaignPreflight,
    venue: device.venue ?? null,
    state: machine.snapshot(), reason: campaignPreflight.status === 'READY' ? null : 'campaign-gates-incomplete' };
  console.log(JSON.stringify(output, (key, value) => key === 'token' ? '[REDACTED]' : value, 2));
  try {
    if (campaignPreflight.status === 'FAIL') process.exitCode = 1;
    if (campaignPreflight.status === 'READY') {
      try {
        // READY needs every required port (executor.portsReady), so there are ports.
        const result = await new DeviceCampaignRunner({ spec, ports: ports as Ports }).run();
        const retained = { status: result.state, mode: 'live', result };
        if (composition?.evidenceDirectory)
          await writeFile(join(composition.evidenceDirectory, 'result.json'), JSON.stringify(retained, null, 2));
        console.log(JSON.stringify(retained, null, 2));
        if (result.state !== 'COMPLETE') process.exitCode = 1;
      } catch (error) {
        if (composition?.evidenceDirectory)
          await writeFile(join(composition.evidenceDirectory, 'result.json'), JSON.stringify({
            status: 'ERROR', mode: 'live', error: (error as Error).message,
          }, null, 2));
        throw error;
      }
    }
  } finally {
    signalHandlers.dispose();
    await signalHandlers.done();
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.command === 'help') return help();
  if (options.command === 'grade') {
    if (!options.run) throw new Error('grade requires RUN_ID');
    const path = join('artifacts', options.run, 'result.json');
    if (!existsSync(join(ROOT, path))) throw new Error(`no retained result at ${path}`);
    console.log(await readFile(join(ROOT, path), 'utf8')); return;
  }
  if (options.command === 'clockmap') return clockmap(options);
  const selected = await profile(options.profile);
  if (options.command === 'preflight') return preflight(options, selected);
  if (options.command === 'campaign') return campaign(options, selected);
}

main().catch((error: Error) => { console.error(`device: ${error.message}`); process.exitCode = 2; });
