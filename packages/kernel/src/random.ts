/**
 * mulberry32: a small seeded generator of floats in [0, 1), for a stream that
 * must stay off a game's own RNG (a lane's latency draws, a test's synthetic
 * frames). The same seed gives the same sequence on every host.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
