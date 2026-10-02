// A synthetic event-text dump for the truth tests, written from the dumper's grammar
// (packages/source/decompile/EventTextDumper.cs) with invented objects and numbers. Nothing here is
// copied from a dump (ADR 0002, decision 12), and the records are assembled at run time from their
// fields, so this file's own text carries no dump-shaped line: tools/dump-text-check.ts passes it,
// and catches the text it generates.
//
// The scramble is K = 28, as on FNaF 2's Android build: an item-table row is stored at S and events
// address it as S ^ 28. The world: a counter `tally`, two actives `lamp` and `crate`, a text
// `label`, and filler rows of each type so that only one K agrees with every row's object type.
export const SYNTHETIC_K = 28;

const TAB = '\t';
const join = (fields: readonly (string | number)[]) => fields.join(TAB);

/** Stored item-table handles and their types. */
export const STORED = Object.freeze({ tally: 0, lamp: 1, crate: 2, label: 3 });
const TYPES = Object.freeze({ tally: 7, lamp: 2, crate: 2, label: 3 });
const FILLER = Object.freeze([[4, 7, 'dial'], [5, 3, 'caption'], [6, 2, 'door'], [7, 7, 'meter'], [8, 2, 'fan'], [9, 3, 'sign']] as const);

/** An event-space handle under a scramble. */
export const eventHandle = (name: keyof typeof STORED, k = SYNTHETIC_K) => STORED[name] ^ k;

const objectRecord = (stored: number, type: number, name: string, values = '') => join(['OBJECT', stored, 'TYPE', type, 'NAME', name, 'VALUES', values, 'STRINGS', '']);
const params = (list: readonly string[]) => list.join(' || ');
const parameter = (code: number, loader: string, text: string) => [code, loader, text].join(':');
const item = (index: number, ot: number, num: number, oi: number, loader: string, value: number | string) => `[${index}]` + [`ot=${ot}`, `num=${num}`, `oi=${oi}`, 'oil=0', `loader=${loader}`, `value=${value}`].join(',');
const end = (index: number) => item(index, 0, 0, 0, '', 'null');
/** An expression parameter: a comparison and its tokens. */
const expression = (code: number, comparison: string, tokens: readonly string[]) => parameter(code, 'ExpressionParameter', `cmp=${comparison} ${[...tokens, end(tokens.length)].join(' ; ')}`);
const literal = (code: number, value: number, comparison = '==') => expression(code, comparison, [item(0, -1, 0, 0, 'LongExp', value)]);
const alterable = (slot: number) => parameter(50, 'AlterableValue', `AlterableValue${slot}`);
const globalParam = (slot: number) => parameter(49, 'GlobalValue', `GlobalValue${slot > 26 ? slot : [9, 10, 13].includes(slot) ? ' ' : String.fromCharCode(slot)}`);
const place = (handle: number) => ['Object Info: ' + handle, 'Flags: 0', 'X:10', 'Y:20', 'Slope: 0', 'Angle:0', 'Direction:0', 'TypeParent: 2', 'Parent: 0', 'Layer: 0'].join(', ');

const condition = (ot: number, num: number, oi: number, list: readonly string[] = [], negated = false) =>
  join([' C', 'OT', ot, 'NUM', num, 'OI', oi, 'NAME', 'wrong name', 'OIL', 0, 'CFLAGS', 0, 'COTHER', negated ? 1 : 0, 'PARAMS', params(list)]);
const action = (ot: number, num: number, oi: number, list: readonly string[] = []) => join([' A', 'OT', ot, 'NUM', num, 'OI', oi, 'NAME', 'wrong name', 'OIL', 0, 'PARAMS', params(list)]);
const group = (index: number, conditions: readonly string[], actions: readonly string[]) =>
  [join(['GROUP', index, 'FLAGS', 0, 'RESTRICT', 'False', 'CONDS', conditions.length, 'ACTS', actions.length]), ...conditions, ...actions];

/**
 * The dump text. Group ids by frame:
 *   frame 0 g0  writes global 3
 *   frame 1 g0  reads lamp v2 (compare), writes lamp v2 (set), writes the tally (add)
 *   frame 1 g1  reads lamp flag 4 (flag-on), reads lamp v2 in an expression, writes crate v2
 *   frame 1 g2  creates crate
 *   frame 1 g3  reads the tally (compare), destroys crate
 *   frame 1 g4  reads global 3, toggles lamp flag 4, and carries a parameter printed only as a class name
 *   frame 1 g5  reads a global the dumper renders as a space (9, 10 or 13), a negated condition on label
 *   frame 1 g6  sets a lamp flag whose number is the tally's value, computed at run time
 */
export function syntheticDump({ k = SYNTHETIC_K }: {k?: number} = {}) {
  const h = (name: keyof typeof STORED) => eventHandle(name, k);
  const lines = [
    join(['GAME', 'Synthetic Fixture', 'BUILD', 296, 'FRAMES', 2]),
    'OBJECTS',
    ...(Object.keys(STORED) as Array<keyof typeof STORED>).map(name => objectRecord(STORED[name], TYPES[name], name, name === 'lamp' ? '0,0,5' : '')),   // the keys of a literal record
    ...FILLER.map(([stored, type, name]) => objectRecord(stored, type, name)),
    join(['OBJANIM', 'OI', STORED.lamp, 'ANIM', 0, 'DIR', 0, 'FRAMES', '11,12']),
    join(['FRAME', 0, 'Menu', 'GROUPS', 1]),
    join([' F', 'WIDTH', 640, 'HEIGHT', 480, 'LAYERS', 1, 'INSTANCES', 1]),
    join([' L', 'IDX', 0, 'NAME', 'Layer 1', 'XC', 1, 'YC', 1]),
    join([' I', 'INST', 0, 'OI', STORED.label ^ 48, 'NAME', 'label', 'X', 5, 'Y', 5, 'LAYER', 0, 'PTYPE', 0, 'PARENT', 0, 'INSTNUM', 0, 'W', '', 'H', '', 'HOTX', '', 'HOTY', '']),
    ...group(0, [condition(-1, -2, 0)], [action(-1, 3, 0, [globalParam(3), literal(22, 1)]), action(3, 88, h('label'), [literal(45, 0)])]),
    join(['FRAME', 1, 'Room', 'GROUPS', 7]),
    join([' F', 'WIDTH', 1600, 'HEIGHT', 720, 'LAYERS', 0, 'INSTANCES', 0]),
    ...group(0, [condition(2, -27, h('lamp'), [alterable(2), literal(23, 1)])],
      [action(2, 31, h('lamp'), [alterable(2), literal(22, 0)]), action(7, 81, h('tally'), [literal(22, 1)])]),
    ...group(1, [condition(2, -25, h('lamp'), [literal(22, 4)]), condition(3, -81, h('label'), [literal(23, 2)])],
      [action(2, 31, h('crate'), [alterable(2), expression(22, '==', [item(0, 2, 16, h('lamp'), 'ExtensionExp', 2), item(1, 0, 2, 0, '', 'null'), item(2, -1, 0, 0, 'LongExp', 1)])])]),
    ...group(2, [condition(-1, -1, 0)], [action(-5, 0, 0, [parameter(9, 'Create', `Create obj instance:0 info:${h('crate')} pos:(${place(h('lamp'))})`)])]),
    ...group(3, [condition(7, -81, h('tally'), [literal(23, 3, '>')])], [action(2, 24, h('crate'))]),
    ...group(4, [condition(-1, -8, 0, [globalParam(3), literal(23, 1)])],
      [action(2, 37, h('lamp'), [literal(22, 4)]), action(2, 23, h('lamp'), [parameter(29, 'IntParam', 'CTFAK.CCN.Chunks.Frame.IntParam')])]),
    ...group(5, [condition(-1, -8, 0, [globalParam(10), literal(23, 0)]), condition(3, -83, h('label'), [], true)], [action(3, 26, h('label'))]),
    ...group(6, [condition(-6, -7, 0, [parameter(32, 'Click', '0-0'), parameter(1, 'ParamObject', `Object 0 ${h('lamp')} 2`)])],
      [action(2, 35, h('lamp'), [expression(22, '==', [item(0, 7, 80, h('tally'), '', 'null')])])]),
  ];
  return `${lines.join('\n')}\n`;
}

/** A rendered-form sheet (the older per-frame form), which the truth reader refuses: built from pieces. */
export const renderedSheet = () => ['FRAME 01: Room  (1 event groups)', '='.repeat(34), '', ['---', 'group', '0', '---'].join(' '), ''].join('\n');

/** A stored-method zip holding one entry, as an APK holds its CCN. */
export function storedZip(name: string, data: Buffer) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const file = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(10, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(file.length, 28);
  const localSize = local.length + file.length + data.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); endRecord.writeUInt16LE(1, 8); endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(central.length + file.length, 12); endRecord.writeUInt32LE(localSize, 16);
  return Buffer.concat([local, file, data, central, file, endRecord]);
}

/** The first bytes of a Clickteam CCN (PAMU), padded: a file decode accepts as a CCN, holding no game. */
export const syntheticCcn = () => Buffer.concat([Buffer.from('PAMU', 'latin1'), Buffer.alloc(60)]);
