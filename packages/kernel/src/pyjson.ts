/**
 * JSON read as Python's json.loads read it, for the scripts ported from Python (Pedro, 2026-10-02): an int stays
 * an int (a bigint, any size) and a float a PyFloat, so a value read and written back keeps its bytes; an
 * object keeps its keys in order (a Map: a JavaScript object puts integer-like keys first); NaN, Infinity and
 * -Infinity are read; and malformed text is refused with the JSONDecodeError message CPython's C scanner
 * (Modules/_json.c) gives, positions counted in code points.
 */
import { PyFloat, pyRepr } from './pyfmt.ts';

/** What json.loads returns. */
export type PyValue = null | boolean | bigint | PyFloat | string | readonly PyValue[] | ReadonlyMap<string, PyValue>;

/** json.JSONDecodeError: its str() is the message with the line, column and char of the position. */
export class PyJsonError extends Error {
  constructor(message: string, codePoints: readonly string[], position: number) {
    const before = codePoints.slice(0, position);
    const line = before.filter(char => char === '\n').length + 1;
    const lastBreak = before.lastIndexOf('\n');
    super(`${message}: line ${line} column ${position - lastBreak} (char ${position})`);
  }
}

// int() refuses a decimal string longer than sys.get_int_max_str_digits(), 4300 by default.
const INT_MAX_STR_DIGITS = 4300;

class Expecting {
  readonly at: number;
  constructor(at: number) { this.at = at; }
}

/** json.loads(text). Throws PyJsonError as JSONDecodeError would raise, or Error where int() raised. */
export function pyLoads(text: string): PyValue {
  const s = [...text];
  if (s[0] === '\ufeff') throw new PyJsonError('Unexpected UTF-8 BOM (decode using utf-8-sig)', s, 0);
  const len = s.length;
  const end = len - 1;
  const white = (k: number) => { while (k <= end && ' \t\n\r'.includes(s[k])) k += 1; return k; };
  const isDigit = (k: number) => k <= end && s[k] >= '0' && s[k] <= '9';

  function scanString(start: number): [string, number] {
    const begin = start - 1;
    const chunks: string[] = [];
    let at = start;
    for (;;) {
      let next = at;
      let c = '';
      for (; next < len; next += 1) {
        c = s[next];
        if (c === '"' || c === '\\') break;
        if ((c.codePointAt(0) ?? 0) <= 0x1f) throw new PyJsonError('Invalid control character at', s, next);
      }
      if (next >= len || (c !== '"' && c !== '\\')) throw new PyJsonError('Unterminated string starting at', s, begin);
      chunks.push(s.slice(at, next).join(''));
      next += 1;
      if (c === '"') return [chunks.join(''), next];
      if (next === len) throw new PyJsonError('Unterminated string starting at', s, begin);
      const escape = s[next];
      if (escape !== 'u') {
        at = next + 1;
        const plain: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        const char = plain[escape];
        if (char === undefined) throw new PyJsonError('Invalid \\escape', s, at - 2);
        chunks.push(char);
        continue;
      }
      next += 1;
      at = next + 4;
      if (at >= len) throw new PyJsonError('Invalid \\uXXXX escape', s, next - 1);
      const hex = (from: number, stop: number) => {
        let value = 0;
        for (let k = from; k < stop; k += 1) {
          if (!/^[0-9a-fA-F]$/.test(s[k])) throw new PyJsonError('Invalid \\uXXXX escape', s, stop - 5);
          value = value * 16 + parseInt(s[k], 16);
        }
        return value;
      };
      let unit = hex(next, at);
      if (unit >= 0xd800 && unit <= 0xdbff && at + 6 < len && s[at] === '\\' && s[at + 1] === 'u') {
        const low = hex(at + 2, at + 6);
        if (low >= 0xdc00 && low <= 0xdfff) {
          unit = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
          at += 6;
        }
      }
      chunks.push(String.fromCodePoint(unit));
    }
  }

  function scanNumber(start: number): [PyValue, number] {
    let k = start;
    if (s[k] === '-') {
      k += 1;
      if (k > end) throw new Expecting(start);
    }
    if (s[k] >= '1' && s[k] <= '9') {
      k += 1;
      while (isDigit(k)) k += 1;
    } else if (s[k] === '0') k += 1;
    else throw new Expecting(start);
    let isFloat = false;
    if (k < end && s[k] === '.' && s[k + 1] >= '0' && s[k + 1] <= '9') {
      isFloat = true;
      k += 2;
      while (isDigit(k)) k += 1;
    }
    if (k < end && (s[k] === 'e' || s[k] === 'E')) {
      const eStart = k;
      k += 1;
      if (k < end && (s[k] === '-' || s[k] === '+')) k += 1;
      while (isDigit(k)) k += 1;
      if (s[k - 1] >= '0' && s[k - 1] <= '9') isFloat = true;
      else k = eStart;
    }
    const text = s.slice(start, k).join('');
    if (isFloat) return [new PyFloat(Number(text)), k];
    const digits = text.replace('-', '').length;
    if (digits > INT_MAX_STR_DIGITS)
      throw new Error(`Exceeds the limit (${INT_MAX_STR_DIGITS} digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`);
    return [BigInt(text), k];
  }

  const word = (k: number, w: string) => k + w.length - 1 <= end && s.slice(k, k + w.length).join('') === w;

  function scanOnce(k: number): [PyValue, number] {
    if (k > end) throw new Expecting(k);
    switch (s[k]) {
      case '"': return scanString(k + 1);
      case '{': return scanObject(k + 1);
      case '[': return scanArray(k + 1);
      case 'n': if (word(k, 'null')) return [null, k + 4]; break;
      case 't': if (word(k, 'true')) return [true, k + 4]; break;
      case 'f': if (word(k, 'false')) return [false, k + 5]; break;
      case 'N': if (word(k, 'NaN')) return [new PyFloat(NaN), k + 3]; break;
      case 'I': if (word(k, 'Infinity')) return [new PyFloat(Infinity), k + 8]; break;
      case '-': if (word(k, '-Infinity')) return [new PyFloat(-Infinity), k + 9]; break;
    }
    return scanNumber(k);
  }

  function scanObject(start: number): [PyValue, number] {
    const pairs = new Map<string, PyValue>();
    let k = white(start);
    if (k > end || s[k] !== '}') {
      for (;;) {
        if (k > end || s[k] !== '"') throw new PyJsonError('Expecting property name enclosed in double quotes', s, k);
        const [key, afterKey] = scanString(k + 1);
        k = white(afterKey);
        if (k > end || s[k] !== ':') throw new PyJsonError("Expecting ':' delimiter", s, k);
        k = white(k + 1);
        const [value, afterValue] = scanOnce(k);
        pairs.set(key, value);
        k = white(afterValue);
        if (k <= end && s[k] === '}') break;
        if (k > end || s[k] !== ',') throw new PyJsonError("Expecting ',' delimiter", s, k);
        k = white(k + 1);
      }
    }
    return [pairs, k + 1];
  }

  function scanArray(start: number): [PyValue, number] {
    const items: PyValue[] = [];
    let k = white(start);
    if (k > end || s[k] !== ']') {
      for (;;) {
        const [value, after] = scanOnce(k);
        items.push(value);
        k = white(after);
        if (k <= end && s[k] === ']') break;
        if (k > end || s[k] !== ',') throw new PyJsonError("Expecting ',' delimiter", s, k);
        k = white(k + 1);
      }
    }
    return [items, k + 1];
  }

  let value: PyValue, at: number;
  try {
    [value, at] = scanOnce(white(0));
  } catch (error) {
    if (error instanceof Expecting) throw new PyJsonError('Expecting value', s, error.at);
    throw error;
  }
  at = white(at);
  if (at !== len) throw new PyJsonError('Extra data', s, at);
  return value;
}

/** Python's printable test: not a control, format, surrogate, private, unassigned or separator character. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** repr(text) for a str. */
export function pyStrRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === quote || char === '\\') out += `\\${char}`;
    else if (char === '\t') out += '\\t';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else if (code < 0x7f || !UNPRINTABLE.test(char)) out += char;
    else if (code <= 0xff) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else if (code <= 0xffff) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += `\\U${code.toString(16).padStart(8, '0')}`;
  }
  return out + quote;
}

/** repr(value) for what json.loads returns (and a plain number, read as a float when it is not whole). */
export function pyReprOf(value: PyValue | number): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? BigInt(value).toString() : pyRepr(value);
  if (value instanceof PyFloat) return pyRepr(value.value);
  if (typeof value === 'string') return pyStrRepr(value);
  if (value instanceof Map) return `{${[...value].map(([key, item]) => `${pyStrRepr(key)}: ${pyReprOf(item)}`).join(', ')}}`;
  return `[${(value as readonly PyValue[]).map(pyReprOf).join(', ')}]`;
}

/** CPython's UTF-8 decoder with errors='surrogatepass': the text, or the UnicodeDecodeError's message for the first bad sequence. */
function utf8(bytes: Uint8Array): string {
  let out = '';
  const fail = (start: number, stop: number, reason: string): never => {
    throw new Error(stop - start === 1
      ? `'utf-8' codec can't decode byte 0x${bytes[start].toString(16).padStart(2, '0')} in position ${start}: ${reason}`
      : `'utf-8' codec can't decode bytes in position ${start}-${stop - 1}: ${reason}`);
  };
  for (let k = 0; k < bytes.length;) {
    const lead = bytes[k];
    if (lead < 0x80) { out += String.fromCharCode(lead); k += 1; continue; }
    const size = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
    if (!size) fail(k, k + 1, 'invalid start byte');
    // The second byte's range depends on the lead (no overlongs, no code points past U+10FFFF); a surrogate
    // (ED A0-BF) is let through, as surrogatepass does.
    const [low, high] = lead === 0xe0 ? [0xa0, 0xbf] : lead === 0xf0 ? [0x90, 0xbf] : lead === 0xf4 ? [0x80, 0x8f] : [0x80, 0xbf];
    let n = 1;
    for (; n < size; n += 1) {
      if (k + n >= bytes.length) fail(k, bytes.length, 'unexpected end of data');
      const byte = bytes[k + n];
      if (n === 1 ? byte < low || byte > high : byte < 0x80 || byte > 0xbf) fail(k, k + n, 'invalid continuation byte');
    }
    let code = lead & (0xff >> (size + 1));
    for (let m = 1; m < size; m += 1) code = (code << 6) | (bytes[k + m] & 0x3f);
    out += String.fromCodePoint(code);
    k += size;
  }
  return out;
}

/** json.loads(bytes): the encoding detected as json.detect_encoding does, decoded with errors='surrogatepass', then read. */
export function pyLoadsBytes(bytes: Uint8Array): PyValue {
  const starts = (...prefix: number[]) => prefix.every((byte, k) => bytes[k] === byte);
  let encoding: string;
  if (starts(0x00, 0x00, 0xfe, 0xff) || starts(0xff, 0xfe, 0x00, 0x00)) encoding = 'utf-32';
  else if (starts(0xfe, 0xff) || starts(0xff, 0xfe)) encoding = 'utf-16';
  else if (starts(0xef, 0xbb, 0xbf)) encoding = 'utf-8-sig';
  else if (bytes.length >= 4 && !bytes[0]) encoding = bytes[1] ? 'utf-16-be' : 'utf-32-be';
  else if (bytes.length >= 4 && !bytes[1]) encoding = bytes[2] || bytes[3] ? 'utf-16-le' : 'utf-32-le';
  else if (bytes.length === 2 && !bytes[0]) encoding = 'utf-16-be';
  else if (bytes.length === 2 && !bytes[1]) encoding = 'utf-16-le';
  else encoding = 'utf-8';
  if (encoding === 'utf-8') return pyLoads(utf8(bytes));
  if (encoding === 'utf-8-sig') return pyLoads(utf8(bytes.subarray(3)));
  // UTF-16 and UTF-32 bodies: decoded leniently; Python's codec messages for a broken one are not reproduced.
  const label = encoding.startsWith('utf-32') ? null : encoding === 'utf-16' ? (bytes[0] === 0xff ? 'utf-16le' : 'utf-16be') : encoding.replace('utf-16-', 'utf-16');
  if (label) return pyLoads(new TextDecoder(label, { ignoreBOM: false }).decode(bytes));
  const big = encoding === 'utf-32-be' || (encoding === 'utf-32' && bytes[0] === 0x00);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text = '';
  for (let k = encoding === 'utf-32' ? 4 : 0; k + 4 <= bytes.length; k += 4) text += String.fromCodePoint(view.getUint32(k, !big));
  return pyLoads(text);
}
