// Headless check: drive a "perfect player" through the Minus 7 cycle and see
// whether the simulation's economics actually work out over a full night.
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

// Regression for the sourced hop gates: a fresh successful movement roll must
// wait behind a closed gate just like an already-stunned pending move. This was
// easy to miss because the retry path and the initial-roll path are separate.
{
  const gate = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 1, worst: true, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const wbGate = gate.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  wbGate.idx = wbGate.path.length - 2; // CAM 05 -> left opening requires cams up
  gate.frame = C.MO_FRAMES;
  gate.onFiveSecond();
  if (wbGate.atOpening || !wbGate.pending)
    throw new Error('closed cams-up entry gate did not retain W. Bonnie as pending');
  gate.monitor = 'up';
  gate.tickUnits(gate.frame);
  if (!wbGate.atOpening || wbGate.pending)
    throw new Error('pending W. Bonnie did not advance when the cams-up gate opened');

  // A short office-light tap latches through the next global second tick, but
  // only blocks the route edges that test `viewing hall light` = 0 in the
  // source.
  const lightGate = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 3, worst: true, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const litWb = lightGate.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  litWb.idx = 1; // source CAM 07 -> hall stage 1 (g381) is light-gated
  lightGate.press('light'); lightGate.tick(); lightGate.release('light');
  litWb.pending = true;
  lightGate.tickUnits(lightGate.frame);
  if (!litWb.pending || litWb.idx !== 1)
    throw new Error('W. Bonnie crossed a sourced light-gated edge while latch was active');
  while (lightGate.frame < C.FPS) lightGate.tick();
  if (litWb.pending || (litWb.idx as number) !== 2)   // the ticks above move him
    throw new Error('W. Bonnie did not cross after the office-light latch cleared');

  const ungated = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 4, worst: true, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const lateWb = ungated.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  lateWb.idx = 3; lateWb.pending = true; // CAM 01 -> CAM 05 (g383) has no light gate
  ungated.press('light'); ungated.tick(); ungated.release('light');
  ungated.tickUnits(ungated.frame);
  if (lateWb.pending || lateWb.idx !== 4)
    throw new Error('office light incorrectly blocked an ungated W. Bonnie edge');

  const ventLight = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 5, worst: true, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, record: false });
  const ventWb = ventLight.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  ventWb.idx = 1; ventWb.pending = true;
  ventLight.press('ventR'); ventLight.tick(); ventLight.release('ventR');
  if (!ventWb.pending)
    throw new Error('right vent light did not share the sourced light latch');
  // Only `lit?` drains the battery (g284); vent lights are free.
  if (ventLight.power !== C.POWER_FRAMES)
    throw new Error('vent light incorrectly drained the sourced battery counter');

  const threshold = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 6, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const tc = threshold.units.find(u => u.id === 'toychica') as C.Unit;   // one of the seven route units
  tc.idx = tc.path.length - 1; tc.atOpening = true;
  threshold.press('mask');
  if (!tc.atOpening)
    throw new Error('Toy Chica incorrectly received an immediate marker-122 mask repel');
  threshold.maskAnim = 0;
  for (let n = 1; n <= 5; n++) {
    threshold.frame = n * C.FPS;
    threshold.tickUnits(threshold.frame);
  }
  if (tc.atOpening || tc.idx !== 1 || tc.path[tc.idx] !== 7)
    throw new Error('five sourced Toy Chica mask ticks did not return her to CAM 07');

  const maskedArrival = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 7, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const arrivingTc = maskedArrival.units.find(u => u.id === 'toychica') as C.Unit;   // one of the seven route units
  arrivingTc.idx = arrivingTc.path.length - 2;
  maskedArrival.press('mask');
  maskedArrival.advanceUnit(arrivingTc);
  if (!arrivingTc.atOpening)
    throw new Error('mask already on incorrectly erased a newly arrived threshold attacker');

  const tbCue = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 1, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const cueTb = tbCue.units.find(u => u.id === 'toybonnie') as C.Unit;   // one of the seven route units
  cueTb.idx = cueTb.path.length - 1; cueTb.atOpening = true;
  cueTb.stunUntil = C.s(5); // his B opening timer, still draining
  tbCue.press('mask');
  if (!cueTb.atOpening)
    throw new Error('mask directly repelled Toy Bonnie before his office cue existed');
  tbCue.maskAnim = 0;
  tbCue.frame = C.TOY_BONNIE_CUE_FRAMES;
  tbCue.tickUnits(tbCue.frame);
  if (!cueTb.atOpening || !tbCue.blackout.active || tbCue.blackout.unitId !== 'toybonnie')
    throw new Error('Toy Bonnie mask cue did not start the sourced office sequence');

  const streakEncounter = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 8, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const encounterWb = streakEncounter.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  encounterWb.idx = encounterWb.path.length - 1; encounterWb.atOpening = true;
  streakEncounter.tickUnits(0);
  if (!streakEncounter.blackout.active || streakEncounter.blackout.unitId !== 'withbonnie')
    throw new Error('cams-down W. Bonnie did not start the shared office sequence');
  streakEncounter.press('mask');
  while (streakEncounter.frame < C.BLACKOUT_FRAMES) streakEncounter.tick();
  if (!streakEncounter.alive || encounterWb.atOpening || streakEncounter.blackout.active)
    throw new Error('timely fully-on mask did not survive and resolve the office sequence');

  const missedEncounter = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 9, worst: true, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const missedWb = missedEncounter.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  for (const u of missedEncounter.units) if (u !== missedWb) u.done = true;
  missedWb.idx = missedWb.path.length - 1; missedWb.atOpening = true;
  missedEncounter.tickUnits(0);
  while (missedEncounter.alive && missedEncounter.frame < C.BLACKOUT_FRAMES)
    missedEncounter.tick();
  if (!missedEncounter.alive || !missedWb.inside || missedWb.atOpening)
    throw new Error('missed 45-frame fuse did not send the attacker to marker 123');
  missedEncounter.press('mask');
  while (missedEncounter.alive && missedEncounter.frame < C.BLACKOUT_FRAMES + C.FPS * 2)
    missedEncounter.tick();
  if (missedEncounter.alive || missedEncounter.death?.reason !== 'inside-office')
    throw new Error('marker-123 mask roll did not start the sourced 40-frame attack');

  const fuseEdge = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 10, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const edgeWb = fuseEdge.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  edgeWb.idx = edgeWb.path.length - 1; edgeWb.atOpening = true;
  fuseEdge.tickUnits(0);
  while (fuseEdge.frame < C.maskGraceFrames(7) - C.MASK_ANIM_ON) fuseEdge.tick();
  fuseEdge.press('mask'); // becomes fully on exactly as group 532 arms the attack
  while (fuseEdge.alive && fuseEdge.frame < C.BLACKOUT_FRAMES) fuseEdge.tick();
  if (!fuseEdge.alive || !edgeWb.inside)
    throw new Error('mask completion on the fuse-expiry frame incorrectly defused the encounter');

  const endgame = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 2, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const armedTb = endgame.units.find(u => u.id === 'toybonnie') as C.Unit;   // one of the seven route units
  armedTb.idx = armedTb.path.length - 1; armedTb.atOpening = true; armedTb.stunUntil = 0;
  endgame.monitor = 'up'; endgame.camsUpSince = endgame.frame;
  endgame.tickUnits(endgame.frame);
  if (!endgame.alive || !armedTb.inside)
    throw new Error('armed Toy Bonnie incorrectly received the shared cams-up streak grace');
  endgame.setMonitor(false);
  while (endgame.alive && endgame.frame < C.INSIDE_ATTACK_FRAMES) endgame.tick();
  if (endgame.alive || endgame.death?.reason !== 'inside-office')
    throw new Error('Toy Bonnie at marker 123 did not attack on monitor lowering');

  const mangleRaise = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 11, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const mg = mangleRaise.units.find(u => u.id === 'mangle') as C.Unit;   // one of the seven route units
  for (const u of mangleRaise.units) if (u !== mg) u.done = true;
  mg.idx = mg.path.length - 1; mg.atOpening = true;
  mangleRaise.setMonitor(true);
  while (mangleRaise.monAnim > 0) mangleRaise.tick();
  if (!mg.inside || mg.atOpening)
    throw new Error('Mangle did not cross 122 -> 123 when the monitor raise completed');

  const mangleMask = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 12, worst: true, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const maskedMg = mangleMask.units.find(u => u.id === 'mangle') as C.Unit;   // one of the seven route units
  for (const u of mangleMask.units) if (u !== maskedMg) u.done = true;
  maskedMg.idx = maskedMg.path.length - 1; maskedMg.atOpening = true;
  mangleMask.press('mask');
  while (mangleMask.maskAnim > 0) mangleMask.tick();
  for (let n = 0; n < 2; n++) {
    while (mangleMask.frame % C.FPS !== 0) mangleMask.tick();
    if (n === 0) mangleMask.tick();
  }
  mangleMask.press('mask');
  // A new hold starts only after the take-off finishes: mask animation
  // presses are dropped by the sourced input rule (3d5c5f7).
  while (mangleMask.maskAnim > 0) mangleMask.tick();
  mangleMask.press('mask');
  while (mangleMask.maskAnim > 0) mangleMask.tick();
  if (maskedMg.maskExposureTicks !== 0)
    throw new Error('a new fully-on mask did not reset Mangle mask exposure');
  const firstMaskTick = Math.ceil((mangleMask.frame + 1) / C.FPS) * C.FPS;
  for (let n = 0; n < 5; n++) {
    mangleMask.frame = firstMaskTick + n * C.FPS;
    mangleMask.tickUnits(mangleMask.frame);
  }
  if (maskedMg.atOpening || maskedMg.idx !== 0)
    throw new Error('five continuous sourced Mangle mask ticks did not clear marker 122');

  // Groups 556-559 execute before 747-750. If both marker-123 rolls pass on
  // one scheduler tick, the attacker leaves but the global danger countdown
  // must survive that return.
  const orderedInside = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 13, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const orderedTb = orderedInside.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  for (const u of orderedInside.units) if (u !== orderedTb) u.done = true;
  orderedTb.inside = true;
  orderedInside.maskOn = true; orderedInside.maskAnim = 0;
  orderedInside.rng.chance = () => true;
  orderedInside.frame = C.FPS;
  orderedInside.tickUnits(orderedInside.frame);
  if (orderedTb.inside || orderedTb.committedAt !== C.FPS + C.INSIDE_ATTACK_FRAMES)
    throw new Error('same-tick marker-123 leave incorrectly cancelled danger 2');
  if (orderedTb.idx !== 0 || orderedTb.stunUntil !== C.FPS + C.INSIDE_LEAVE_COOLDOWN)
    throw new Error('marker-123 leave did not write the sourced B = 500 route cooldown');
  orderedInside.frame = orderedTb.committedAt;
  orderedInside.tickUnits(orderedInside.frame);
  if (orderedInside.alive || orderedInside.death?.reason !== 'inside-office')
    throw new Error('persisted marker-123 danger did not complete after 40 frames');

  const insideTriggers = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 14, worst: true, bbEnabled: false,
    foxyEnabled: false, gfEnabled: false, boxEnabled: false, powerEnabled: false,
    record: false });
  const insideTb = insideTriggers.units.find(u => u.id === 'toybonnie') as C.Unit;   // one of the seven route units
  const insideMg = insideTriggers.units.find(u => u.id === 'mangle') as C.Unit;   // one of the seven route units
  for (const u of insideTriggers.units)
    if (u !== insideTb && u !== insideMg) u.done = true;
  insideTb.inside = true;
  insideTriggers.monitor = 'up';
  insideTriggers.frame = C.FPS * 10;
  insideTriggers.tickUnits(insideTriggers.frame);
  if (insideTb.committedAt !== insideTriggers.frame + C.INSIDE_ATTACK_FRAMES)
    throw new Error('Toy Bonnie marker-123 ten-second cameras-up trigger was not modeled');

  // Isolate Mangle after checking Toy Bonnie: her 1-in-20 cameras-up roll arms
  // a later cameras-down edge rather than raising danger immediately.
  insideTb.done = true; insideTb.committedAt = -1;
  insideMg.inside = true;
  insideTriggers.frame = C.FPS * 11;
  insideTriggers.tickUnits(insideTriggers.frame);
  if (!insideMg.insideArmed || insideMg.insideDangerAt >= 0)
    throw new Error('Mangle marker-123 cameras-up roll did not arm separately');
  insideTriggers.setMonitor(false);
  if (insideMg.committedAt !== insideTriggers.frame + C.INSIDE_ATTACK_FRAMES)
    throw new Error('cameras-down edge did not convert Mangle arm into danger 2');

  // Endpoint resolution (groups 538-555): a defended encounter repels the
  // occupant to their sourced mid-route room with B = Random(500)/night.
  const repel = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 16, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const repelWb = repel.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  for (const u of repel.units) if (u !== repelWb) u.done = true;
  repelWb.idx = repelWb.path.length - 1; repelWb.atOpening = true;
  repel.rng.int = () => 499; // pin Random(500) to its max
  repel.tickUnits(0);
  repel.press('mask');
  while (repel.frame < C.BLACKOUT_FRAMES) repel.tick();
  if (repelWb.atOpening || repelWb.path[repelWb.idx] !== 7)
    throw new Error('defended W. Bonnie was not repelled to the sourced CAM 07');
  if (repelWb.stunUntil !== repel.frame + Math.floor(499 / 7))
    throw new Error('endpoint repel did not write the Random(500)/night B cooldown');

  // Toy Bonnie's opening timer is his own B counter: written on arrival at
  // marker 122, and B = 0 plus cameras up crosses him to 123 (group 546).
  const tbTimer = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 17, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const timerTb = tbTimer.units.find(u => u.id === 'toybonnie') as C.Unit;   // one of the seven route units
  for (const u of tbTimer.units) if (u !== timerTb) u.done = true;
  timerTb.idx = timerTb.path.length - 2; timerTb.pending = true;
  tbTimer.tickUnits(0); // cams down + right vent light off: his gate is open
  if (!timerTb.atOpening || timerTb.stunUntil !== C.toyBonnieOpeningFrames(7))
    throw new Error('Toy Bonnie arrival did not write B = 1000-100*night as the opening timer');
  tbTimer.monitor = 'up';
  tbTimer.frame = timerTb.stunUntil - 1;
  tbTimer.tickUnits(tbTimer.frame);
  if (timerTb.inside)
    throw new Error('Toy Bonnie crossed to marker 123 while his B was still draining');
  tbTimer.frame = timerTb.stunUntil;
  tbTimer.tickUnits(tbTimer.frame);
  if (!timerTb.inside)
    throw new Error('Toy Bonnie with B = 0 and cameras up did not cross to marker 123');

  // Toy Bonnie's vent hop (group 428) needs the right vent light OFF as well
  // as cameras down — holding it stalls his entry (the Shooter25 stall).
  const rightLight = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 22, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const stallTb = rightLight.units.find(u => u.id === 'toybonnie') as C.Unit;   // one of the seven route units
  for (const u of rightLight.units) if (u !== stallTb) u.done = true;
  stallTb.idx = stallTb.path.length - 2; stallTb.pending = true;
  rightLight.press('ventR');
  rightLight.tickUnits(0);
  if (stallTb.atOpening || !stallTb.pending)
    throw new Error('held right vent light did not stall Toy Bonnie\'s vent entry');
  rightLight.release('ventR');
  rightLight.tickUnits(0);
  if (!stallTb.atOpening)
    throw new Error('Toy Bonnie did not enter once the right vent light was released');

  // Foxy: per-frame exposure vs 100*night, with the B = 50 hall pin holding
  // his eviction until 50 frames after the light release (g745/846/855).
  const foxyPin = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 18, bbEnabled: false, gfEnabled: false,
    boxEnabled: false, powerEnabled: false, stalledEnabled: false, record: false });
  const fx = foxyPin.foxy;
  fx.loc = 'hall';
  foxyPin.press('light');
  const lit = C.foxyExposureFrames(7) + 1;
  for (let i = 0; i < lit; i++) foxyPin.tick();
  if (fx.loc !== 'hall' || fx.exposure !== lit)
    throw new Error('Foxy retreated while the hall light was still held');
  foxyPin.release('light');
  for (let i = 0; i < C.FOXY_HALL_PIN_FRAMES - 1; i++) foxyPin.tick();
  if (fx.loc !== 'hall')
    throw new Error('Foxy retreated before his pinned B = 50 drained');
  foxyPin.tick();
  if ((fx.loc as string) !== 'parts')   // the tick above moves him
    throw new Error('over-exposed Foxy did not retreat once lights were off and B = 0');

  // The pin also blocks his 5-second roll: B must be 0 before he can lock on.
  const pinnedRoll = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 21, bbEnabled: false, gfEnabled: false,
    boxEnabled: false, powerEnabled: false, stalledEnabled: false, record: false });
  const pfx = pinnedRoll.foxy;
  pfx.loc = 'hall'; pfx.D = 10;
  pfx.pinUntil = C.MO_FRAMES + 10;
  pinnedRoll.rng.int = () => 0; // 21 + 0 - 10 <= 17: the roll would pass
  pinnedRoll.frame = C.MO_FRAMES;
  pinnedRoll.onFiveSecond();
  if (pfx.gotYou)
    throw new Error('Foxy locked on while his pinned B was still draining');
  pinnedRoll.frame = pfx.pinUntil;
  pinnedRoll.onFiveSecond();
  if (!pfx.gotYou)
    throw new Error('Foxy with B = 0 did not lock on when his roll passed');

  // D is zeroed all of night 1 and until 2 AM on night 2 (g872-874).
  const dormant = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 19, night: 1, bbEnabled: false, gfEnabled: false,
    boxEnabled: false, powerEnabled: false, stalledEnabled: false, record: false });
  for (let i = 0; i < C.FPS * 3; i++) dormant.tick();
  if (dormant.foxy.D !== 0)
    throw new Error('Foxy D accumulated during the sourced night-1 dormancy');
  const night2 = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 20, night: 2, bbEnabled: false, gfEnabled: false,
    boxEnabled: false, powerEnabled: false, stalledEnabled: false, record: false });
  for (let i = 0; i < C.FPS * 3; i++) night2.tick();
  if (night2.foxy.D !== 0)
    throw new Error('Foxy D accumulated on night 2 before 2 AM');
  night2.frame = 2 * C.HOUR_FRAMES;
  for (let i = 0; i < C.FPS * 3; i++) night2.tick();
  if ((night2.foxy.D as number) !== 3)   // the ticks above accrue it
    throw new Error('Foxy D did not resume its +1/s accrual at 2 AM on night 2');

  const mutex = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 15, bbEnabled: false, foxyEnabled: false,
    gfEnabled: false, boxEnabled: false, powerEnabled: false, record: false });
  const mutexWb = mutex.units.find(u => u.id === 'withbonnie') as C.Unit;   // one of the seven route units
  const mutexTf = mutex.units.find(u => u.id === 'toyfreddy') as C.Unit;   // one of the seven route units
  mutex.monitor = 'up';
  mutexWb.idx = mutexWb.path.length - 2;
  mutex.advanceUnit(mutexWb);
  mutexTf.idx = mutexTf.path.length - 2;
  if (mutex.canAdvance(mutexTf, mutex.frame))
    throw new Error('`office occupied` mutex admitted two shared attackers to marker 122');
}

// Keep the cycle's input offsets tied to the sourced animation lengths.  A
// touch is queued at a frame boundary, before that frame's animation tick;
// the extra three frames are an intentional small execution margin.
const maskOnTap = 18;
const maskOffTap = maskOnTap + C.MASK_ANIM_ON + 3;
const maskOffReady = maskOffTap + C.MASK_ANIM_OFF + 3;
const monitorUpTap = maskOffReady + 3;
const firstCamera = monitorUpTap + C.MONITOR_ANIM_UP + 3;

const CYCLE: Array<[number, string, string]> = [
  [0,  'tap',  'monitor'],   // cams down
  [maskOnTap,  'tap', 'mask'], // mask on (clears Golden Freddy)
  [maskOffTap, 'tap', 'mask'], // mask off, after put-on animation and margin
  // The mask-off animation owns the touch surface for MASK_ANIM_OFF frames;
  // the old +30/+36 inputs were silently dropped.  Leave a small sourced
  // animation margin before the hall flash and the monitor raise.
  [maskOffReady,     'down', 'light'],
  [maskOffReady + 2, 'up',   'light'],
  [monitorUpTap,     'tap',  'monitor'],
  [firstCamera,      'tap',  'cam:10'], [firstCamera + 2, 'down', 'light'], [firstCamera + 4, 'up', 'light'],
  [firstCamera + 12, 'tap',  'cam:4'],  [firstCamera + 14, 'down', 'light'], [firstCamera + 16, 'up', 'light'],
  [firstCamera + 24, 'tap',  'cam:7'],  [firstCamera + 26, 'down', 'light'], [firstCamera + 28, 'up', 'light'],
  [firstCamera + 36, 'tap',  'cam:11'],
  [firstCamera + 39, 'down', 'wind'],
];

export function run(opts = {}) {
  const sim = new Sim(Object.assign({ bbEnabled: false, seed: 12345 }, opts));
  // Start of night: raise the cams, sit on CAM 11 and wind until 0:07, which is
  // the first anchor. From there the main cycle runs on :X2 / :X7.
  let anchor = C.s(7);
  let queue: Array<[number, string, string]> = [
    [2, 'tap', 'monitor'], [20, 'tap', 'cam:11'], [24, 'down', 'wind'],
    ...CYCLE.map(([o, k, a]): [number, string, string] => [anchor + o, k, a]),
  ];
  let minBox = 1, maxD = 0;

  while (sim.alive && !sim.won) {
    while (queue.length && queue[0][0] <= sim.frame) {
      const [, kind, act] = queue.shift() as [number, string, string];   // queue.length was checked
      if (kind === 'up') sim.release(act); else sim.press(act);
    }
    if (!queue.length) {
      anchor += C.MO_FRAMES;
      queue = CYCLE.map(([o, k, a]) => [anchor + o, k, a]);
    }
    sim.tick();
    minBox = Math.min(minBox, sim.box);
    maxD = Math.max(maxD, sim.foxy.D);
  }
  return { sim, minBox, maxD };
}

// The historical held-light camdrop negative (night6-anchored2/3) is g778:
// Golden Freddy present when viewing reaches 0 meets the held hall light.
// Test that condition directly, including the released-light negative control.
// The legal mask timings above change the diagnostic cycle's RNG/phase, so a
// particular seed's death is no longer a stable control for this source rule.
// No device winner schedule is changed by these fixture timings.
{
  for (const held of [false, true]) {
    const control = new Sim({ ...LEGACY_SIM_OPTIONS, seed: 12345, bbEnabled: false, foxyEnabled: false,
      boxEnabled: false, powerEnabled: false, record: false });
    control.monitor = 'up'; control.viewing = 11; control.gf.present = true;
    control.lightHeld = held;
    control.setMonitor(false); control.tick();
    if (held ? control.death?.reason !== 'golden-freddy' : !control.alive)
      throw new Error(`g778 camdrop control failed with light ${held ? 'held' : 'released'}`);
  }
}
const r = run({ record: true, gfEnabled: false });   // this single diagnostic run reads sim.rec
const s = r.sim;
const targetStunMax = s.rec
  ? s.rec.stun.map(frames => Math.max(...frames))
  : [];
if (!s.won || targetStunMax.some(max => max === 0)) {
  throw new Error(`canonical cycle lost camera coverage: ${s.death?.reason ?? 'no win'}; ` +
    `${C.TARGET_CAMS.map((cam, i) => `${cam}=${targetStunMax[i] ?? 0}`).join(', ')}`);
}
console.log(`result        : ${s.won ? 'SURVIVED to 6 AM' : 'DIED ' + (s.death as C.Death).reason}`);   // a night not won ended in a death
if (s.death) console.log(`               ${s.death.detail} @ ${(s.death.t).toFixed(2)}s`);
console.log(`time          : ${(s.frame / 60).toFixed(1)}s of ${(C.NIGHT_FRAMES / 60)}s`);
console.log(`power left    : ${s.power}/${C.POWER_FRAMES} frames (${(s.power / 60).toFixed(1)}s)`);
console.log(`light used    : ${((C.POWER_FRAMES - s.power) / 60).toFixed(1)}s  rate ${Math.round((C.POWER_FRAMES - s.power) / s.frame * 1000)}ms/s`);
console.log(`min box       : ${(r.minBox * 100).toFixed(0)}%`);
console.log(`max Foxy D    : ${r.maxD}`);
console.log(`puppet stage  : ${s.puppet.stage}`);
console.log(`broke loose   : ${s.mistakes.filter(m => m.code === 'broke-loose').length}`);
const stunGaps = [0, 1, 2].map(k => {
  let g = 0; for (let i = 1; i < s.rec.n; i++) if (s.rec.stun[k][i] === 0 && s.rec.stun[k][i - 1] > 0) g++;
  return `${C.TARGET_CAMS[k]}:${g}`;
}).join(' ');
console.log(`stun lapses   : ${stunGaps}`);

// --- sweep: Minus 7's claim is that a correct cycle never loses -------------
if (process.argv.includes('--sweep')) {
  const n = 200; const fails: Record<string, number> = {};
  let worstD = 0, minBoxAll = 1, minPower = C.POWER_FRAMES;
  for (let i = 0; i < n; i++) {
    const r = run({ seed: (i * 2654435761) >>> 0 });
    worstD = Math.max(worstD, r.maxD);
    minBoxAll = Math.min(minBoxAll, r.minBox);
    minPower = Math.min(minPower, r.sim.power);
    if (!r.sim.won) fails[(r.sim.death as C.Death).reason] = (fails[(r.sim.death as C.Death).reason] || 0) + 1;   // a night not won ended in a death
  }
  const failed = Object.values(fails).reduce((a, b) => a + b, 0);
  if (failed) throw new Error(`canonical cycle sweep had ${failed} death(s)`);
  console.log(`\nsweep of ${n} seeds: ${n - failed} survived, ${failed} died`);
  for (const [k, v] of Object.entries(fails)) console.log(`  ${k}: ${v}`);
  console.log(`worst Foxy D ${worstD} | min box ${(minBoxAll * 100).toFixed(0)}% | min power left ${minPower}`);
}
