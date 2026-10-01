// Where a path that a frozen record cites lives now.
//
// A record keeps the path it was written with (ADR 0002 principle 9): a run
// pack, a chronicle entry or a dated history page is never edited when the
// file it names moves. Its readers follow the move instead, through git's own
// rename history plus the renames staged for the commit being made, so the
// link check and the chronicle keep resolving what the record meant without
// rewriting it. A path that was deleted, or never tracked, resolves to null
// and stays a failure.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const maps = new Map<string, Map<string, string>>();

function renames(root: string) {
  const known = maps.get(root);
  if (known) return known;
  const map = new Map<string, string>();
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = [
    ...git(['log', '--reverse', '-M', '--diff-filter=R', '--name-status', '--format=']).split('\n'),
    ...git(['diff', '--cached', '-M', '--diff-filter=R', '--name-status']).split('\n'),
  ];
  for (const line of lines) {
    const [status, from, to] = line.split('\t');
    if (status?.startsWith('R') && from && to) map.set(from, to);
  }
  maps.set(root, map);
  return map;
}

/** `path` (repository-relative) as the tree names it now: itself while it
 *  exists, else the end of its rename chain, else null. */
export function currentPath(root: string, path: string) {
  if (existsSync(join(root, path))) return path;
  const map = renames(root);
  const seen = new Set<string>();
  for (let at = path; map.has(at) && !seen.has(at);) {
    seen.add(at);
    at = map.get(at) as string;
    if (existsSync(join(root, at))) return at;
  }
  return null;
}
