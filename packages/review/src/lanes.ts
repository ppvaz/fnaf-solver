// The test lanes as data (tools/lanes.json): each lane's node test files, which tools/lanes.ts runs through
// `node --test`, then its other steps, each an argv or `['lane', name]` for a nested lane. Read here, and
// checked, by the runner and by what asks which files a lane runs (the S7 row, the gates, the push gate).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isList, isRecord } from '@sixam/kernel';

/** One lane: its node test files, then its other steps, each an argv or `['lane', name]`. */
export interface Lane { readonly node: readonly string[], readonly steps: readonly (readonly string[])[] }

const texts = (value: unknown): value is readonly string[] => isList(value) && value.every(item => typeof item === 'string' && item !== '');
const refuse = (message: string): never => { throw new Error(`tools/lanes.json: ${message}`); };

/** root's tools/lanes.json, refused unless each lane lists its files and steps and each nested lane exists. */
export function readLanes(root: string): Readonly<Record<string, Lane>> {
  const table: unknown = JSON.parse(readFileSync(join(root, 'tools', 'lanes.json'), 'utf8'));
  if (!isRecord(table)) return refuse('not an object of lanes');
  for (const [name, lane] of Object.entries(table)) {
    if (!isRecord(lane) || !texts(lane.node) || !isList(lane.steps)) return refuse(`lane ${name} needs node (files) and steps`);
    for (const step of lane.steps) {
      if (!texts(step) || !step.length) return refuse(`lane ${name} has a step that is not an argv: ${JSON.stringify(step)}`);
      if (step[0] === 'lane' && (step.length !== 2 || !Object.hasOwn(table, step[1])))
        return refuse(`lane ${name} runs no known lane: ${step.join(' ')}`);
    }
  }
  return table as unknown as Readonly<Record<string, Lane>>;
}
