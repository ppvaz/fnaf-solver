// The engine's `Every N` timer, shared by the FNaF 1, 3 and 4 Sims (it was a
// copy in each until 2026-09-30, and the duplication gate held the three
// together).
//
// `passEvery` (plant-model.ts, from the CND_EVERY2.eva2 decompile): the
// countdown **loads on the first reach and returns false that evaluation**,
// then counts down. So the first fire is one period after the load, not two.
// Consuming a period on the load instead pushes every first fire to 2N --
// which cost FNaF 3 a whole extra in-game hour and made its nights 420 s
// against the 360 s the clock groups state and the 240 s the handset measured
// on Night 1.
export class Every {
  declare period: number;
  declare acc: number;
  declare loaded: boolean;
  constructor(periodMs: number) { this.period = periodMs; this.acc = 0; this.loaded = false; }
  tick(ms: number) {
    if (!this.loaded) { this.loaded = true; this.acc = 0; return false; }
    this.acc += ms;
    if (this.acc >= this.period) { this.acc -= this.period; return true; }
    return false;
  }
}
