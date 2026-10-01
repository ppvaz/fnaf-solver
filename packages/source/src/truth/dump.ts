/**
 * The tabular event-text dump, parsed into fields.
 *
 * The grammar is the one packages/source/decompile/EventTextDumper.cs writes
 * (and readdump.py reads): tab-separated key/value records -- a GAME header,
 * one OBJECT record per item-table row, then per frame a FRAME record, its
 * geometry and placed instances, and per event group a GROUP record followed
 * by its condition and action rows, each ending in a PARAMS field whose
 * parameters are joined by ` || `. Nothing here holds or ships a dump: the
 * caller's own local file is read by packages/source/decompile/truth.ts and
 * handed in as text (Plan 28: "the server ships the decoder, not the decoded
 * data").
 *
 * Object handles are left as the dump stores them. Item-table rows carry the
 * stored handle; condition, action and parameter handles are event-space,
 * i.e. the stored handle XOR the per-build scramble K (handles.js). A row's
 * NAME field is the dumper's lookup of the raw event handle, which is wrong
 * under any K but 0, so it is never read.
 */
import { unknown } from '@sixam/kernel';

export const DUMP_FORMAT = 'ctfak-event-text-v1';
export const DUMPER = 'packages/source/decompile/EventTextDumper.cs';

const TAB = '\t';
const PARAM_SEPARATOR = ' || ';
const ITEM_SEPARATOR = ' ; ';

/** A record's fields after its tag, read as key/value pairs. */
const pairs = (fields: string[]) => {
  const out: Record<string, string> = {};
  for (let index = 0; index + 1 < fields.length; index += 2) out[fields[index]] = fields[index + 1];
  return out;
};
const int = text => (/^-?\d+$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null);
const scalar = text => (text === 'True' ? true : text === 'False' ? false : int(text) ?? text ?? null);

/** Does this text open the way the tabular dump does? */
export const isTabularDump = (text: string) => /^GAME\t[^\n]*\tBUILD\t/.test(text.replace(/^﻿/, ''));

// --- parameters ------------------------------------------------------------------------------

const ITEM = /^\[(\d+)\]ot=(-?\d+),num=(-?\d+),oi=(-?\d+),oil=(-?\d+),loader=([^,]*),value=(.*)$/s;
const NUMERIC_LOADERS = new Set(['LongExp', 'DoubleExp', 'ExtensionExp', 'GlobalCommon']);

/** One expression token. */
function expressionItem(text: string) {
  const match = ITEM.exec(text);
  if (!match) return { parsed: false };
  const [, index, objectType, num, handle, oil, loader, raw] = match;
  let value = null;
  if (raw !== 'null') {
    if (NUMERIC_LOADERS.has(loader)) value = Number.isFinite(Number(raw)) && raw.trim() !== '' ? Number(raw) : null;
    else if (loader === 'StringExp') value = raw;
  }
  return { index: Number(index), objectType: Number(objectType), num: Number(num), handle: Number(handle), oil: Number(oil),
    loader: loader || null, value };
}

/**
 * CTFAK renders a global value's index as a digit string above 26 and as the character with that
 * code at or below it; the dumper then turns tab, newline and return (9, 10, 13) into one space.
 */
function globalSlot(rest: string) {
  if (/^\d+$/.test(rest) && Number(rest) > 26) return Number(rest);
  if (rest.length === 1) {
    const code = rest.charCodeAt(0);
    if (code === 32) return unknown('the dumper renders global values 9, 10 and 13 alike, as one space');
    if (code <= 26) return code;
  }
  return unknown('a global value index the dumper rendered in no form this reader knows');
}

const POSITION = /^Object Info: (-?\d+), Flags: (-?\d+), X:(-?\d+), Y:(-?\d+), Slope: (-?\d+), Angle:(-?\d+), Direction:(-?\d+), TypeParent: (-?\d+), Parent: (-?\d+), Layer: (-?\d+)$/;
function position(text: string) {
  const match = POSITION.exec(text);
  if (!match) return null;
  const [parent, flags, x, y, slope, angle, direction, typeParent, oil, layer] = match.slice(1).map(Number);
  return { parent, flags, x, y, slope, angle, direction, typeParent, oil, layer };
}

/**
 * One parameter as fields: its code, its loader, and what the loader's rendering says. A loader
 * the dumper printed only as its class name has nothing to read and comes back `parsed: false`.
 */
export function parseParameter(text: string) {
  const head = /^(\d+):([^:]*):(.*)$/s.exec(text);
  if (!head) return { code: null, loader: null, parsed: false };
  const [, codeText, loader, rest] = head;
  const code = Number(codeText);
  const base = { code, loader };
  if (loader === 'ExpressionParameter') {
    const match = /^cmp=(\S*) ?(.*)$/s.exec(rest);
    if (!match) return { ...base, parsed: false };
    const items = match[2] ? match[2].split(ITEM_SEPARATOR).map(expressionItem) : [];
    return { ...base, parsed: items.every(item => item.parsed !== false), comparison: match[1] || null, items };
  }
  let match;
  if (loader === 'AlterableValue' && (match = /^AlterableValue(\d+)$/.exec(rest))) return { ...base, parsed: true, slot: Number(match[1]) };
  if (loader === 'GlobalValue' && rest.startsWith('GlobalValue')) {
    const slot = globalSlot(rest.slice('GlobalValue'.length));
    return { ...base, parsed: typeof slot === 'number', slot };
  }
  if ((match = /^[A-Za-z]+ value: (-?\d+)$/.exec(rest))) return { ...base, parsed: true, value: Number(match[1]) };
  if (loader === 'Time' && (match = /^Time time: (-?\d+) loops: (-?\d+)$/.exec(rest)))
    return { ...base, parsed: true, ms: Number(match[1]), loops: Number(match[2]) };
  if (loader === 'Sample' && (match = / handle: (-?\d+)$/.exec(rest))) return { ...base, parsed: true, sample: Number(match[1]) };
  if (loader === 'ParamObject' && (match = /^Object (-?\d+) (-?\d+) (-?\d+)$/.exec(rest)))
    return { ...base, parsed: true, oil: Number(match[1]), handle: Number(match[2]), objectType: Number(match[3]) };
  if (loader === 'Position') {
    const at = position(rest);
    return at ? { ...base, parsed: true, ...at } : { ...base, parsed: false };
  }
  if (loader === 'Create' && (match = /^Create obj instance:(-?\d+) info:(-?\d+) pos:\((.*)\)$/s.exec(rest))) {
    const at = position(match[3]);
    return { ...base, parsed: Boolean(at), instance: Number(match[1]), handle: Number(match[2]), position: at };
  }
  if (loader === 'Group' && (match = /^Group: (.*)$/s.exec(rest))) return { ...base, parsed: true, name: match[1] };
  if (loader === 'KeyParameter' && (match = /^Key-?(\d+)$/.exec(rest))) return { ...base, parsed: true, key: Number(match[1]) };
  if (loader === 'Click' && (match = /^(\d+)-(\d+|True|False)$/.exec(rest)))
    return { ...base, parsed: true, button: Number(match[1]), double: match[2] === 'True' || match[2] === '1' };
  if (loader === 'Every' && (match = /^Every (-?\d+) sec$/.exec(rest))) return { ...base, parsed: true, seconds: Number(match[1]) };
  if (loader === 'TwoShorts' && (match = /^Shorts: (-?\d+) and (-?\d+)$/.exec(rest)))
    return { ...base, parsed: true, values: [Number(match[1]), Number(match[2])] };
  return { ...base, parsed: false };
}

export const parseParameters = (text: string) => (text ? text.split(PARAM_SEPARATOR).map(parseParameter) : []);

// --- rows ------------------------------------------------------------------------------------

/**
 * A condition or action row as fields. The PARAMS field is the rest of the line: the dumper
 * turns tabs inside a parameter into spaces, so a tab never splits one.
 */
export function parseRow(line: string, index: number) {
  const kind = line.startsWith(' C') ? 'condition' : 'action';
  const at = line.indexOf(`${TAB}PARAMS${TAB}`);
  const head = pairs((at >= 0 ? line.slice(0, at) : line).split(TAB).slice(1));
  const cother = int(head.COTHER);
  const row = {
    kind, index, objectType: int(head.OT), num: int(head.NUM), handle: int(head.OI), oil: int(head.OIL),
    ...(kind === 'condition' ? { flags: int(head.CFLAGS), otherFlags: cother, negated: Boolean((cother ?? 0) & 1) } : {}),
    params: parseParameters(at >= 0 ? line.slice(at + 8) : ''),
  };
  return row;
}

// --- the whole dump --------------------------------------------------------------------------

export type DumpObject = {stored: number, type: number, name: string, values: number[]};
export type DumpGroup = {index: number, flags: any, restricted: any, declared: {conditions: number | null, actions: number | null}, conditions: any[], actions: any[]};
export type DumpFrame = {index: number, name: string, groups: DumpGroup[], instances: number};
export type Dump = {format: string, game: {name: string, build: number | null, frames: number | null}, objects: Map<number, DumpObject>, frames: DumpFrame[], audit: {unclassified: number[], countMismatches: string[]}};

/**
 * Parse the tabular dump. Every line is a known record or is counted in `audit.unclassified`
 * (its line number, never its text), and a group whose rows disagree with the counts its GROUP
 * record declares is named in `audit.countMismatches`.
 */
export function parseDump(text: string): Dump {
  const lines = text.replace(/^﻿/, '').split('\n');
  const dump: Dump = { format: DUMP_FORMAT, game: { name: '', build: null, frames: null }, objects: new Map(), frames: [],
    audit: { unclassified: [], countMismatches: [] } };
  let frame: DumpFrame | null = null;
  let group: DumpGroup | null = null;
  lines.forEach((raw, number) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) return;
    const fields = line.split(TAB);
    const tag = fields[0];
    if (tag === 'GAME') {
      const header = pairs(fields.slice(2));
      dump.game = { name: fields[1] ?? '', build: int(header.BUILD), frames: int(header.FRAMES) };
    } else if (tag === 'OBJECTS' || tag === 'OBJANIM' || tag === ' F' || tag === ' L') {
      // Geometry and animation rows carry nothing the event queries read.
    } else if (tag === 'OBJECT') {
      const record = pairs(fields.slice(2));
      const stored = int(fields[1]);
      if (stored === null) { dump.audit.unclassified.push(number + 1); return; }
      dump.objects.set(stored, { stored, type: int(record.TYPE), name: record.NAME ?? '',
        values: (record.VALUES ?? '').split(',').filter(Boolean).map(Number) });
    } else if (tag === 'FRAME') {
      frame = { index: int(fields[1]), name: fields[2] ?? '', groups: [], instances: 0 };
      group = null;
      dump.frames.push(frame);
    } else if (tag === ' I' && frame) {
      frame.instances += 1;
    } else if (tag === 'GROUP' && frame) {
      const record = pairs(fields.slice(2));
      group = { index: int(fields[1]), flags: scalar(record.FLAGS), restricted: scalar(record.RESTRICT),
        declared: { conditions: int(record.CONDS), actions: int(record.ACTS) }, conditions: [], actions: [] };
      frame.groups.push(group);
    } else if ((tag === ' C' || tag === ' A') && group) {
      const list = tag === ' C' ? group.conditions : group.actions;
      list.push(parseRow(line, list.length));
    } else {
      dump.audit.unclassified.push(number + 1);
    }
  });
  for (const each of dump.frames)
    for (const item of each.groups)
      if ((item.declared.conditions !== null && item.declared.conditions !== item.conditions.length) ||
        (item.declared.actions !== null && item.declared.actions !== item.actions.length))
        dump.audit.countMismatches.push(`frame ${each.index} g${item.index}`);
  return dump;
}

/** Counts that describe a parsed dump without quoting it. */
export const dumpShape = (dump: Dump) => ({
  format: dump.format, build: dump.game.build, frames: dump.frames.length, objects: dump.objects.size,
  groups: dump.frames.reduce((sum, frame) => sum + frame.groups.length, 0),
  conditions: dump.frames.reduce((sum, frame) => sum + frame.groups.reduce((n, group) => n + group.conditions.length, 0), 0),
  actions: dump.frames.reduce((sum, frame) => sum + frame.groups.reduce((n, group) => n + group.actions.length, 0), 0),
  unclassifiedLines: dump.audit.unclassified.length, countMismatches: dump.audit.countMismatches.length,
});
