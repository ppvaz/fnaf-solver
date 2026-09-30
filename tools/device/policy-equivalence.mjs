// Compiler equivalence gate for policy-v1 (Plan 21 package 5).
//
// The device plan is a deliberately small text format consumed by the phone
// interpreter. This module is its host-side compiler/parser, so a policy can
// be compared to the mocked phone trace before an adb action is allowed.
import { createHash } from 'node:crypto';
import { compilePolicy } from './policy-interpreter.mjs';
import { canonicalPolicy, validatePolicy } from '@sixam/core/control';
import { DEVICE_CONTROL_NAMES } from '@sixam/source';

// The plan text's own short forms, plus the canonical control names taken from
// the vocabulary rather than copied. This set was a hand copy until 2026-09-20
// and it still read `light`/`ventl` after `e8af711` renamed the vocabulary on
// 2026-09-09; nothing noticed until `3efc923` put a `cameraFeedLight` row in
// the opening two days later, and then only this gate saw it -- which is why
// deriving the names beats restating them.
const PLAN_SHORTHAND = ['cam9', 'cam11', 'ventl', 'light', 'hall'];
const ACTIONS = new Set([...DEVICE_CONTROL_NAMES, ...PLAN_SHORTHAND]);
const finite = value => Number.isFinite(value);
const frame = ms => Math.round(ms * 60 / 1000);
// `cam9`/`cam11` are camera shorthands; `cameraFeedLight` is a control whose
// name merely starts with the same three letters. A `startsWith('cam')` test
// turned it into the camera `cam:eraFeedLight`, which is what a prefix match
// does the moment the vocabulary grows a longer name.
const CAMERA_SHORTHAND = /^cam(\d+)$/;
// The simulator's trace calls every flash `light` -- the overloaded
// model-context action the device vocabulary refuses. Both physical lights the
// plan text can name fold into it here, which is the comparison this gate makes
// and not a claim that they are the same control.
const MODEL_LIGHTS = new Set(['ventl', 'cameraFeedLight']);
const planAction = action => action;
const semanticAction = action => CAMERA_SHORTHAND.test(action)
  ? `cam:${CAMERA_SHORTHAND.exec(action)[1]}`
  : MODEL_LIGHTS.has(action) ? 'light' : action;
const cameraName = value => /^cam:(?:[1-9]|1[0-2])$/.test(value ?? '');

function armVerifyCameras(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length < 2 ||
      value.some(camera => !cameraName(camera)) || new Set(value).size !== value.length)
    fail('metadata.armVerifyCameras must contain unique camera names');
  const sorted = [...value].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  return sorted.join(',');
}

function fail(message) { throw new TypeError(`policy equivalence: ${message}`); }

export function policySha256(program) {
  validatePolicy(program);
  return createHash('sha256').update(canonicalPolicy(program)).digest('hex');
}

function rowFor(action, repeat) {
  const at = repeat ? action.offsetMs : action.atMs;
  if (!finite(at) || at < 0) fail(`action ${action.action} has no valid plan time`);
  const mode = action.mode ?? 'tap';
  const contact = action.contactMs ?? 33;
  if (mode === 'camdrop')
    return [at, 'camdrop', action.leadMs, action.durationMs, action.tailMs];
  if (mode === 'hall') return [at, 'hall', action.durationMs];
  if (mode === 'hold') return [at, 'hold', planAction(action.action), action.durationMs];
  if (mode === 'tap') return [at, 'tap', planAction(action.action), contact];
  fail(`unsupported mode ${mode}`);
}

/** Compile the supported policy-v1 phases to the phone's plan text. */
export function compileDevicePlan(program) {
  validatePolicy(program);
  // The device plan text is a static schedule: it has no construct for a
  // decision taken at run time. Refuse rather than silently flatten a branch
  // into one of its arms -- a flattened branch is a different program.
  for (const phase of program.phases) {
    if ((phase.branches ?? []).length)
      fail(`phase ${phase.id} carries observation-conditioned branches; the device plan format cannot express them`);
  }
  const byKind = kind => program.phases.find(phase => phase.kind === kind);
  const idle = byKind('idle');
  const setup = byKind('setup');
  const repeat = byKind('repeat');
  const finish = byKind('finish');
  const observe = byKind('observe');
  if (!setup || !repeat || !finish || !observe) fail('all device phases are required');
  const night = program.metadata.nights[0];
  const lines = [`#policy ${program.metadata.family ?? program.metadata.id}`,
    `#policy-schema ${program.schema}`,
    `#policy-id ${program.metadata.id}`,
    `#policy-sha256 ${policySha256(program)}`,
    `#night ${night}`, `#period ${repeat.periodMs}`,
    `#loop-start ${repeat.startMs}`, `#stop-at ${repeat.endMs}`,
    `#observe-until ${observe.endMs}`];
  if (idle && idle.endMs > 0) lines.push(`#idle-until ${idle.endMs}`);
  if (program.metadata.armVerify) lines.push('#arm-verify 1');
  const verifyCameras = armVerifyCameras(program.metadata.armVerifyCameras);
  if (verifyCameras) lines.push(`#arm-verify-cameras ${verifyCameras}`);
  lines.push('#cycle opening', ...(setup.actions ?? []).map(action => rowFor(action, false).join(' ')));
  lines.push('#cycle toys', ...(repeat.actions ?? []).map(action => rowFor(action, true).join(' ')));
  if (finish.actions?.length)
    lines.push('#cycle finish', ...finish.actions.map(action => rowFor(action, false).join(' ')));
  return lines.join('\n') + '\n';
}

function number(value, label) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? '')) fail(`${label} is not numeric`);
  return Number(value);
}

function parseRow(line, section) {
  const fields = line.trim().split(/\s+/);
  const at = number(fields.shift(), `${section} row time`);
  const kind = fields.shift();
  if (!['tap', 'hold', 'hall', 'camdrop'].includes(kind)) fail(`${section} has unsupported row ${kind}`);
  if (kind === 'camdrop') {
    if (fields.length !== 3) fail('camdrop row shape changed');
    return { at, kind, a: number(fields[0], 'camdrop lead'),
      b: number(fields[1], 'camdrop monitor contact'), c: number(fields[2], 'camdrop tail') };
  }
  if (kind === 'hall') {
    if (fields.length !== 1) fail('hall row shape changed');
    return { at, kind, action: 'hall', duration: number(fields[0], 'hall duration') };
  }
  if (fields.length !== 2 || !ACTIONS.has(fields[0])) fail(`${section} row has invalid action`);
  return { at, kind, action: fields[0], duration: number(fields[1], `${section} duration`) };
}

export function parseDevicePlan(text) {
  if (typeof text !== 'string') fail('plan text is required');
  const headers = {};
  const sections = { opening: [], toys: [], finish: [] };
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const match = line.match(/^#(\S+)(?:\s+(.*))?$/);
      if (!match) fail('invalid header');
      const [, name, value = ''] = match;
      if (name === 'cycle') {
        if (!Object.hasOwn(sections, value)) fail(`unknown cycle ${value}`);
        section = value;
      } else headers[name] = value;
      continue;
    }
    if (!section) fail('row before cycle header');
    sections[section].push(parseRow(line, section));
  }
  for (const required of ['policy', 'night', 'period', 'loop-start', 'stop-at', 'observe-until'])
    if (!(required in headers)) fail(`missing #${required}`);
  return { headers, sections };
}

function expandRow(row, baseMs, out) {
  const atMs = baseMs + row.at;
  if (row.kind === 'tap') out.push({ atMs, kind: 'press', action: semanticAction(row.action) });
  else if (row.kind === 'hold' || row.kind === 'hall') {
    const action = row.kind === 'hall' ? 'light' : semanticAction(row.action);
    out.push({ atMs, kind: 'press', action },
      { atMs: atMs + row.duration, kind: 'release', action });
  } else {
    out.push({ atMs, kind: 'press', action: 'light' },
      { atMs: atMs + row.a, kind: 'press', action: 'monitor' },
      { atMs: atMs + row.a + row.b + row.c, kind: 'release', action: 'light' });
  }
}

/** Expand the parsed plan through the same finite semantics as the phone. */
export function compileMockPhonePlan(parsed) {
  const loopStart = number(parsed.headers['loop-start'], '#loop-start');
  const stopAt = number(parsed.headers['stop-at'], '#stop-at');
  const period = number(parsed.headers.period, '#period');
  if (period <= 0 || stopAt <= loopStart) fail('invalid repeat bounds');
  const events = [];
  parsed.sections.opening.forEach(row => expandRow(row, 0, events));
  for (let base = loopStart; base < stopAt; base += period)
    parsed.sections.toys.forEach(row => expandRow(row, base, events));
  parsed.sections.finish.forEach(row => expandRow(row, 0, events));
  return events.filter(event => event.atMs <= stopAt)
    .sort((a, b) => a.atMs - b.atMs || (a.kind === 'release' ? -1 : 1));
}

const eventKey = event => [frame(event.atMs), event.kind, event.action].join('|');

/** Compare IR simulator semantics, emitted device text, and mocked phone output. */
export function comparePolicyToDevice(program, text = compileDevicePlan(program)) {
  validatePolicy(program);
  const simulator = compilePolicy(program, { untilMs: Number(parsedOr(program, 'observeUntil')) });
  let parsed;
  try {
    parsed = parseDevicePlan(text);
  } catch (error) {
    return { equal: false, mismatches: [{ field: 'plan', error: error.message }],
      simulatorCount: simulator.length, phoneCount: 0 };
  }
  const phone = compileMockPhonePlan(parsed);
  const simKeys = simulator.map(eventKey);
  const phoneKeys = phone.map(eventKey);
  const mismatches = [];
  const size = Math.max(simKeys.length, phoneKeys.length);
  for (let i = 0; i < size; i++) {
    if (simKeys[i] !== phoneKeys[i]) mismatches.push({ index: i, simulator: simKeys[i] ?? null,
      phone: phoneKeys[i] ?? null });
  }
  const observe = program.phases.find(phase => phase.kind === 'observe');
  const observeUntil = number(parsed.headers['observe-until'], '#observe-until');
  if (observeUntil !== observe.endMs)
    mismatches.push({ field: 'observe-until', simulator: observe.endMs, phone: observeUntil });
  const repeat = program.phases.find(phase => phase.kind === 'repeat');
  const period = number(parsed.headers.period, '#period');
  if (period !== repeat.periodMs)
    mismatches.push({ field: 'period', simulator: repeat.periodMs, phone: period });
  const loopStart = number(parsed.headers['loop-start'], '#loop-start');
  if (loopStart !== repeat.startMs)
    mismatches.push({ field: 'loop-start', simulator: repeat.startMs, phone: loopStart });
  const stopAt = number(parsed.headers['stop-at'], '#stop-at');
  if (stopAt !== repeat.endMs)
    mismatches.push({ field: 'stop-at', simulator: repeat.endMs, phone: stopAt });
  const night = number(parsed.headers.night, '#night');
  if (night !== program.metadata.nights[0])
    mismatches.push({ field: 'night', simulator: program.metadata.nights[0], phone: night });
  if (program.metadata.armVerify && parsed.headers['arm-verify'] !== '1')
    mismatches.push({ field: 'arm-verify', simulator: '1', phone: parsed.headers['arm-verify'] ?? null });
  const verifyCameras = armVerifyCameras(program.metadata.armVerifyCameras);
  if (verifyCameras && parsed.headers['arm-verify-cameras'] !== verifyCameras)
    mismatches.push({ field: 'arm-verify-cameras', simulator: verifyCameras,
      phone: parsed.headers['arm-verify-cameras'] ?? null });
  return { equal: mismatches.length === 0, mismatches,
    simulatorCount: simKeys.length, phoneCount: phoneKeys.length };
}

function parsedOr(program, name) {
  if (name === 'observeUntil') return program.phases.find(phase => phase.kind === 'observe').endMs;
  return null;
}
