// pyWave against Python 3.12's wave module: each expected value below is what wave.open gave for the same bytes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PyWaveError, pyWave } from '../src/pywave.ts';

test('a WAV file reads as the wave module reads it', () => {
  // PCM, two channels at 8 kHz, an odd-sized LIST chunk with its pad byte skipped, and ten data bytes: two frames.
  const pcm = pyWave(Buffer.from('524946463a00000057415645666d74201000000001000200401f0000007d0000040010004c4953540300000061626300'
    + '646174610a00000000010203040506070809', 'hex'));
  assert.deepEqual([pcm.channels, pcm.sampwidth, pcm.rate, pcm.nframes, Buffer.from(pcm.frames).toString('hex')], [2, 2, 8000, 2, '0001020304050607']);
  // WAVE_FORMAT_EXTENSIBLE with a float subformat is refused with the GUID wave names.
  assert.throws(() => pyWave(Buffer.from('524946463e00000057415645666d742028000000feff0100401f0000803e00000200100016001000040000000300000000001000'
    + '800000aa00389b7164617461020000000000', 'hex')), (error: Error) => error instanceof PyWaveError
    && error.message === 'unknown extended format: 00000003-0000-0010-8000-00aa00389b71');
});
