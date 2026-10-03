// What game-builds.ts and sound-map.ts share: files read as Python's open(), glob() and json.load() read them, and a
// file's sha256.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type PyValue, pyDecodeUtf8, pyLoads, pyReadText } from '@sixam/kernel/py';

/** A file's sha256 (hashlib over its bytes). */
export const fileSha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** open(path, errors=errors).read(). */
export const readText = (path: string, errors: 'strict' | 'replace' = 'strict') => pyReadText(readFileSync(path), errors);

/** `for line in open(path, errors=errors)`: each line with its newline, the last without one if the file has none. */
export const readLines = (path: string, errors: 'strict' | 'replace' = 'strict') => readText(path, errors).match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** json.load(open(path)). */
export const readJson = (path: string): PyValue => pyLoads(pyDecodeUtf8(readFileSync(path)));

/** glob(join(directory, `${prefix}*${suffix}`)) in the directory's own order, hidden names left out; a name must
 *  also pass `test` where the pattern holds more than one star's worth (a character class, say). */
export function globNames(directory: string, prefix: string, suffix: string, test: (name: string) => boolean = () => true): string[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names.filter(name => !name.startsWith('.') && name.length >= prefix.length + suffix.length && name.startsWith(prefix)
    && name.endsWith(suffix) && test(name)).map(name => join(directory, name));
}
