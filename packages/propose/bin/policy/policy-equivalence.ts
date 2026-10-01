// Compiler equivalence gate for policy-v1 (Plan 21 package 5).
//
// The device plan is a deliberately small text format consumed by the phone
// interpreter. This module is its host-side compiler/parser, so a policy can
// be compared to the mocked phone trace before an adb action is allowed.
import { createHash } from 'node:crypto';
import { compilePolicy } from './policy-interpreter.ts';
import { canonicalPolicy, validatePolicy } from '@sixam/propose/policy';
import type { PolicyAction, PolicyProgram } from '@sixam/propose/policy';
import { isList, isOneOf } from '@sixam/kernel';
import { DEVICE_CONTROL_NAMES } from '@sixam/source';
import { phaseOf } from './policy-interpreter.ts';
import type { PolicyEvent } from './policy-interpreter.ts';

// The plan text's own short forms, plus the canonical control names taken from
// the vocabulary rather than copied. This set was a hand copy until 2026-09-20
// and it still read `light`/`ventl` after `e8af711` renamed the vocabulary on
// 2026-09-09; nothing noticed until `3efc923` put a `cameraFeedLight` row in
// the opening two days later, and then only this gate saw it -- which is why
// deriving the names beats restating them.
const PLAN_SHORTHAND = ['cam9', 'cam11', 'ventl', 'light', 'hall'];
const ACTIONS = new Set<string>([...DEVICE_CONTROL_NAMES, ...PLAN_SHORTHAND]);
const finite = (value: unknown): value is number => Number.isFinite(value);
const frame = (ms: number) => Math.round(ms * 60 / 1000);
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
const planAction = (action: string) => action;
const semanticAction = (action: string) => CAMERA_SHORTHAND.test(action)
  // The test just matched.
  ? `cam:${(CAMERA_SHORTHAND.exec(action) as RegExpExecArray)[1]}`
  : MODEL_LIGHTS.has(action) ? 'light' : action;
// RegExp.test reads its argument as a string, which is what String() spells.
const cameraName = (value: unknown) => /^cam:(?:[1-9]|1[0-2])$/.test(String(value ?? ''));

function armVerifyCameras(value: unknown) {
  if (value === undefined) return null;
  if (!isList(value) || value.length < 2 ||
      value.some(camera => !cameraName(camera)) || new Set(value).size !== value.length)
    fail('metadata.armVerifyCameras must contain unique camera names');
  // Each one is a camera name, checked above.
  const sorted = ([...value] as string[]).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  return sorted.join(',');
}

function fail(message: string): never { throw new TypeError(`policy equivalence: ${message}`); }

/** A tap, hold or hall row of the plan text: its control and how long it is held. */
type ContactRow<K> = { readonly at: number, readonly kind: K, readonly action: string, readonly duration: number };
/** A row of the plan text: a contact, or a camdrop's lead, monitor contact and tail. */
type PlanRow = ContactRow<'tap'> | ContactRow<'hold'> | ContactRow<'hall'>
  | { readonly at: number, readonly kind: 'camdrop', readonly a: number, readonly b: number, readonly c: number };

export function policySha256(program: PolicyProgram) {
  validatePolicy(program);
  return createHash('sha256').update(canonicalPolicy(program)).digest('hex');
}

function rowFor(action: PolicyAction, repeat: boolean) {
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
export function compileDevicePlan(program: PolicyProgram) {
  validatePolicy(program);
  // The device plan text is a static schedule: it has no construct for a
  // decision taken at run time. Refuse rather than silently flatten a branch
  // into one of its arms -- a flattened branch is a different program.
  for (const phase of program.phases) {
    if ((phase.branches ?? []).length)
      fail(`phase ${phase.id} carries observation-conditioned branches; the device plan format cannot express them`);
  }
  const byKind = (kind: string) => program.phases.find(phase => phase.kind === kind);
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

function number(value: string | undefined, label: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? '')) fail(`${label} is not numeric`);
  return Number(value);
}

function parseRow(line: string, section: string): PlanRow {
  const fields = line.trim().split(/\s+/);
  const at = number(fields.shift(), `${section} row time`);
  const kind = fields.shift();
  if (!isOneOf(['tap', 'hold', 'hall', 'camdrop'] as const, kind)) fail(`${section} has unsupported row ${kind}`);
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

export function parseDevicePlan(text: unknown) {
  if (typeof text !== 'string') fail('plan text is required');
  const headers: Record<string, string> = {};
  const sections: Record<'opening' | 'toys' | 'finish', PlanRow[]> = { opening: [], toys: [], finish: [] };
  let section = null as keyof typeof sections | null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const match = line.match(/^#(\S+)(?:\s+(.*))?$/);
      if (!match) fail('invalid header');
      const [, name, value = ''] = match;
      if (name === 'cycle') {
        if (!Object.hasOwn(sections, value)) fail(`unknown cycle ${value}`);
        section = value as keyof typeof sections;
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

function expandRow(row: PlanRow, baseMs: number, out: PolicyEvent[]) {
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
export function compileMockPhonePlan(parsed: ReturnType<typeof parseDevicePlan>) {
  const loopStart = number(parsed.headers['loop-start'], '#loop-start');
  const stopAt = number(parsed.headers['stop-at'], '#stop-at');
  const period = number(parsed.headers.period, '#period');
  if (period <= 0 || stopAt <= loopStart) fail('invalid repeat bounds');
  const events: PolicyEvent[] = [];
  parsed.sections.opening.forEach(row => expandRow(row, 0, events));
  for (let base = loopStart; base < stopAt; base += period)
    parsed.sections.toys.forEach(row => expandRow(row, base, events));
  parsed.sections.finish.forEach(row => expandRow(row, 0, events));
  return events.filter(event => event.atMs <= stopAt)
    .sort((a, b) => a.atMs - b.atMs || (a.kind === 'release' ? -1 : 1));
}

const eventKey = (event: PolicyEvent) => [frame(event.atMs), event.kind, event.action].join('|');

/** Compare IR simulator semantics, emitted device text, and mocked phone output. */
export function comparePolicyToDevice(program: PolicyProgram, text = compileDevicePlan(program)) {
  validatePolicy(program);
  const simulator = compilePolicy(program, { untilMs: Number(parsedOr(program, 'observeUntil')) });
  let parsed: ReturnType<typeof parseDevicePlan>;
  try {
    parsed = parseDevicePlan(text);
  } catch (error) {
    return { equal: false, mismatches: [{ field: 'plan', error: (error as Error).message }],
      simulatorCount: simulator.length, phoneCount: 0 };
  }
  const phone = compileMockPhonePlan(parsed);
  const simKeys = simulator.map(eventKey);
  const phoneKeys = phone.map(eventKey);
  const mismatches: Readonly<Record<string, unknown>>[] = [];
  const size = Math.max(simKeys.length, phoneKeys.length);
  for (let i = 0; i < size; i++) {
    if (simKeys[i] !== phoneKeys[i]) mismatches.push({ index: i, simulator: simKeys[i] ?? null,
      phone: phoneKeys[i] ?? null });
  }
  const observe = phaseOf(program, 'observe');
  const observeUntil = number(parsed.headers['observe-until'], '#observe-until');
  if (observeUntil !== observe.endMs)
    mismatches.push({ field: 'observe-until', simulator: observe.endMs, phone: observeUntil });
  const repeat = phaseOf(program, 'repeat');
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

function parsedOr(program: PolicyProgram, name: string) {
  if (name === 'observeUntil') return phaseOf(program, 'observe').endMs;
  return null;
}
