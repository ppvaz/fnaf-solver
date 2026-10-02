/**
 * Numbers printed as Python prints them, for the scripts ported from Python (Pedro, 2026-10-02: unforced
 * Python is ported to TypeScript and switched only once its output matches). A record or report a ported
 * tool writes keeps the bytes its Python wrote, so the formatting moves with it.
 */

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
