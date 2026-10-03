/**
 * A WAV file read as Python 3.12's `wave` module reads it, for the scripts ported from Python (Pedro, 2026-10-02):
 * the RIFF/WAVE header, chunks skipped to the first `data` (an odd-sized chunk's pad byte included), a PCM or
 * WAVE_FORMAT_EXTENSIBLE PCM `fmt `, and `readframes(getnframes())`'s bytes. A file wave.open refuses is refused
 * here with its message, as PyWaveError for wave.Error and PyEOFError for EOFError.
 */

/** wave.Error. */
export class PyWaveError extends Error {}
/** EOFError, which wave.open lets through from a short `fmt ` chunk. */
export class PyEOFError extends Error {}

export interface PyWave { readonly channels: number, readonly sampwidth: number, readonly rate: number, readonly nframes: number, readonly frames: Uint8Array }

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
// KSDATAFORMAT_SUBTYPE_PCM, as wave.py spells it.
const SUBTYPE_PCM = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

/** wave.open(bytes).readframes(nframes) with its parameters. */
export function pyWave(bytes: Uint8Array): PyWave {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  // chunk.Chunk: a 4-byte id and a 4-byte little-endian size, else EOFError.
  const chunkAt = (at: number) => {
    if (at + 8 > bytes.length) return null;
    return { name: text(at, 4), size: view.getUint32(at + 4, true), body: at + 8 };
  };
  const riff = chunkAt(0);
  if (riff === null) throw new PyEOFError('');
  if (riff.name !== 'RIFF') throw new PyWaveError('file does not start with RIFF id');
  if (text(8, 4) !== 'WAVE') throw new PyWaveError('not a WAVE file');
  const riffEnd = Math.min(bytes.length, riff.body + riff.size);
  let format: { channels: number, rate: number, sampwidth: number } | null = null;
  let data: { body: number, size: number } | null = null;
  for (let at = 12; ;) {
    // The outer RIFF chunk bounds the inner ones, as Chunk(self._file) reads through it.
    const chunk = at + 8 <= riffEnd ? chunkAt(at) : null;
    if (chunk === null) break;
    const end = Math.min(chunk.body + chunk.size, riffEnd);
    const read = (offset: number, n: number) => {
      const from = chunk.body + offset;
      return bytes.subarray(Math.min(from, end), Math.min(from + n, end));
    };
    if (chunk.name === 'fmt ') {
      const head = read(0, 14);
      if (head.length < 14) throw new PyEOFError('');
      const fields = new DataView(head.buffer, head.byteOffset, head.byteLength);
      const tag = fields.getUint16(0, true);
      const channels = fields.getUint16(2, true), rate = fields.getUint32(4, true);
      if (tag !== WAVE_FORMAT_PCM && tag !== WAVE_FORMAT_EXTENSIBLE) throw new PyWaveError(`unknown format: ${tag}`);
      const width = read(14, 2);
      if (width.length < 2) throw new PyEOFError('');
      const bits = width[0] | (width[1] << 8);
      if (tag === WAVE_FORMAT_EXTENSIBLE) {
        if (read(16, 8).length < 8) throw new PyEOFError('');
        const subformat = read(24, 16);
        if (subformat.length < 16) throw new PyEOFError('');
        if (!SUBTYPE_PCM.every((byte, k) => subformat[k] === byte)) throw new PyWaveError(`unknown extended format: ${guid(subformat)}`);
      }
      const sampwidth = Math.floor((bits + 7) / 8);
      if (!sampwidth) throw new PyWaveError('bad sample width');
      if (!channels) throw new PyWaveError('bad # of channels');
      format = { channels, rate, sampwidth };
    } else if (chunk.name === 'data') {
      if (format === null) throw new PyWaveError('data chunk before fmt chunk');
      data = { body: chunk.body, size: chunk.size };
      break;
    }
    // Chunk.skip(): to the end of the chunk and its pad byte.
    at = chunk.body + chunk.size + (chunk.size & 1);
  }
  if (format === null || data === null) throw new PyWaveError('fmt chunk and/or data chunk missing');
  const framesize = format.channels * format.sampwidth;
  const nframes = Math.floor(data.size / framesize);
  const want = nframes * framesize;
  const stop = Math.min(data.body + Math.min(want, data.size), riffEnd, bytes.length);
  return { ...format, nframes, frames: bytes.subarray(data.body, Math.max(data.body, stop)) };
}

/** uuid.UUID(bytes_le=...) as str() writes it. */
function guid(bytes: Uint8Array) {
  const hex = (from: number, to: number, reverse: boolean) => {
    const part = [...bytes.subarray(from, to)];
    return (reverse ? part.reverse() : part).map(byte => byte.toString(16).padStart(2, '0')).join('');
  };
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`;
}
