// The edge of a timing basin around zero, and whether it is one (CLAUDE.md mistake register item 11).
//
// A margin scan that steps outward and stops at its first failure reports a budget only when the basin is
// contiguous. On 2026-09-11 such a scan reported a "408 ms cliff" for a phase response that is banded and
// periodic, condemning a 1320 ms run the model scores 3000/3000; phase-reconstruct.mjs already reported the
// loss bands. So the scan does not stop: past the first failure it keeps stepping, and when the response
// clears again the edge is reported as banded, not as a number.
//
//   scanEdge(clears, { step, max }) -> { edge, capped, resumesAt }
//     edge       the largest k (a multiple of step, 0..max) such that every step in (0, k] clears
//     capped     no step up to max failed: the budget is at least `edge`, the scan's own limit
//     resumesAt  the first step past the first failure that clears again, or null: non-null means the
//                response is banded and `edge` is one band's edge (read the loss bands instead)
//   formatEdge(result) -> "264", ">=264" or "99|banded@231"

export function scanEdge(clears, { step, max }) {
  if (!(step > 0) || !(max >= step)) throw new RangeError(`scanEdge needs 0 < step <= max (step ${step}, max ${max})`);
  let edge = 0;
  let failed = false;
  let resumesAt = null;
  for (let k = step; k <= max; k += step) {
    const ok = clears(k);
    if (!failed) {
      if (ok) edge = k;
      else failed = true;
    } else if (ok) {
      resumesAt = k;
      break;
    }
  }
  return { edge, capped: !failed, resumesAt };
}

export function formatEdge({ edge, capped, resumesAt }) {
  if (resumesAt !== null) return `${edge}|banded@${resumesAt}`;
  return capped ? `>=${edge}` : String(edge);
}
