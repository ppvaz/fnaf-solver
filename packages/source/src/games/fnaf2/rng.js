// Seeded RNG so a run can be replayed, and so "worst luck" mode can pin every
// roll to the value that hurts most.
//
// [SOURCED: APK runtime decompile 2026-08-25 — jadx on base.apk classes.dex,
// RunLoop/CRun.java. Every event-sheet Random(N) goes through EXP_RANDOM →
// CRun.random(N): graine = (graine * 31415 + 1) mod 2^16, result
// (graine * N) >> 16. Seeding: no frame in application.ccn carries the seed
// chunk (13124), so m_wRandomSeed stays -1 and every frame load takes
// (short) System.currentTimeMillis() — 16 bits of wall clock, re-seeded each
// night start. The map splits the 65,536 states into 4 disjoint cycles of
// 16,384, so a night's luck has period 16,384 and there are only 65,536
// possible streams. `next()` returns graine/65536, an exact power-of-two
// float, which makes int(0, N-1) bit-exact to the source's Random(N) and
// chance(k/N) bit-exact to `Random(N) < k` for any event-sheet-sized N.]
export const RNG_MODULUS = 0x10000;
export const RNG_MASK = RNG_MODULUS - 1;
export const RNG_MULTIPLIER = 31415;
export const RNG_INCREMENT = 1;

export class Rng {
  constructor(seed = Date.now() >>> 0, worst = false) {
    this.seed = seed & RNG_MASK;
    this.state = this.seed;
    this.worst = worst;
  }
  next() {
    // Fusion's LCG (CRun.random). state * 31415 stays under 2^31, so plain
    // multiplication is exact.
    this.state = (this.state * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK;
    return this.state / RNG_MODULUS;
  }
  // chance(p): does this roll succeed? In worst-luck mode the animatronic
  // always gets what it wants.
  chance(p, worstIs = true) {
    const r = this.next() < p;
    return this.worst ? worstIs : r;
  }
  int(min, max, worstIs = null) {
    const v = min + Math.floor(this.next() * (max - min + 1));
    return this.worst && worstIs !== null ? worstIs : v;
  }
}
