#!/usr/bin/env node
/** CLI composition root for the campaign executor: nothing here touches a phone without --live --confirm-live. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AdbDeviceBridge } from '@sixam/play/campaign/adb-bridge';
import { CampaignStateMachine, DEFAULT_CAMPAIGN_NIGHTS, makeCampaignSpec } from '@sixam/play/campaign/campaign';
import { DeviceCampaignRunner } from '@sixam/play/campaign/campaign-runner';
import { guidedCalibrationSteps, validateCustomNightCalibration } from '@sixam/play/campaign/custom-night';
import { evaluateCampaignPreflight } from '@sixam/play/campaign/campaign-preflight';
import { validateCampaignBundle } from '@sixam/play/campaign/campaign-bundle';
import { AdbCueHelperPort } from '@sixam/play/campaign/physical-ports';
import { installCampaignSignalHandlers } from '@sixam/play/campaign/campaign-signal';
import { loadVenueBindings, renderVenueCheck } from '@sixam/play/campaign/venue';
import { fitClockMap, CueHelperControlTransport } from '@sixam/play';
import { resolveDeviceProfile } from '@sixam/source';
import { stableHash } from '@sixam/kernel/contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROFILES = join(ROOT, 'apps/device/profiles');

function help() {
  console.log(`fnaf2-device — the campaign executor's command line (night-run.sh drives it)

Usage:
  npm run device:campaign -- --bundle DIR --nights N --profile hid-mediaprojection   (dry run)
  npm run device:campaign -- --bundle DIR --nights N --profile hid-mediaprojection --live --confirm-live
  npm run device:preflight -- --profile hid-mediaprojection [--qualification FILE] [--venue-binding FILE]
  npm run device:campaign -- --guided
  npm run device:clockmap -- --count 12 --span-ms 30000 --out FILE

Commands:
  campaign      validate the campaign chain, bundle and proof gates; with --live --confirm-live, play it
  preflight     inspect one ADB phone without sending game input
  clockmap      measure device->host monotonic clock anchors (read-only, no game input)
  grade RUN_ID  show a retained result

Options:
  --profile ID  resolved profile under apps/device/profiles
  --serial ID   select one explicit ADB device
  --nights 1-7  campaign target nights, one ascending chain (default: 1,2,3,4,5,6,7)
  --max-attempts N  campaign attempts per target (default: 3)
  --json        print machine-readable output for preflight/campaign
  --guided      print the one-time Custom Night calibration checklist
  --calibration FILE  measured Custom Night calibration artifact
  --bundle DIR  validated device bundle containing the requested plans
  --qualification FILE  DEVICE_MEASURED qualification artifact (a qualification-v2 also binds its venue)
  --venue-binding FILE  venue-binding-v1 naming this profile or winner; repeatable. Preflight
                refuses when the observed venue identity drifted from any binding
  --ports MODULE  explicit campaign-port composition module
  --machine-only  run an explicit MODEL_ONLY machine-input experiment; no claim promotion
  --arm-observe-once  run the double-camera check once without blocking the schedule; abort only on a definite mismatch
  --allow-save-reset  authorize the measured New Game confirmation for a fresh story chain
  --night-anchor-aim-ms N  release the night schedule at the helper's latched onset + N ms (mod 1000)
  --night-anchor-max-k K  refuse (release unanchored) when the aim needs more than K whole periods past the onset
  --night-anchor-period-ms P  the game timer period the aim is a phase of (default 1000; Night 6's Foxy roll grid is 5000)
  --night-anchor-strict  refuse (abort the attempt) instead of releasing unanchored when the aim cannot be met
  --night-anchor-authorize-on-latch  release on the helper's latched onset alone once the aim is past its hold
  --teach-overlay  narrate the schedule on the Cue Helper's teach panel for a person watching (needs an anchor)
  --no-helper   preflight without requiring Cue Helper
  --no-hid      preflight without requiring /system/bin/hid
  --live        explicitly enable physical actuation
  --confirm-live  acknowledge the bounded live-device safety gate
  --count N     clockmap anchor count (default: 12)
  --span-ms MS  clockmap measurement span (default: 30000)
  --source WHO  clockmap device domain: uptime (/proc/uptime boottime) or helper (System.nanoTime capture domain)
  --out FILE    retain the clock-map-v1 artifact at this path`);
}

function parse(argv) {
  const [first = 'help', ...tail] = argv;
  const knownCommands = new Set(['help', 'grade', 'preflight', 'campaign', 'clockmap']);
  if (first === '--help' || first === '-h') return { command: 'help', help: true };
  // The fixture dry-run that used to be the default left with the service path
  // on 2026-09-25; options without a command are refused rather than guessed.
  if (first.startsWith('-')) throw new Error(`a command is required before ${first}; see --help`);
  const command = first;
  const rest = tail;
  if (!knownCommands.has(command)) throw new Error(`unknown command: ${first}`);
  const options = { command, profile: 'hid-mediaprojection', live: false, confirmLive: false,
    json: false, serial: undefined, nights: [...DEFAULT_CAMPAIGN_NIGHTS], maxAttempts: 3, storyStart: undefined, saveCursor: undefined,
    requireHelper: true, requireHid: true,
    guided: false, machineOnly: false, armMode: 'blocking', allowSaveReset: false, nightAnchorAimMs: null, nightAnchorMaxK: null, nightAnchorPeriodMs: 1000, nightAnchorStrict: false, nightAnchorAuthorizeOnLatch: false, teachOverlay: false, calibration: undefined, bundle: undefined,
    qualification: undefined, venueBindings: [], ports: undefined, count: 12, spanMs: 30000, out: undefined,
    source: 'uptime' };
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === '--help' || item === '-h') options.command = 'help';
    else if (item === '--dry-run') options.live = false;
    else if (item === '--live') options.live = true;
    else if (item === '--confirm-live') options.confirmLive = true;
    else if (item === '--json') options.json = true;
    else if (item === '--guided') options.guided = true;
    else if (item === '--machine-only') options.machineOnly = true;
    else if (item === '--arm-observe-once') options.armMode = 'observe-once';
    else if (item === '--arm-none') options.armMode = 'none';
    else if (item === '--night7-dials') {
      const raw = rest[++index];
      if (!raw || raw.startsWith('--')) throw new Error('--night7-dials requires a JSON object');
      try { options.night7Dials = JSON.parse(raw); }
      catch { throw new Error('--night7-dials must be valid JSON'); }
    }
    else if (item === '--allow-save-reset') options.allowSaveReset = true;
    else if (item === '--night-anchor-aim-ms') options.nightAnchorAimMs = Number(rest[++index]);
    else if (item === '--night-anchor-max-k') options.nightAnchorMaxK = Number(rest[++index]);
    else if (item === '--night-anchor-period-ms') options.nightAnchorPeriodMs = Number(rest[++index]);
    else if (item === '--night-anchor-strict') options.nightAnchorStrict = true;
    else if (item === '--night-anchor-authorize-on-latch') options.nightAnchorAuthorizeOnLatch = true;
    else if (item === '--teach-overlay') options.teachOverlay = true;
    else if (item === '--no-helper') options.requireHelper = false;
    else if (item === '--no-hid') options.requireHid = false;
    else if (item === '--serial') options.serial = rest[++index];
    else if (item.startsWith('--serial=')) options.serial = item.slice('--serial='.length);
    else if (item === '--nights') options.nights = rest[++index].split(',').map(Number);
    else if (item.startsWith('--nights=')) options.nights = item.slice('--nights='.length).split(',').map(Number);
    else if (item === '--max-attempts') options.maxAttempts = Number(rest[++index]);
    else if (item.startsWith('--max-attempts=')) options.maxAttempts = Number(item.slice('--max-attempts='.length));
    else if (item === '--story-start') options.storyStart = rest[++index];
    else if (item.startsWith('--story-start=')) options.storyStart = item.slice('--story-start='.length);
    else if (item === '--save-cursor') options.saveCursor = Number(rest[++index]);
    else if (item.startsWith('--save-cursor=')) options.saveCursor = Number(item.slice('--save-cursor='.length));
    else if (item === '--profile') options.profile = rest[++index];
    else if (item.startsWith('--profile=')) options.profile = item.slice('--profile='.length);
    else if (item === '--calibration') options.calibration = rest[++index];
    else if (item.startsWith('--calibration=')) options.calibration = item.slice('--calibration='.length);
    else if (item === '--bundle') options.bundle = rest[++index];
    else if (item.startsWith('--bundle=')) options.bundle = item.slice('--bundle='.length);
    else if (item === '--qualification') options.qualification = rest[++index];
    else if (item.startsWith('--qualification=')) options.qualification = item.slice('--qualification='.length);
    else if (item === '--venue-binding') {
      const path = rest[++index];
      if (!path || path.startsWith('--')) throw new Error('--venue-binding requires a file');
      options.venueBindings.push(path);
    }
    else if (item.startsWith('--venue-binding=')) options.venueBindings.push(item.slice('--venue-binding='.length));
    else if (item === '--count') options.count = Number(rest[++index]);
    else if (item.startsWith('--count=')) options.count = Number(item.slice('--count='.length));
    else if (item === '--span-ms') options.spanMs = Number(rest[++index]);
    else if (item.startsWith('--span-ms=')) options.spanMs = Number(item.slice('--span-ms='.length));
    else if (item === '--source') options.source = rest[++index];
    else if (item.startsWith('--source=')) options.source = item.slice('--source='.length);
    else if (item === '--out') {
      options.out = rest[++index];
      if (!options.out || options.out.startsWith('--')) throw new Error('--out requires a file');
    }
    else if (item.startsWith('--out=')) {
      options.out = item.slice('--out='.length);
      if (!options.out) throw new Error('--out requires a file');
    }
    else if (item === '--ports') options.ports = rest[++index];
    else if (item.startsWith('--ports=')) options.ports = item.slice('--ports='.length);
    else throw new Error(`unknown option: ${item}`);
  }
  return options;
}

// A stored device-profile-v1, resolved against its game's control catalog: the
// game is the package half of targetBuild, and the control map may name only
// that game's controls, cameras and points. The object is returned unchanged,
// because its bytes are hashed into every bundle bound to it.
async function profile(id) {
  try { return resolveDeviceProfile(JSON.parse(await readFile(join(PROFILES, `${id}.json`), 'utf8'))); }
  catch (error) { throw new Error(`profile ${id} is not available: ${error.message}`); }
}

async function jsonFile(path, label) {
  if (!path) return null;
  try { return JSON.parse(await readFile(resolve(path), 'utf8')); }
  catch (error) { throw new Error(`${label} is not readable: ${error.message}`); }
}

async function campaignBundle(path, spec, profileId) {
  if (!path) return null;
  const { validateBundle } = await import(pathToFileURL(join(ROOT, 'tools/device/bundle.mjs')).href);
  const validated = validateBundle(resolve(path));
  if (!validated.compiled) throw new Error('campaign bundle has no compiled artifact');
  if (validated.profile.id !== profileId) throw new Error(`campaign bundle profile ${validated.profile.id} does not match ${profileId}`);
  const requested = new Set(spec.nights.map(target => target.night));
  const plans = validated.compiled.filter(plan => requested.has(plan.night));
  const campaign = validateCampaignBundle({ spec, plans });
  const selectedPlans = validated.plans.filter(plan => requested.has(plan.night));
  const selectedWinner = validated.winner;
  return { ...campaign, artifact: { winnerHash: validated.manifest.winnerHash,
    engineHash: validated.manifest.engineHash, profileHash: validated.manifest.profile.sha256 },
    // Host-only handoff metadata for the explicit machine experiment. The
    // executor still receives only the validated compiled request plus the
    // exact emitted plan bytes, never loose strategy knobs.
    planTexts: Object.fromEntries(selectedPlans.map(plan => [plan.night, plan.text])),
    planHashes: Object.fromEntries(selectedPlans.map(plan => [plan.night, plan.sha256])),
    machine: { claimLevel: selectedWinner.gate.claimLevel,
      pilotOffsetMs: selectedWinner.knobs?.pilotOffset ?? 10,
      deviceSpacingMs: selectedWinner.planOptions?.deviceSpacingMs ?? null,
      contactMs: selectedWinner.planOptions?.sweepContactMs ?? null,
      tapContactMs: selectedWinner.planOptions?.tapContactMs ?? null },
    bundleDirectory: resolve(path) };
}

async function campaignTiming(path, nights) {
  if (!path) return {};
  const { validateBundle } = await import(pathToFileURL(join(ROOT, 'tools/device/bundle.mjs')).href);
  const validated = validateBundle(resolve(path));
  if (!validated.compiled) throw new Error('campaign bundle has no compiled artifact');
  const requested = new Set(nights);
  return Object.fromEntries(validated.compiled
    .filter(plan => requested.has(plan.night))
    .map(plan => [String(plan.night), plan.timing]));
}

async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.command === 'help') return help();
  if (options.command === 'grade') {
    const run = argv[1]; if (!run) throw new Error('grade requires RUN_ID');
    console.log(await readFile(join(ROOT, 'artifacts', run, 'result.json'), 'utf8')); return;
  }
  if (options.command === 'clockmap') {
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
    let helperTransport = null;
    if (options.source === 'helper') {
      const selected = await bridge.selectDevice();
      if (selected.status !== 'READY') throw new Error(`clockmap needs one ready device: ${selected.reason ?? 'unavailable'}`);
      const port = new AdbCueHelperPort({ serial: selected.serial });
      const endpoint = port.discover();
      helperTransport = new CueHelperControlTransport({ request: line => port.request(line), token: endpoint.token });
    }
    const sleep = ms => new Promise(done => setTimeout(done, ms));
    /** @type {{bootId: string, quantizationMs: number, sourceMs: number,
     *   targetBeforeMs: number, targetAfterMs: number}[]} */
    const samples = [];
    for (let index = 0; index < options.count; index += 1) {
      if (index) await sleep(Math.floor(options.spanMs / (options.count - 1)));
      if (options.source === 'helper') {
        const targetBeforeMs = Number(process.hrtime.bigint()) / 1e6;
        const fields = /** @type {any} */ (helperTransport.snapshot());
        const targetAfterMs = Number(process.hrtime.bigint()) / 1e6;
        if (!/^\d+$/.test(fields.snapshotNs ?? '')) throw new Error('helper snapshot has no monotonic timestamp');
        const identity = /** @type {any} */ (await bridge.uptimeSample());
        if (identity.status !== 'READY') throw new Error(`boot identity is unavailable: ${identity.reason ?? 'unavailable'}`);
        samples.push({ bootId: identity.bootId, quantizationMs: 1,
          sourceMs: Number(BigInt(fields.snapshotNs) / 1000000n), targetBeforeMs, targetAfterMs });
        continue;
      }
      const sample = /** @type {any} */ (await bridge.uptimeSample());
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
    return;
  }
  const selected = await profile(options.profile);
  if (options.command === 'preflight') {
    const venueBindings = await loadVenueBindings({ profileId: selected.id,
      qualification: await jsonFile(options.qualification, 'qualification'), paths: options.venueBindings });
    const bridge = new AdbDeviceBridge({ serial: options.serial });
    const result = await bridge.preflight({ targetBuild: selected.targetBuild,
      requireHelper: options.requireHelper, requireHid: options.requireHid,
      restartCapture: true, venueBindings });
    console.log(options.json ? JSON.stringify(result, null, 2) :
      `${result.status} ${result.serial ?? ''} ${result.reason ?? ''}\n` +
      result.checks.map(item => `  ${item.status.padEnd(7)} ${item.id}: ${typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail)}`).join('\n') +
      `\n${renderVenueCheck(result.venue)}`);
    if (result.status === 'FAIL') process.exitCode = 1;
    return;
  }
  if (options.command === 'campaign') {
    if (!options.nights.every(Number.isInteger) || options.nights.length < 1 || options.nights.length > 7 ||
        options.nights.some(night => night < 1 || night > 7) || new Set(options.nights).size !== options.nights.length)
      throw new Error('--nights must be a unique set of nights in 1..7');
    const timingByNight = await campaignTiming(options.bundle, options.nights);
    const spec = makeCampaignSpec({ profile: selected.id, targetBuild: selected.targetBuild,
      timingByNight, nights: options.nights, maxAttempts: options.maxAttempts, storyStart: options.storyStart,
      storySaveCursor: options.saveCursor,
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
      const output = { status: 'READY', mode: 'dry-run', spec, state: machine.snapshot(), bundle,
        note: 'configuration and proof gates validated; no phone or input transport opened',
        next: 'run this command with --live --confirm-live after the guided calibration and qualification gates pass' };
      console.log(options.json ? JSON.stringify(output, null, 2) :
        `campaign READY (dry-run): ${spec.nights.map(entry => `Night ${entry.night} ${entry.mode}`).join(' -> ')}\n` +
        'proof gates: positive 6 AM plus save/menu advancement; retries: 3');
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
      restartCapture: true, venueBindings });
    machine.acceptPreflight(device);
    let composition = null;
    const useDefaultModernPorts = bundle && selected.actuator === 'hid-multi' && selected.visualSensor === 'mediaprojection';
    if (options.ports || useDefaultModernPorts) {
      const modulePath = options.ports
        ? resolve(options.ports)
        : join(ROOT, 'packages/play/src/campaign/modern-campaign-ports.js');
      const module = await import(pathToFileURL(modulePath).href);
      const factory = module.createCampaignPorts ?? module.default;
      if (typeof factory !== 'function') throw new Error('ports module must export createCampaignPorts()');
      composition = await factory({ spec, bundle, profile: selected, calibration, calibrationPath: options.calibration ?? null, qualification,
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
    const requiredPorts = ['preflight', 'menu', 'intro', 'executeAttempt', 'terminal',
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
          const result = await new DeviceCampaignRunner({ spec, ports }).run();
          const retained = { status: result.state, mode: 'live', result };
          if (composition?.evidenceDirectory)
            await writeFile(join(composition.evidenceDirectory, 'result.json'), JSON.stringify(retained, null, 2));
          console.log(JSON.stringify(retained, null, 2));
          if (result.state !== 'COMPLETE') process.exitCode = 1;
        } catch (error) {
          if (composition?.evidenceDirectory)
            await writeFile(join(composition.evidenceDirectory, 'result.json'), JSON.stringify({
              status: 'ERROR', mode: 'live', error: error.message,
            }, null, 2));
          throw error;
        }
      }
    } finally {
      signalHandlers.dispose();
      await signalHandlers.done();
    }
    return;
  }
}

main().catch(error => { console.error(`device: ${error.message}`); process.exitCode = 2; });
