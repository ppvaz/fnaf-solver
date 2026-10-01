/**
 * The per-build object-handle scramble K, estimated by object-type agreement (Plan 26).
 *
 * The Android runtime XORs every item-table handle with K at load, and events address objects by
 * the post-XOR handle, so a dump read with the wrong K names every object after an unrelated one
 * -- and the map is a bijection, so the wrong answer still looks internally consistent. Every
 * condition and action row carries the object type it expects; the right K is the one under which
 * each row's handle, XORed back, lands on an item-table row of that type. Plan 26 measured it:
 * FNaF 1 K=0 and FNaF 2 K=28 reproduced at 1.0000 agreement, ~0.39 above the runner-up.
 *
 * What it cannot see: a K that permutes objects within one type class scores the same, which is
 * how FNaF 2's Toy/Withered swap survived review. The estimate is not a read of COI.loadHeader.
 */
import { QUALIFIER_BIT } from './engine.ts';
import type { Dump } from './dump.ts';

export const HANDLE_SCRAMBLE_METHOD = 'object-type agreement over every object-bound condition and action row (Plan 26)';
export const HANDLE_SCRAMBLE_LIMIT = 'the estimate is by object-type agreement, not a read of COI.loadHeader: a K that permutes ' +
  'objects within one type class scores the same (Plan 26), so a name is as good as the dump\'s own type classes';

const round = (value: number) => Math.round(value * 10000) / 10000;

export function estimateHandleScramble(dump: Dump): {method: string, rows: number, candidates: number, k: number | null, agreement: number | null, runnerUp: {k: number, agreement: number} | null, margin: number | null, ambiguous: boolean} {
  /** handle:type -> rows*/
  const cells: Map<string, number> = new Map();
  let maxHandle = 0;
  for (const frame of dump.frames)
    for (const group of frame.groups)
      for (const row of [...group.conditions, ...group.actions]) {
        if (row.objectType === null || row.objectType < 0 || row.handle === null || row.handle < 0 || row.handle & QUALIFIER_BIT) continue;
        const key = `${row.handle}:${row.objectType}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
        maxHandle = Math.max(maxHandle, row.handle);
      }
  for (const stored of dump.objects.keys()) maxHandle = Math.max(maxHandle, stored);
  const rows = [...cells.values()].reduce((sum, n) => sum + n, 0);
  // Every K that keeps some handle inside the table: handles and K share the table's bit width.
  const candidates = 2 ** Math.max(1, Math.ceil(Math.log2(maxHandle + 1)));
  if (!rows) return { method: HANDLE_SCRAMBLE_METHOD, rows, candidates, k: null, agreement: null, runnerUp: null, margin: null, ambiguous: true };
  const entries = [...cells].map(([key, n]) => { const [handle, type] = key.split(':').map(Number); return { handle, type, n }; });
  const scores = [];
  for (let k = 0; k < candidates; k += 1) {
    let agree = 0;
    for (const { handle, type, n } of entries) if (dump.objects.get(handle ^ k)?.type === type) agree += n;
    scores.push({ k, agree });
  }
  scores.sort((a, b) => b.agree - a.agree || a.k - b.k);
  const [best, next] = scores;
  return {
    method: HANDLE_SCRAMBLE_METHOD, rows, candidates, k: best.k, agreement: round(best.agree / rows),
    runnerUp: next ? { k: next.k, agreement: round(next.agree / rows) } : null,
    margin: next ? round((best.agree - next.agree) / rows) : null,
    ambiguous: best.agree === 0 || (next !== undefined && next.agree === best.agree),
  };
}
