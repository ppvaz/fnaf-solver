#!/usr/bin/env node
// Read the Fusion event-sheet dump with object handles unscrambled.
//
// The Android runtime XORs every object handle with 28 at load, and events address objects *after* that XOR, so a
// raw dump labels every event with the wrong object name. This reader resolves each handle through the XOR before
// looking the name up, which is the only way the dump means anything.
//
// Read docs/android/SOURCE-DUMP-GUIDE.md first -- it explains the file format, the handle scramble, and the
// alterable-value vocabulary these commands print.
//
// The dump itself is game content: it lives outside the repo. Point --dump (or $FNAF2_DUMP) at it; regenerate it
// with packages/source/decompile/regen-dump.sh.
//
//   readdump.ts frames                     every frame and its group count
//   readdump.ts objects [pattern]          objects by event-space handle
//   readdump.ts group 3 413-418            print a group range
//   readdump.ts find 3 "balloon boy"       groups whose text matches
//   readdump.ts object 3 "balloon boy"     groups referencing an object
//   readdump.ts writes 3 "balloon boy" 0   groups whose actions write its value 0
//   readdump.ts sounds 3                   sample handles played, and by which groups
//   readdump.ts sounds 3 21                the groups that play one sample handle
//   readdump.ts instances 3 [pattern]      placed scene objects: X, Y, layer, extent
//
// PC dumps (Fusion builds before the Android scramble) need --xor 0 --lo-xor 0.
//
// Placed frame instances are scrambled again, with their own constant: the runtime's layout loader (Frame/CLO.load)
// reads an instance's object handle as `readAShort() ^ 48`, and only then looks it up in the post-XOR-28 item
// table. So an ` I` line's OI is neither an event handle nor an item-table row: the event handle is OI ^ 48 and the
// item-table row is OI ^ 48 ^ 28.
//
// Ported from readdump.py: it reads, prints and exits as that did. Handles are bigints, as Python's ints are.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyAlign, pyArgs, pyInt, pyReadText, pyStrip } from '@sixam/kernel/py';

const DEFAULT_DUMP = process.env.FNAF2_DUMP ?? '/private/tmp/fnaf2-android-dump/events-android.txt';

// Python's re, kept: \d is any Unicode decimal digit (int() reads it) and . is anything but a newline.
// "6:Sample:Sample '<obfuscated name>' handle: N" is a play-sample action.
const SAMPLE_RE = /Sample:Sample [^\n]*? handle: (\p{Nd}+)/gu;
const POSITION_RE = /Object Info: (\p{Nd}+)/gu;
// ParamObject renders as "Object <oil> <handle> <type>" (see ParamObject.cs).
const PARAMOBJECT_RE = /Object (\p{Nd}+) (\p{Nd}+) (\p{Nd}+)/gu;

/** int(text): a ValueError stops the run here as it did there. */
export function int(text: string | undefined): bigint {
  if (text === undefined) throw new TypeError("int() argument must be a string, a bytes-like object or a real number, not 'NoneType'");
  const value = pyInt(text);
  if (value === null) throw new RangeError(`invalid literal for int() with base 10: '${text}'`);
  return value;
}
/** dict(zip(field[1::2], field[2::2])): the pairs after the first field, a repeated key keeping its last value. */
export function cells(field: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let k = 1; k + 1 < field.length; k += 2) out.set(field[k], field[k + 1]);
  return out;
}
/** list[index], a negative index from the end, and an IndexError past either end. */
export function at<T>(list: readonly T[], index: bigint | number): T {
  const k = Number(index);
  if (k >= list.length || k < -list.length) throw new RangeError('list index out of range');
  return list[k < 0 ? list.length + k : k];
}
/** dict[key], a KeyError where Python raised one. */
export function key(map: ReadonlyMap<string, string>, name: string): string {
  const value = map.get(name);
  if (value === undefined) throw new RangeError(`KeyError: '${name}'`);
  return value;
}
/** str() of a dict.get() result: None prints as None. */
const shown = (value: string | undefined) => value ?? 'None';

export interface Group { idx: bigint, header: Map<string, string>, lines: string[] }
export interface Frame {
  idx: bigint, name: string, groups: Group[], size: Map<string, string>, layers: Map<string, string>[], instances: Map<string, string>[],
}

export class Dump {
  readonly xor: bigint;
  readonly loXor: bigint;            // Frame/CLO.load: loOiHandle = readAShort() ^ 48
  readonly objects = new Map<bigint, string>();   // stored handle -> name as the item table has it
  readonly types = new Map<bigint, string>();     // stored handle -> TYPE as the item table has it
  readonly images = new Map<bigint, [bigint, bigint, bigint, bigint]>();   // stored handle -> (W, H, HOTX, HOTY)
  readonly frames: Frame[] = [];

  constructor(path: string, xor = 28n, loXor = 48n) {
    this.xor = xor;
    this.loXor = loXor;
    let frame: Frame | null = null;
    let group: Group | null = null;
    const current = <T>(value: T | null): T => {
      if (value === null) throw new TypeError("'NoneType' object is not subscriptable");
      return value;
    };
    // open(path, errors="replace"), read a line at a time, each without its newline.
    const text = pyReadText(readFileSync(path), 'replace');
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      const field = line.split('\t');
      if (field[0] === 'OBJECT') {
        this.objects.set(int(field[1]), at(field, 5));
        this.types.set(int(field[1]), at(field, 3));
      } else if (field[0] === 'FRAME') {
        frame = { idx: int(field[1]), name: at(field, 2), groups: [], size: new Map(), layers: [], instances: [] };
        this.frames.push(frame);
      } else if (field[0] === ' F') current(frame).size = cells(field);
      else if (field[0] === ' L') current(frame).layers.push(cells(field));
      else if (field[0] === ' I') {
        const instance = cells(field);
        current(frame).instances.push(instance);
        if (instance.get('W')) {
          const image: [bigint, bigint, bigint, bigint] = [int(key(instance, 'W')), int(key(instance, 'H')), int(key(instance, 'HOTX')), int(key(instance, 'HOTY'))];
          const row = int(key(instance, 'OI'));
          if (!this.images.has(row)) this.images.set(row, image);
        }
      } else if (field[0] === 'GROUP') {
        const header = new Map<string, string>();
        for (let k = 2; k + 1 < field.length; k += 2) header.set(field[k], field[k + 1]);
        group = { idx: int(field[1]), header, lines: [] };
        current(frame).groups.push(group);
      } else if (line.startsWith(' C') || line.startsWith(' A')) current(group).lines.push(line);
    }
  }

  /** True name of the object an event addresses by `handle`. */
  name(handle: bigint) {
    return this.objects.get(handle ^ this.xor) ?? `?${handle}`;
  }

  /** The event-space handle of a placed scene object.
   *
   *  The runtime's layout loader (Frame/CLO.load) XORs an instance's stored object handle with 48 and only then
   *  resolves it through the item table that COI.loadHeader already XORed with 28. So an ` I` line's OI is its own
   *  space: the event handle is OI ^ 48, and the item-table row is OI ^ 48 ^ 28. Neither earlier rule was right:
   *  "not scrambled" (2026-08-26) and "same space as events" (2026-09-15) each left the Office without five of its
   *  twelve camera markers, and the recompile join that backed the second read the same chunk with the same
   *  mistake. See docs/android/SOURCE-DUMP-GUIDE.md 4. */
  handle(instance: ReadonlyMap<string, string>) {
    return int(key(instance, 'OI')) ^ this.loXor;
  }

  /** True name of a placed scene object. */
  placed(instance: ReadonlyMap<string, string>) {
    return this.name(this.handle(instance));
  }

  /** [left, top, right, bottom] in scene units, or null with no image.
   *
   *  The dumper read W/H/HOTX/HOTY from the item-table row equal to the raw OI, which is not the object's row. The
   *  true object's row is OI ^ loXor ^ xor, and its image is what the dumper printed on any instance line (in any
   *  frame) whose OI equals that row. Fusion draws an image with its hotspot on the object's position. Animation 0 /
   *  direction 0 / frame 0 -- the default appearance, not whatever is showing at runtime. */
  extent(instance: ReadonlyMap<string, string>): [bigint, bigint, bigint, bigint] | null {
    const image = this.images.get(this.handle(instance) ^ this.xor);
    if (image === undefined) return null;
    const [w, h, hotX, hotY] = image;
    const x = int(key(instance, 'X')), y = int(key(instance, 'Y'));
    const left = x - hotX, top = y - hotY;
    return [left, top, left + w, top + h];
  }

  /** False when the true object is an Active whose image no instance line carries. */
  imageKnown(instance: ReadonlyMap<string, string>) {
    const row = this.handle(instance) ^ this.xor;
    return this.images.has(row) || this.types.get(row) !== '2';
  }

  render(line: string) {
    const field = line.split('\t');
    const kind = pyStrip(field[0]);
    const cell = cells(field);
    const handle = int(cell.get('OI') ?? '0');
    // Fusion stores condition negation in OtherFlags bit 0.
    const negated = kind === 'C' && (int(cell.get('COTHER') || '0') & 1n) !== 0n;
    const cut = line.indexOf('PARAMS\t');
    let params = cut < 0 ? '' : line.slice(cut + 'PARAMS\t'.length);
    // Position parameters carry event-space handles too: unscramble them so a route hop reads "-> cam 10" instead
    // of a meaningless number.
    params = params.replace(POSITION_RE, (_, handleText: string) => `Object Info: ${handleText} [${this.name(int(handleText))}]`);
    params = params.replace(PARAMOBJECT_RE, (_, oil: string, handleText: string, type: string) =>
      `Object ${oil} ${handleText} [${this.name(int(handleText))}] ${type}`);
    return `  ${negated ? '!' : ' '}${kind} ot=${shown(cell.get('OT'))} num=${shown(cell.get('NUM'))} oi=${handle} [${this.name(handle)}] ${params}`;
  }

  text(group: Group) {
    return group.lines.map(line => this.render(line)).join('\n');
  }

  show(frameIndex: bigint, group: Group) {
    const header = group.header;
    console.log(`FRAME ${frameIndex} GROUP ${group.idx}  flags=${shown(header.get('FLAGS'))} conds=${shown(header.get('CONDS'))} acts=${shown(header.get('ACTS'))}`);
    console.log(this.text(group));
    console.log();
  }

  /** Sample handles this group plays, in action order. */
  samples(group: Group) {
    return this.actions(group).flatMap(([, line]) => [...line.matchAll(SAMPLE_RE)].map(match => int(match[1])));
  }

  actions(group: Group): [Map<string, string>, string][] {
    return group.lines.filter(line => line.startsWith(' A')).map(line => [cells(line.split('\t')), line]);
  }
}

/** str.lower(): the full Unicode lowercase mapping, final sigma included, as JavaScript's is. */
const lower = (text: string) => text.toLowerCase();
/** text[:n], counted in code points. */
const head = (text: string, n: number) => [...text].slice(0, n).join('');

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'readdump.ts', [{ name: '--dump' }, { name: '--lo-xor', type: 'int' }, { name: '--xor', type: 'int' }],
    [{ name: 'command', choices: ['frames', 'objects', 'group', 'find', 'object', 'writes', 'sounds', 'instances'] }, { name: 'args', rest: true }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const option = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : null; };
  const dumpPath = option('--dump') ?? DEFAULT_DUMP;
  const xor = int(option('--xor') ?? '28'), loXor = int(option('--lo-xor') ?? '48');
  const [command, ...rest] = args.positionals;
  if (!existsSync(dumpPath)) {
    console.error(`no dump at ${dumpPath} -- see docs/android/SOURCE-DUMP-GUIDE.md`);
    return 1;
  }
  const dump = new Dump(dumpPath, xor, loXor);

  if (command === 'frames') {
    for (const frame of dump.frames) console.log(`${pyAlign(String(frame.idx), 3, '>')}  ${pyAlign(frame.name, 34)} ${pyAlign(String(frame.groups.length), 5, '>')} groups`);
    return 0;
  }
  if (command === 'objects') {
    const pattern = rest.length ? lower(rest[0]) : '';
    const sorted = [...dump.objects].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
    for (const [stored, name] of sorted) {
      if (pattern && !lower(name).includes(pattern)) continue;
      // Events address this object as stored^xor; print that handle first.
      console.log(`${pyAlign(String(stored ^ xor), 4, '>')}  ${name}`);
    }
    return 0;
  }

  const frameIndex = int(at(rest, 0));
  const frame = at(dump.frames, frameIndex);

  if (command === 'group') {
    const span = at(rest, 1);
    const cut = span.indexOf('-');
    const lowText = cut < 0 ? span : span.slice(0, cut), highText = cut < 0 ? '' : span.slice(cut + 1);
    const low = int(lowText), high = int(highText || lowText);
    for (const group of frame.groups) if (low <= group.idx && group.idx <= high) dump.show(frameIndex, group);
    return 0;
  }
  if (command === 'find') {
    const needle = lower(at(rest, 1));
    for (const group of frame.groups) if (lower(dump.text(group)).includes(needle)) dump.show(frameIndex, group);
    return 0;
  }
  if (command === 'object') {
    const target = lower(at(rest, 1));
    for (const group of frame.groups) {
      if (group.lines.some(line => lower(dump.name(int(cells(line.split('\t')).get('OI') ?? '0'))) === target)) dump.show(frameIndex, group);
    }
    return 0;
  }
  if (command === 'sounds') {
    const wanted = rest.length > 1 ? int(rest[1]) : null;
    const index = new Map<bigint, bigint[]>();
    for (const group of frame.groups) {
      for (const handle of dump.samples(group)) {
        const groups = index.get(handle) ?? [];
        groups.push(group.idx);
        index.set(handle, groups);
      }
    }
    if (wanted !== null) {
      for (const group of frame.groups) if (dump.samples(group).includes(wanted)) dump.show(frameIndex, group);
      return 0;
    }
    // A sample played by one group is a candidate cue; a sample played by many is shared, and cannot identify a
    // state edge on its own.
    for (const handle of [...index.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const groups = index.get(handle) ?? [];
      console.log(`sample ${pyAlign(String(handle), 3, '>')}  ${pyAlign(String(groups.length), 2, '>')} group(s)  `
        + `${groups.slice(0, 12).map(String).join(', ')}${groups.length > 12 ? ' ...' : ''}`);
    }
    return 0;
  }
  if (command === 'instances') {
    const pattern = rest.length > 1 ? lower(rest[1]) : '';
    const size = frame.size;
    console.log(`frame ${frameIndex}  ${frame.name}  ${shown(size.get('WIDTH'))}x${shown(size.get('HEIGHT'))}  ${shown(size.get('LAYERS'))} layers  `
      + `${shown(size.get('INSTANCES'))} instances`);
    for (const instance of frame.instances) {
      const name = dump.placed(instance);
      if (pattern && !lower(name).includes(pattern)) continue;
      const box = dump.extent(instance);
      const handle = dump.handle(instance);
      const [oi, x, y, layer] = [key(instance, 'OI'), key(instance, 'X'), key(instance, 'Y'), key(instance, 'LAYER')];
      console.log(`  ${pyAlign(head(name, 30), 30)} h=${pyAlign(String(handle), 4)} oi=${pyAlign(oi, 5)} X=${pyAlign(x, 6)} Y=${pyAlign(y, 6)} `
        + `layer=${pyAlign(layer, 3)} ${box ? `box x[${box[0]}..${box[2]}] y[${box[1]}..${box[3]}]`
          : dump.imageKnown(instance) ? '(no image)' : '(image not in dump)'}`);
    }
    return 0;
  }
  if (command === 'writes') {
    const target = lower(at(rest, 1));
    const value = rest.length > 2 ? `AlterableValue${rest[2]} ` : 'AlterableValue';
    for (const group of frame.groups) {
      for (const [cell, line] of dump.actions(group)) {
        if (lower(dump.name(int(cell.get('OI') ?? '0'))) === target && line.includes(value)) {
          dump.show(frameIndex, group);
          break;
        }
      }
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
