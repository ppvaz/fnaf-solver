#!/usr/bin/env node
// What THIS handset can actually be measured with, as one generated answer.
//
// Every instrument in tools/device depends on something the phone either
// offers or does not, and until now each dependency was rediscovered by hand.
// On 2026-09-11 an agent proposed capturing Android's input-dispatch trace to
// settle why a mask press was lost, wired it in, ran a full night, and only
// then learned the handset advertises `android.inputmethod` and no
// `android.input.inputevent` -- so `inputtrace.py` had no app dispatch source
// to parse and correctly reported NO APP DISPATCH SLICES. The run was not
// wasted, but the question was not answered either, and nothing in the
// repository would have said so in advance.
//
// So this asks the phone once and prints what follows for each instrument:
// what is available, what is not, and which tool is therefore usable. It sends
// no game input and reads no pixels; it is a capability query, not a probe.
//
//   node tools/device/capabilities.mjs [--serial ID] [--json] [--out FILE]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'device-capabilities-v1';

const UNKNOWN = 'UNKNOWN';

const sh = (serial, args, { timeout = 20000 } = {}) => {
  try {
    return execFileSync('adb', [...(serial ? ['-s', serial] : []), ...args],
      { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};

/** Ask the phone the questions the instruments actually depend on. */
export function probe(serial) {
  const prop = name => sh(serial, ['shell', 'getprop', name]) || UNKNOWN;
  const dataSources = (() => {
    const out = sh(serial, ['shell', 'perfetto', '--query'], { timeout: 40000 });
    if (out === null) return null;
    return [...new Set(out.split('\n')
      .map(line => line.trim().split(/\s+/)[0])
      .filter(name => /^(android|linux|track_event)[.a-z_]*$/.test(name)))].sort();
  })();
  const helper = sh(serial, ['shell', 'dumpsys', 'package', 'com.ppvaz.fnafcompanion'])
    ?.split('\n').find(line => line.includes('versionName'))?.trim() ?? null;
  return {
    serial: serial ?? UNKNOWN,
    androidRelease: prop('ro.build.version.release'),
    sdk: prop('ro.build.version.sdk'),
    model: prop('ro.product.model'),
    displayGeometry: (sh(serial, ['shell', 'wm', 'size']) ?? '').replace(/^.*:\s*/, '') || UNKNOWN,
    hidBinary: sh(serial, ['shell', 'ls', '/system/bin/hid']) === '/system/bin/hid',
    screenrecord: sh(serial, ['shell', 'ls', '/system/bin/screenrecord']) === '/system/bin/screenrecord',
    perfettoDataSources: dataSources,
    cueHelper: helper,
    targetInstalled: (sh(serial, ['shell', 'pm', 'list', 'packages', 'com.scottgames.fnaf2']) ?? '')
      .includes('com.scottgames.fnaf2'),
  };
}

// Each entry names an instrument, what it needs from the phone, and how to
// capture its input. A `false` here is the answer that would have saved a run.
const INSTRUMENTS = [
  { tool: 'tools/device/inputtrace.py',
    needs: 'a Perfetto app input-dispatch data source (android.input.inputevent)',
    capture: 'tools/device/atrace-input.sh RUN SECONDS -- COMMAND',
    available: d => (d.perfettoDataSources === null ? null
      : d.perfettoDataSources.includes('android.input.inputevent')),
    ifMissing: 'the trace still records SurfaceFlinger and atrace categories, but there are no app ' +
      'MotionEvent rows to match, and the parser reports NO APP DISPATCH SLICES rather than guessing. ' +
      'Use the Companion native frame trace instead: it is what measured the mask button appearing ' +
      'at ~382.5 ms after monitor-down.' },
  { tool: 'tools/device/actuation-frame-metric.py',
    needs: 'the Companion native frame trace',
    capture: 'tools/device/query-companion.sh trace start LABEL / trace stop ' +
      '(night-run.sh --frame-trace does it around a run)',
    available: d => d.cueHelper !== null,
    ifMissing: 'install/verify the Companion; without it there is no native frame stream to grade.' },
  { tool: 'tools/device/input-frame-align.py',
    needs: 'BOTH a Perfetto trace and the Companion native frame trace',
    capture: 'atrace-input.sh around the run, plus query-companion.sh trace start/stop',
    available: d => (d.perfettoDataSources === null ? null
      : d.perfettoDataSources.includes('android.input.inputevent') && d.cueHelper !== null),
    ifMissing: 'alignment needs dispatch on one side; with no app dispatch source this cannot run here.' },
  { tool: 'tools/device/run-timeline.py, grade-night.py, grade-minus7.py, windpct.py, camtrace.py',
    needs: 'screenrecord',
    capture: 'night-run.sh records at 1280x576 automatically',
    available: d => d.screenrecord, ifMissing: 'no video means no video instrument runs.' },
  { tool: 'apps/device HID execution',
    needs: '/system/bin/hid',
    capture: 'n/a -- the executor opens it directly',
    available: d => d.hidBinary, ifMissing: 'no UHID transport; the device lane cannot actuate.' },
  { tool: 'tools/device/title-observe.py',
    needs: 'TITLE_MODEL in the environment, not just the file on disk',
    capture: 'TITLE_MODEL=tools/device/models/title-moto-g56-v207.json ' +
      'adb exec-out screencap -p | python3 tools/device/title-observe.py',
    available: () => true,
    ifMissing: 'without TITLE_MODEL it prints unknown=no-title-model and exits 3, which reads like a ' +
      'device fault and is not one.' },
];

export function report(device) {
  return {
    schema: SCHEMA,
    recordedAt: new Date().toISOString().slice(0, 10),
    device,
    instruments: INSTRUMENTS.map(entry => ({
      tool: entry.tool, needs: entry.needs, capture: entry.capture,
      available: entry.available(device),
      ...(entry.available(device) === true ? {} : { ifMissing: entry.ifMissing }),
    })),
  };
}

export function render(value) {
  const d = value.device;
  const lines = [`device ${d.model} (${d.serial}) Android ${d.androidRelease} / SDK ${d.sdk}, ` +
    `display ${d.displayGeometry}`];
  lines.push(`  /system/bin/hid ${d.hidBinary ? 'present' : 'ABSENT'}` +
    `   screenrecord ${d.screenrecord ? 'present' : 'ABSENT'}` +
    `   Companion ${d.cueHelper ?? 'ABSENT'}` +
    `   target ${d.targetInstalled ? 'installed' : 'ABSENT'}`);
  lines.push(`  perfetto data sources: ${d.perfettoDataSources
    ? `${d.perfettoDataSources.length} advertised` : 'UNREADABLE'}`);
  if (d.perfettoDataSources)
    for (const name of d.perfettoDataSources.filter(n => n.includes('input')))
      lines.push(`     input-related: ${name}`);
  lines.push('');
  for (const item of value.instruments) {
    const mark = item.available === true ? 'YES ' : item.available === false ? 'NO  ' : '?   ';
    lines.push(`  ${mark} ${item.tool}`);
    lines.push(`         needs:   ${item.needs}`);
    lines.push(`         capture: ${item.capture}`);
    if (item.ifMissing) lines.push(`         if missing: ${item.ifMissing}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = name => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
      ? process.argv[index + 1] : undefined;
  };
  const serial = flag('serial') ?? process.env.FNAF_SERIAL;
  const value = report(probe(serial));
  const out = flag('out');
  if (out) { writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`); process.stdout.write(`wrote ${out}\n`); }
  process.stdout.write(process.argv.includes('--json')
    ? `${JSON.stringify(value, null, 2)}\n` : `${render(value)}\n`);
}
