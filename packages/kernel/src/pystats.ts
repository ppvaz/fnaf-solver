/**
 * Python's csv reader and statistics, for the scripts ported from Python (Pedro, 2026-10-02): a CSV read as
 * csv.reader (excel dialect, not strict) reads it, and statistics.median and statistics.pstdev computed as
 * CPython computes them, pstdev exactly over rationals and then correctly rounded.
 */

/** csv.Error, as _csv.c raises it. */
export class PyCsvError extends Error {}

const FIELD_LIMIT = 131072;

/**
 * csv.reader(io.StringIO(text)) with the excel dialect: each record's fields, as _csv.c's state machine reads
 * them. Lines end after each '\n' (StringIO's own split); after every line the reader sees an end-of-line, so a
 * quoted field may run on, and a '\r' left in an unquoted field is refused.
 */
export function pyCsvRows(text: string): string[][] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const rows: string[][] = [];
  type State = 'start-record' | 'start-field' | 'in-field' | 'in-quoted' | 'quote-in-quoted' | 'eat-crnl';
  const scanner: { state: State } = { state: 'start-record' };
  let fields: string[] = [];
  let field = '';
  let fieldLen = 0;
  const save = () => { fields.push(field); field = ''; fieldLen = 0; };
  const add = (char: string) => {
    if (fieldLen >= FIELD_LIMIT) throw new PyCsvError(`field larger than field limit (${FIELD_LIMIT})`);
    field += char;
    fieldLen += 1;
  };
  const EOL = null;
  const process = (c: string | null) => {
    switch (scanner.state) {
      case 'start-record':
        if (c === EOL) return;
        if (c === '\n' || c === '\r') { scanner.state = 'eat-crnl'; return; }
        scanner.state = 'start-field';
      // falls through
      case 'start-field':
        if (c === '\n' || c === '\r' || c === EOL) { save(); scanner.state = c === EOL ? 'start-record' : 'eat-crnl'; }
        else if (c === '"') scanner.state = 'in-quoted';
        else if (c === ',') save();
        else { add(c); scanner.state = 'in-field'; }
        return;
      case 'in-field':
        if (c === '\n' || c === '\r' || c === EOL) { save(); scanner.state = c === EOL ? 'start-record' : 'eat-crnl'; }
        else if (c === ',') { save(); scanner.state = 'start-field'; }
        else add(c);
        return;
      case 'in-quoted':
        if (c === EOL) return;
        if (c === '"') scanner.state = 'quote-in-quoted';
        else add(c);
        return;
      case 'quote-in-quoted':
        if (c === '"') { add(c); scanner.state = 'in-quoted'; }
        else if (c === ',') { save(); scanner.state = 'start-field'; }
        else if (c === '\n' || c === '\r' || c === EOL) { save(); scanner.state = c === EOL ? 'start-record' : 'eat-crnl'; }
        else { add(c); scanner.state = 'in-field'; }
        return;
      case 'eat-crnl':
        if (c === '\n' || c === '\r') return;
        if (c === EOL) { scanner.state = 'start-record'; return; }
        throw new PyCsvError("new-line character seen in unquoted field - do you need to open the file with newline=''?");
    }
  };
  let k = 0;
  while (k < lines.length) {
    // One record: lines until the state machine is back at the start of a record.
    do {
      if (k >= lines.length) {
        if (fieldLen !== 0 || scanner.state === 'in-quoted') { save(); scanner.state = 'start-record'; break; }
        return rows;
      }
      for (const c of lines[k]) process(c);
      process(EOL);
      k += 1;
    } while (scanner.state !== 'start-record');
    rows.push(fields);
    fields = [];
  }
  return rows;
}

/**
 * csv.DictReader over the text: the first record names the fields (even an empty one); a later empty record is
 * skipped; a short record's missing fields are null, and a long one's extras are listed under the key null.
 */
export function pyCsvDicts(text: string): { fieldnames: string[] | null, rows: Map<string | null, string | null | string[]>[] } {
  const records = pyCsvRows(text);
  if (!records.length) return { fieldnames: null, rows: [] };
  const [names, ...rest] = records;
  return {
    fieldnames: names,
    rows: rest.filter(record => record.length > 0).map(record => {
      const row = new Map<string | null, string | null | string[]>(names.map((name, k) => [name, k < record.length ? record[k] : null]));
      if (record.length > names.length) row.set(null, record.slice(names.length));
      return row;
    }),
  };
}

/** statistics.median: the middle value of the sorted data (an int stays an int), or the mean of the two middle ones. */
export function pyMedian(values: readonly (bigint | number)[]): bigint | number {
  if (!values.length) throw new Error('no median for empty data');
  const ordered = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = ordered.length, mid = n >> 1;
  if (n % 2) return ordered[mid];
  const [a, b] = [ordered[mid - 1], ordered[mid]];
  // int + int stays exact and /2 rounds once; a float on either side makes the sum a float.
  if (typeof a === 'bigint' && typeof b === 'bigint') return Number(a + b) / 2;
  return (Number(a) + Number(b)) / 2;
}

/** A finite double as its exact ratio n/d (float.as_integer_ratio, not reduced). */
function ratio(x: number): [bigint, bigint] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const field = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = field === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (field === 0 ? 1 : field) - 1075;
  return exponent >= 0 ? [sign * (mantissa << BigInt(exponent)), 1n] : [sign * mantissa, 1n << BigInt(-exponent)];
}

const bitLength = (n: bigint) => (n === 0n ? 0 : n.toString(2).length);
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((bitLength(n) + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** statistics._float_sqrt_of_frac: sqrt(n/m) correctly rounded, through round-to-odd integer roots. */
function sqrtOfFrac(n: bigint, m: bigint): number {
  const SQRT_BIT_WIDTH = 2 * 53 + 3;
  const rto = (a: bigint, b: bigint) => { const root = isqrt(a / b); return root | (root * root * b !== a ? 1n : 0n); };
  const q = Math.floor((bitLength(n) - bitLength(m) - SQRT_BIT_WIDTH) / 2);
  if (q >= 0) return Number(rto(n, m << BigInt(2 * q)) << BigInt(q));
  // numerator / 2**-q: the integer converts to the nearest double, and a power of two scales it exactly.
  return Number(rto(n << BigInt(-2 * q), m)) / 2 ** -q;
}

/** statistics.pstdev of finite values: the population deviation, exact over rationals, then correctly rounded. */
export function pyPstdev(values: readonly (bigint | number)[]): number {
  if (!values.length) throw new Error('pstdev requires at least one data point');
  // sx = sum(n/d), sxx = sum(n^2/d^2), over a common denominator kept as a running product.
  let sxN = 0n, sxD = 1n, sxxN = 0n, sxxD = 1n;
  for (const value of values) {
    const [n, d] = typeof value === 'bigint' ? [value, 1n] : ratio(value);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('pstdev of a non-finite value');
    [sxN, sxD] = [sxN * d + n * sxD, sxD * d];
    [sxxN, sxxD] = [sxxN * d * d + n * n * sxxD, sxxD * d * d];
  }
  const count = BigInt(values.length);
  // ssd = (count * sxx - sx * sx) / count; mss = ssd / count
  const num = count * sxxN * sxD * sxD - sxN * sxN * sxxD;
  const den = sxxD * sxD * sxD * count * count;
  return sqrtOfFrac(num < 0n ? 0n : num, den);
}
