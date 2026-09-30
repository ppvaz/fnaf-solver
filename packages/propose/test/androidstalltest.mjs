// Controlled mechanism test for the owned Android build's camera behavior.
// It runs the shipped Minus 7 schedule under four models:
//   sourced  = post-XOR Android decode (engine defaults): 400-frame flash
//              stun from `stun time` + Withered/Mangle marker hold
//   legacy   = trainer's historical 400-frame flash/look timers, no gate
//   none     = every camera stall mechanism removed
//   gateonly = marker hold alone (the disproved pre-XOR "gate replaces the
//              timer" hypothesis, kept as a control)
import { run } from '../parked/minus7/reactive-pilot.mjs';

const SEED = i => (i * 2246822519) >>> 0;
const models = {
  sourced: {},
  legacy: {
    passiveWitheredLookStunFrames: 400,
    selectedCameraGate: false,
  },
  none: {
    cameraLightStunFrames: 0,
    passiveWitheredLookStunFrames: 0,
    selectedCameraGate: false,
  },
  gateonly: {
    cameraLightStunFrames: 0,
    passiveWitheredLookStunFrames: 0,
    selectedCameraGate: true,
  },
};

function sweep(model, worst, n) {
  const deaths = new Map();
  let won = 0;
  for (let i = 0; i < n; i++) {
    const { sim } = run({ ...model, seed: SEED(i), worst });
    if (sim.won) won++;
    else deaths.set(sim.death?.reason ?? 'unknown',
      (deaths.get(sim.death?.reason ?? 'unknown') ?? 0) + 1);
  }
  return { won, deaths: [...deaths.entries()].sort((a, b) => b[1] - a[1]) };
}

for (const [name, model] of Object.entries(models)) {
  const normal = sweep(model, false, 200);
  const worst = sweep(model, true, 100);
  console.log(`${name.padEnd(8)} normal ${normal.won}/200  worst ${worst.won}/100`);
  if (normal.won < 200) console.log(`         deaths ${normal.deaths.map(x => x.join(':')).join(', ')}`);
}
