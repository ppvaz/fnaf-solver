/**
 * Numbers printed as Python prints them, for the scripts ported from Python (Pedro, 2026-10-02: unforced
 * Python is ported to TypeScript and switched only once its output matches). A record or report a ported
 * tool writes keeps the bytes its Python wrote, so the formatting moves with it.
 */
import { isList } from './labels.ts';

/**
 * `format(x, '.Nf')`: the exact binary value rounded to N decimals, an exact tie to the even digit.
 * Number.prototype.toFixed rounds an exact tie up (0.125 -> '0.13', where Python prints '0.12').
 */
export function pyFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const field = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = field === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (field === 0 ? 1 : field) - 1075;
  // The value times 10^digits, rounded half to even. With a negative exponent the value is
  // mantissa * 5^k / 10^k exactly, so the rounding reads exact digits.
  let scaled: bigint;
  if (exponent >= 0) scaled = (mantissa << BigInt(exponent)) * 10n ** BigInt(digits);
  else {
    const k = BigInt(-exponent);
    const exact = mantissa * 5n ** k;
    const shift = k - BigInt(digits);
    if (shift <= 0n) scaled = exact * 10n ** -shift;
    else {
      const unit = 10n ** shift;
      scaled = exact / unit;
      const rest = exact % unit, half = unit / 2n;
      if (rest > half || (rest === half && scaled % 2n === 1n)) scaled += 1n;
    }
  }
  const text = scaled.toString().padStart(digits + 1, '0');
  return digits === 0 ? `${sign}${text}` : `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * `repr(x)` of a float: the shortest digits that read back as x, written plainly from 1e-4 up to 1e16
 * (always with a decimal point: '1.0') and as d.ddde+XX or d.ddde-XX outside it ('1e-05', '1e+16').
 */
export function pyRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mantissa, power] = Math.abs(x).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const point = Number(power) + 1;   // |x| = 0.DIGITS * 10^point
  if (point > -4 && point <= 16) {
    if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
    if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const exponent = point - 1;
  return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

/** A value Python held as a float. pyDumps prints a whole number as an int unless it is marked: 1.0, not 1. */
export class PyFloat {
  readonly value: number;
  constructor(value: number) { this.value = value; }
}

/** What pyDumps writes. An object's integer-like keys come first in JavaScript, so a ported record avoids them. */
export type PyJson = null | boolean | number | string | PyFloat | readonly PyJson[] | { readonly [key: string]: PyJson };

const pyString = (text: string) =>
  JSON.stringify(text).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const pyFloatJson = (x: number) => Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : pyRepr(x);

/**
 * `json.dumps(value)` with Python's defaults: ', ' and ': ' between items, every character outside space
 * to ~ escaped, a float as repr writes it. With indent, `json.dumps(value, indent=N)`: one item per line
 * and ',' at each line's end.
 */
export function pyDumps(value: PyJson, indent?: number): string {
  const write = (item: PyJson, level: number): string => {
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'string') return pyString(item);
    if (typeof item === 'number') return Number.isInteger(item) ? BigInt(item).toString() : pyFloatJson(item);
    if (item instanceof PyFloat) return pyFloatJson(item.value);
    const list = isList(item);
    const parts = list ? item.map(entry => write(entry, level + 1))
      : Object.entries(item).map(([key, entry]) => `${pyString(key)}: ${write(entry, level + 1)}`);
    const [open, close] = list ? ['[', ']'] : ['{', '}'];
    if (!parts.length) return open + close;
    if (indent === undefined) return open + parts.join(', ') + close;
    const pad = `\n${' '.repeat(indent * (level + 1))}`;
    return `${open}${pad}${parts.join(`,${pad}`)}\n${' '.repeat(indent * level)}${close}`;
  };
  return write(value, 0);
}

/** `str(Path(text))` on POSIX: repeated and trailing slashes and '.' parts dropped, two leading slashes kept, '' as '.'. */
export function pyPath(text: string): string {
  const lead = text.startsWith('//') && !text.startsWith('///') ? '//' : text.startsWith('/') ? '/' : '';
  return lead + text.split('/').filter(part => part !== '' && part !== '.').join('/') || '.';
}

// Python's whitespace (str.split, str.strip, float()): JavaScript's \s adds U+FEFF and lacks 0x1c-0x1f and NEL.
const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const FIELDS = new RegExp(`${WS}+`);
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `text.split()`: the fields between runs of Python's whitespace. */
export const pySplit = (text: string): string[] => text.split(FIELDS).filter(field => field !== '');

/** `text.splitlines()`: split at every line boundary Python knows, with no empty line after a final one. */
export function pySplitLines(text: string): string[] {
  const lines = text.split(LINE_BREAK);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const DIGITS = '\\d(?:_?\\d)*';
const PY_FLOAT = new RegExp(`^[ \\t\\n\\v\\f\\r]*([+-]?(?:(?:${DIGITS}(?:\\.(?:${DIGITS})?)?|\\.${DIGITS})(?:[eE][+-]?${DIGITS})?|inf(?:inity)?|nan))[ \\t\\n\\v\\f\\r]*$`, 'i');
const SPACE = new RegExp(`^${WS}$`);
const DECIMAL = /^\p{Nd}$/u;

/** A decimal digit's value: Unicode encodes each set of ten in order, so it is the count back to its run's start. */
function digitValue(char: string) {
  let code = char.codePointAt(0) ?? 0;
  let count = 0;
  while (DECIMAL.test(String.fromCodePoint(code - 1))) { code -= 1; count += 1; }
  return count % 10;
}

/**
 * `float(text)`: a decimal (underscores between digits), inf or nan, signed, with whitespace around; null
 * where Python raised ValueError. As CPython does, a character past ASCII is read first as a space or as an
 * ASCII digit, then the ASCII text is parsed: 0x1c-0x1f stay and are refused.
 */
export function pyFloat(text: string): number | null {
  const ascii = [...text].map(char => ((char.codePointAt(0) ?? 0) < 128 ? char : SPACE.test(char) ? ' '
    : DECIMAL.test(char) ? String(digitValue(char)) : char)).join('');
  const body = PY_FLOAT.exec(ascii)?.[1].toLowerCase().replace(/^\+/, '').replaceAll('_', '');
  if (body === undefined) return null;
  if (body.includes('inf')) return body.startsWith('-') ? -Infinity : Infinity;
  return body.includes('nan') ? NaN : Number(body);
}

/** `round(x)`: the nearest integer, an exact tie to the even one; null where Python raised (nan, inf). */
export function pyRound(x: number): number | null {
  if (!Number.isFinite(x)) return null;
  const floor = Math.floor(x);
  const rest = x - floor;
  return rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
}
