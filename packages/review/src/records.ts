// Reading the JSON a pack or a record holds: text in, a checked object out, every field `unknown`
// until the reader narrows it. A typed annotation on JSON.parse checks nothing (CLAUDE.md, Types).
import { createHash } from 'node:crypto';
import { isList, isRecord } from '@sixam/kernel';

/** A JSON object whose fields the reader has not narrowed yet. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** The JSON object `text` holds, or a throw naming `name`. */
export function jsonObject(text: string, name: string): JsonObject {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`${name}: ${(error as Error).message}`); }
  if (!isRecord(value)) throw new Error(`${name}: not a JSON object`);
  return value;
}

/**
 * Each line of a JSONL text as a JSON object. A line that does not parse, or parses to anything
 * but an object, throws naming the file and the line: a row nobody can read is not skipped.
 */
export function jsonlRecords(text: string, name: string): JsonObject[] {
  return text.split('\n').flatMap((line, index) => (line.trim() ? [jsonObject(line, `${name} line ${index + 1}`)] : []));
}

/**
 * The same rows with the unreadable lines counted instead of thrown, for a reader whose verdict
 * names how many it could not read (a run killed mid-write leaves a torn last line).
 */
export function jsonlCounted(text: string) {
  let unparsable = 0;
  const rows = text.split('\n').flatMap((line): JsonObject[] => {
    if (!line.trim()) return [];
    try { return [jsonObject(line, 'line')]; } catch { unparsable += 1; return []; }
  });
  return { rows, unparsable };
}

/** `value` when it is a JSON object, else null. */
export const objectOrNull = (value: unknown): JsonObject | null => (isRecord(value) ? value : null);

/** `value` when it is a list, else an empty one. */
export const listOrEmpty = (value: unknown): readonly unknown[] => (isList(value) ? value : []);

/** `value` when it is a string, else null. */
export const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

/** The sha256 hex a record cites for the bytes it read. */
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
