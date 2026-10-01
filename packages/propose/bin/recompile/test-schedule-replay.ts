// FIXTURE: schedule-to-input.ts and compare-schedule-replay.ts on synthetic rows and model-made traces.
// No rebuilt runtime is run; a "rebuilt" trace here is the model's own trace, perturbed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schedule } from '../plans/minus-toys-plan.ts';
import { ATTACKERS, LEDGERS, compareScheduleReplay, counterSeries, mismatchRuns, rebuiltAttacker, transitions, watchSeries } from './compare-schedule-replay.ts';
import { drawTrace } from '../../../source/recompile/model-draw-trace.ts';
import { controlPoints, expandRows, frameOf, harnessInput, harnessRows, winnerSchedule, modelContacts } from './schedule-to-input.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));

// --- window points: the profile's native points through the FULL stretch ---
const profile = { geometry: 'phone-landscape-2400x1080-v1', viewScroll: { windowWidth: 1024, windowHeight: 768 },
  controlMap: { monitor: { x: 1780, y: 995 }, mask: { x: 600, y: 995 }, cameraFeedLight: { x: 900, y: 540 },
    hallLight: { x: 1200, y: 540 }, 'cam:9': { x: 2144, y: 548 }, 'cam:11': { x: 2228, y: 652 } } };
const points: any = controlPoints(profile);
assert.deepEqual(points.monitor, [759, 708]);
assert.deepEqual(points['cam:9'], [915, 390]);
assert.deepEqual(points.cameraFeedLight, [384, 384]);
assert.throws(() => controlPoints({ ...profile, geometry: 'tablet-1920x1200-v1' }), /geometry/);

// --- one expansion: contacts and the Sim queue, the queue equal to schedule()'s ---
const rows = { opening: [[0, 'tap', 'monitor', 33], [300, 'tap', 'cam11', 33]],
  loop: [[100, 'hold', 'cameraFeedLight', 100], [200, 'camdrop', 150, 200, 67], [900, 'hall', 33]], finish: [] };
const bounds = { periodMs: 1000, loopStartMs: 0, untilMs: 2000, epochMs: 50 };
const expanded = expandRows({ ...rows, ...bounds });
assert.deepEqual(expanded.queue, schedule({ ...rows, ...bounds }), 'the Sim queue is the replay schedule');
const first = expanded.contacts[0];
assert.deepEqual([first.control, first.downFrame, first.upFrame], ['monitor', frameOf(50), frameOf(83)]);
const camdrop = expanded.contacts.filter((c) => c.cycle === 'loop' && c.index === 1 && c.downMs < 1000);
assert.deepEqual(camdrop.map((c) => [c.control, c.downFrame, c.upFrame]),
  [['cameraFeedLight', frameOf(250), frameOf(667)], ['monitor', frameOf(400), frameOf(600)]]);
assert.ok(expanded.contacts.some((c) => c.control === 'hallLight' && c.downFrame === frameOf(950)));
assert.throws(() => expandRows({ opening: [[0, 'tap', 'monitor', 5]], loop: [], periodMs: 1000, untilMs: 0 }), /shorter than one/);
assert.throws(() => expandRows({ opening: [[0, 'sweep', 'cam9']], loop: [], periodMs: 1000, untilMs: 0 }), /no harness form/);

// --- harness rows: an overlapping contact takes pointer 1; same-tick edges are listed ---
const office = harnessRows(expanded.contacts, points);
const monitorInCamdrop = office.rows.find((r) => r.op === 'down' && r.control === 'monitor' && r.tick === frameOf(400));
assert.equal(monitorInCamdrop.pointer, 1, 'the camdrop monitor contact overlaps the held light');
assert.deepEqual([monitorInCamdrop.x, monitorInCamdrop.y], [759, 708]);
assert.ok(office.rows.every((r, i, all) => i === 0 || all[i - 1].tick < r.tick || (all[i - 1].tick === r.tick && !(all[i - 1].op === 'down' && r.op === 'up'))),
  'rows are in tick order, releases before presses');
const touching = harnessRows([{ control: 'monitor', downFrame: 0, upFrame: 2 }, { control: 'mask', downFrame: 2, upFrame: 4 },
  { control: 'cam9', downFrame: 10, upFrame: 12 }, { control: 'cam11', downFrame: 10, upFrame: 12 }], points.monitor ? { ...points, cam9: points['cam:9'] } : points);
assert.deepEqual(touching.sameTickEdges.map((e) => e.tick), [2, 10]);
assert.equal(touching.rows.find((r) => r.op === 'down' && r.control === 'mask').pointer, 0, 'a pointer released on the tick is free again');
assert.throws(() => harnessRows([{ control: 'wind', downFrame: 0, upFrame: 2 }], points), /absent from the profile/);
assert.throws(() => harnessInput({ navigation: '3 0 down 0 1 1\n', schedule: expanded, points }), /already acts on frame 3/);

// --- a committed binding: the Night 1 minimal schedule ---
const devProfile = json('packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json');
const minimal = json('packages/propose/bindings/fnaf2/campaign-night1-minimal-winner.json');
const sched = winnerSchedule(minimal, 1);
assert.equal(sched.contacts.length, 96);
assert.deepEqual([sched.contacts[0].control, sched.contacts[0].downFrame], ['monitor', 6900], 'the arm opens at 115 s');
assert.throws(() => winnerSchedule(minimal, 2), /does not name night 2/);
assert.throws(() => winnerSchedule(json('packages/propose/bindings/fnaf2/campaign-night7-420-minus3-winner.json'), 7), /only minus-toys/);
const navigation = read('packages/source/recompile/fixtures/night1-newgame.input');
const input = harnessInput({ navigation, schedule: sched, points: controlPoints(devProfile) });
assert.ok(input.text.startsWith(navigation));
assert.equal(input.office.rows.length, 192);

// --- the comparison, on the model's own trace ---
const modelOptions = json('packages/source/recompile/sourced-rebuild-model-options.json');
const model = drawTrace({ night: 1, seed: 24850, frames: 30000, contacts: modelContacts(sched.contacts), modelOptions, observe: LEDGERS.monitor.model });
assert.ok(model.won);
const traceOf = (out, { from = 0, to = out.length - 1, draws = (r) => r.draws, next = 5, watch = model.observed, counters = null } = {}) => {
  let text = `# frame tick draws graine values...\n${counters ? `# counters ${counters.names.join(',')}\n` : ''}# frame 3 seeded 24850\n`;
  for (let t = from; t + 1 <= to; t += 1) {
    text += `# watch 3 ${t} off 0 0 new 0 x 757 v0 ${watch[t + 1]}\n`;
    if (counters) text += `# counter 3 ${t} ${counters.at(t).map((v) => (v === null ? '-' : v)).join(' ')}\n`;
    text += `3 ${t} ${draws(out[t + 1], t)} ${out[t + 1].state}\n`;
  }
  return `${text}# frame ${next} seeded 24850\n${next} 0 0 1\n`;
};
const args = { inputText: input.text, navigationText: navigation, winner: minimal, night: 1, seed: 24850, modelOptions, profile: devProfile, ledgers: [{ name: 'monitor' }] };
const same: any = compareScheduleReplay({ ...args, text: traceOf(model.out) });
assert.equal(same.schema, 'recompile-schedule-replay-v1');
assert.equal(same.status, 'MATCHED_PREFIX', 'a prefix match, never an equivalence');
assert.deepEqual([same.outcome.rebuilt.result, same.outcome.model.result, same.outcome.sameResult], ['6am', '6am', true]);
assert.equal(same.gateReplay.agrees, true, 'the comparison model is the gate replay');
assert.equal(same.drawRuns.total, 0);
assert.deepEqual(same.ledgers[0].changes.offsets, { '0>1 +0': 2, '1>2 +0': 2, '2>3 +0': 2, '3>0 +0': 2 });
// A second ledger reads its own run of the same replay; a run with another draw stream is refused.
const maskSeries = drawTrace({ night: 1, seed: 24850, frames: 30000, contacts: modelContacts(sched.contacts), modelOptions, observe: LEDGERS.mask.model }).observed;
const withMask: any = compareScheduleReplay({ ...args, text: traceOf(model.out),
  ledgers: [{ name: 'monitor' }, { name: 'mask', text: traceOf(model.out, { watch: maskSeries }) }] });
assert.deepEqual(withMask.ledgers.map((l) => [l.name, l.mismatches, l.changes.rebuilt]), [['monitor', 0, 8], ['mask', 0, 0]], 'minimal never masks');
assert.ok((compareScheduleReplay({ ...args, text: traceOf(model.out), ledgers: [{ name: 'mask' }] }) as any).ledgers[0].mismatches > 0,
  'the main trace watched the monitor: read as a mask ledger, it disagrees');
assert.throws(() => compareScheduleReplay({ ...args, text: traceOf(model.out),
  ledgers: [{ name: 'mask', text: traceOf(model.out, { draws: (r, t) => (t === 5 ? r.draws + 1 : r.draws) }) }] }), /not a run of the same replay/);
assert.equal(same.scope.input, 'navigation plus a replayed gameplay schedule');
assert.equal(same.scope.inputMode, 'explicit-contact-duration');
assert.ok(same.schedule.modelContactsSha256);
assert.equal(same.schedule.officeRows, 192);
assert.ok(!Object.keys(same).includes('traces') && !('traces' in JSON.parse(JSON.stringify(same))), 'the traces are not part of the record');

// A one-update slip that rejoins, then a split that does not.
const slip: any = compareScheduleReplay({ ...args, text: traceOf(model.out, { draws: (r, t) => (t === 7000 || t >= 12000 ? r.draws + 1 : r.draws) }) });
assert.equal(slip.status, 'DIVERGENT');
assert.equal(slip.alignments[1].firstMismatch.tick, 7000);
assert.deepEqual(slip.drawRuns.runs[0], { start: 7000, length: 1, rejoined: true });
assert.deepEqual([slip.drawRuns.firstPersistent.start, slip.drawRuns.matchedBeforeFirstPersistent], [12000, 11999]);
// The rebuild leaves for the static frame while the model plays on: a death whose reason is not read.
const died: any = compareScheduleReplay({ ...args, ledgers: [], text: traceOf(model.out, { to: 9001, next: 4 }) });
assert.deepEqual([died.outcome.rebuilt.result, died.outcome.rebuilt.reason, died.outcome.sameResult], ['death', 'UNKNOWN', false]);
assert.equal(died.status, 'INCOMPLETE');
// With the harness counter watch, the rebuild names its own attacker: `being attacked by` on its last office update.
const watched = ['being attacked by', 'in danger', 'viewing'];
const foxyAt = (t) => [t >= 8980 ? 4 : 0, 0, t % 600 < 300 ? 1 : 0];
const named: any = compareScheduleReplay({ ...args, ledgers: [], text: traceOf(model.out, { to: 9001, next: 4, counters: { names: watched, at: foxyAt } }) });
assert.deepEqual([named.outcome.rebuilt.result, named.outcome.rebuilt.reason], ['death', 'Withered Foxy']);
assert.match(named.outcome.rebuilt.reasonSource, /own `being attacked by` \(CHOWDREN_WATCH_COUNTER\) = 4/);
assert.deepEqual([named.outcome.rebuilt.attacker.setAtTick, named.outcome.rebuilt.attacker.updatesHeld, named.outcome.rebuilt.attacker.lastTick], [8980, 21, 9000]);
assert.deepEqual(named.outcome.rebuilt.attacker.before, { 'being attacked by': 0, 'in danger': 0, viewing: 0 });
assert.deepEqual(named.counters.changes, { 'being attacked by': 1, 'in danger': 0, viewing: 30 }, 'ticks 0..9000 flip viewing every 300');
assert.equal(named.counters.officeUpdates, 9001);
assert.equal(named.counters.trace, 'main');
// The same counters read from another run of the replay, and a run with another draw stream refused.
const plain = traceOf(model.out, { to: 9001, next: 4 });
const fromOther: any = compareScheduleReplay({ ...args, ledgers: [], text: plain,
  counters: { text: traceOf(model.out, { to: 9001, next: 4, counters: { names: watched, at: foxyAt } }) } });
assert.equal(fromOther.outcome.rebuilt.reason, 'Withered Foxy');
assert.equal(fromOther.counters.trace.officeDrawProjectionMatches, true);
assert.throws(() => compareScheduleReplay({ ...args, ledgers: [], text: plain, counters: { text: traceOf(model.out,
  { to: 9001, next: 4, counters: { names: watched, at: foxyAt }, draws: (r, t) => (t === 5 ? r.draws + 1 : r.draws) }) } }), /counter trace is not a run of the same replay/);
assert.equal((compareScheduleReplay({ ...args, ledgers: [], counters: false,
  text: traceOf(model.out, { to: 9001, next: 4, counters: { names: watched, at: foxyAt } }) }) as any).outcome.rebuilt.reason, 'UNKNOWN', 'counters: false reads none');
// A death whose counter reads 0 (or a value the sheet never writes) stays UNKNOWN, and says what it read.
const unnamed: any = compareScheduleReplay({ ...args, ledgers: [], text: traceOf(model.out, { to: 9001, next: 4, counters: { names: watched, at: () => [0, 0, 0] } }) });
assert.equal(unnamed.outcome.rebuilt.reason, 'UNKNOWN');
assert.match(unnamed.outcome.rebuilt.reasonSource, /read 0 on its last office update, which names no attacker/);
// A 6 AM carries no attacker even with the watch on.
assert.equal((compareScheduleReplay({ ...args, ledgers: [], text: traceOf(model.out, { counters: { names: watched, at: () => [0, 0, 0] } }) }) as any).outcome.rebuilt.attacker, undefined);
assert.throws(() => compareScheduleReplay({ ...args, text: traceOf(model.out), inputText: navigation }), /not the navigation plus/);
assert.throws(() => compareScheduleReplay({ ...args, text: traceOf(model.out), ledgers: [{ name: 'vents' }] }), /--ledger/);

// --- helpers ---
assert.deepEqual(transitions([[-1, 0], [0, 0], [1, 1], [5, 2]]), [{ tick: 1, from: 0, to: 1 }, { tick: 5, from: 1, to: 2 }]);
assert.deepEqual(watchSeries('# watch 3 4 off 0 0 new 0 x 1 v0 2 v1 7\n# watch 12 4 off 0 0 new 0 x 1 v0 9\n', 3), new Map([[4, 2]]));
assert.deepEqual(counterSeries('# counters being attacked by,in danger\n# frame 3 seeded 1\n# counter 3 0 0 0\n# counter 3 1 4 -\n' +
  '# frame 4 seeded 1\n# counter 4 0 7 7\n# frame 3 seeded 1\n# counter 3 0 9 9\n', 3),
{ names: ['being attacked by', 'in danger'], series: new Map([[0, [0, 0]], [1, [4, null]]]) }, 'the first office visit only; - is an absent Counter');
assert.equal(counterSeries('# frame 3 seeded 1\n3 0 0 1\n', 3), null, 'no watch, no series');
assert.throws(() => counterSeries('# frame 3 seeded 1\n# counter 3 0 1\n', 3), /without its # counters header/);
assert.throws(() => counterSeries('# counters a,b\n# frame 3 seeded 1\n# counter 3 0 1\n', 3), /one value per watched counter/);
const series = { names: ['being attacked by', 'viewing'], series: new Map([[0, [0, 1]], [1, [0, 0]], [2, [9, 0]], [3, [9, 0]]]) };
assert.deepEqual((({ value, name, object, setAtTick, updatesHeld }) => [value, name, object, setAtTick, updatesHeld])(rebuiltAttacker(series, 3)),
  [9, 'The Puppet', 'sockpuppet', 2, 2]);
assert.equal(rebuiltAttacker({ names: ['viewing'], series: new Map([[0, [1]]]) }, 0), null, 'a watch without the counter');
assert.throws(() => rebuiltAttacker(series, 7), /no office update 7/);
// The sheet's `being attacked by` writes (03-04-Office g556-574, g722, g731): ten attackers, never Balloon Boy.
assert.deepEqual(Object.keys(ATTACKERS).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]);
assert.ok(Object.values(ATTACKERS).every((a) => a.setBy.length && a.setBy.every((g) => /^g\d+$/.test(g))));
assert.ok(!Object.values(ATTACKERS).some((a) => /balloon/i.test(a.name)));
assert.deepEqual(mismatchRuns([{ tick: 0, draws: 1, state: 2 }, { tick: 1, draws: 9, state: 2 }],
  [{}, { draws: 1, state: 2 }, { draws: 1, state: 2 }]).runs, [{ start: 1, length: 1, rejoined: false }]);
console.log('PASS schedule replay: FULL-stretch points, one expansion for harness and model, pointers and same-tick edges, ' +
  'the Night 1 minimal binding, prefix/slip/split/death outcomes, the attacker from the counter watch, ledger pairing and input binding (FIXTURE)');
