// Contract tests for the tap-stall audit, on a run known by construction.
//
// Cycle 0 is clean. Cycle 1 reproduces night5-strokes3's defect in miniature:
// a 60 ms capture gap covers the 33 ms monitor raise at +20100, the monitor
// never goes up, the camdrop's tap at +24000 raises it instead, and the mask
// tap at +24449 arrives with the mask button absent and lowers the monitor.
import { audit, clockBracket, expandContacts, exposure, formatReport, formatTransitions, hallCells, hallLumaOf, parseInputEvents, parseStrokeTrace, touchEdges, HALL_ROI, SCHEMA } from './tap-stall-audit.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const expectFailure = (fn, message) => {
  let failed = false;
  try { fn(); } catch { failed = true; }
  check(failed, message);
};

const NIGHT_GO = 1_000_000;
const FRAME_MS = 1000 / 60;

// Two gate samples whose read finished exactly ageUs after the capture, so the
// helper clock IS the wall clock and the offset is zero by construction.
const gateSample = (gateAtMs, visualCaptureAt) => ({
  type: 'control.gate', gateAtMs, status: 'AGREED',
  reads: [{ startedAt: visualCaptureAt, finishedAt: visualCaptureAt + 20 }],
  sample: { visualCaptureAt, ageUs: '20000', maskButtonDownstroke: 142, monitorButtonDownstroke: 0 },
});
const events = [
  { type: 'hid.night-go', at: NIGHT_GO },
  { type: 'hid.night-go-released', at: NIGHT_GO },
  gateSample(5200, NIGHT_GO + 5200),
  gateSample(15200, NIGHT_GO + 15200),
];

const action = (id, atMs, fields) => ({ id, atMs, durationMs: 33, cycle: id.split('-')[0], ...fields });
const plan = {
  night: 5,
  timing: { periodMs: 10000, loopStartMs: 0, stopAtMs: 30000, observeUntilMs: 30000, idleUntilMs: 0 },
  cycles: {
    opening: { blocks: [{ actions: [action('opening-1', 0, { kind: 'ensure', control: 'monitor', targetMonitorUp: true })] }] },
    toys: { blocks: [{ actions: [
      action('toys-1', 9200, { kind: 'press', control: 'mask', targetMaskOn: false }),
      action('toys-2', 9500, { kind: 'hold', control: 'hallLight' }),
      action('toys-3', 10100, { kind: 'ensure', control: 'monitor', targetMonitorUp: true }),
      { ...action('toys-5', 10570, { kind: 'hold', control: 'wind' }), durationMs: 3230 },
      action('toys-6', 13850, { kind: 'compound', compound: 'camdrop', control: 'cameraFeedLight', leadMs: 150, targetMonitorUp: false }),
      action('toys-7', 14449, { kind: 'press', control: 'mask', targetMaskOn: true }),
    ] }] },
  },
};

// The signature the phone shows at night-relative time t.
function signatureAt(t) {
  if (t < 20) return 'office';
  if (t < 4500) return 'monitor-up';          // opening raise landed
  if (t < 9215) return 'mask-on';             // (an opening mask this synthetic plan does not schedule)
  if (t < 9435) return 'mask-on';             // (mask-off animation reads as mask-on)
  if (t < 10140) return 'office';
  if (t < 14384) return 'monitor-up';         // cycle 0 raise landed (+40), camdrop lowers at 14000
  if (t < 14489) return 'office';
  if (t < 19215) return 'mask-on';            // cycle 0 mask landed
  if (t < 19435) return 'mask-on';
  if (t < 24040) return 'office';             // cycle 1 raise at 20100 LOST: office persists
  if (t < 24830) return 'monitor-up';         // camdrop tap RAISES; mask tap at 24449 lowers
  return 'office';                            // mask never on in cycle 1
}
const strokes = { office: [142, 144], 'monitor-up': [4, 144], 'mask-on': [142, 0] };

const HALL = new Set(hallCells());
// A grid whose hall cells are bright (luma 255) or dark (0); every other cell dark.
const gridHex = lit => Array.from({ length: HALL_ROI.gridCols * HALL_ROI.gridRows },
  (_, cell) => lit && HALL.has(cell) ? 'ffffff' : '000000').join('');
// The cycle-0 hall tap at 9500 lights the hall for two frames; the cycle-1
// tap at 19500 is refused (inside the mask-off animation) and stays dark.
const hallLitAt = t => t >= 9530 && t < 9565;
function buildTrace() {
  const lines = ['# schema=fnaf2-frame-trace-v3', 'seq\timage_ns\telapsed_ns\tcallback_ns\tinterval_ns\tgrid_mean_luma\tscreen_identity\tmask_luma\tmonitor_luma\tmask_downstroke\tmonitor_downstroke\tgrid_hex'];
  let seq = 0;
  for (let t = 0; t <= 29000; t += FRAME_MS) {
    // One 60 ms gap over the cycle-1 raise contact [20100, 20133].
    if (t > 20090 && t < 20150) continue;
    const [mask, monitor] = strokes[signatureAt(t)];
    const imageNs = Math.round((NIGHT_GO + t) * 1e6);
    // elapsed (boottime) runs 5 s ahead of the image clock: a phone that slept.
    lines.push([seq += 1, imageNs, imageNs + 5_000_000_000, imageNs, 0, 10, 2, 0, 0, mask, monitor, gridHex(hallLitAt(t))].join('\t'));
  }
  return lines.join('\n') + '\n';
}

const trace = parseStrokeTrace(buildTrace());
check(trace.length > 1000, 'the synthetic trace parsed');
check(trace[0].maskButtonDownstroke === 142 && trace[0].monitorButtonDownstroke === 144, 'stroke columns are read');

// Expansion follows the executor: opening once, the loop every period until stopAtMs.
const contacts = expandContacts(plan);
check(contacts.filter(row => row.id === 'toys-3').length === 2, 'two loop iterations fit before stopAtMs (the third would start at 30100)');
const camdrop = contacts.find(row => row.id === 'toys-6');
check(camdrop.control === 'monitor' && camdrop.atMs === 14000, 'a camdrop contact is its monitor tap, leadMs after the row');
check(contacts.find(row => row.id === 'opening-1').expect.name === 'monitor-up', 'a raise expects the monitor-up signature');
check(camdrop.expect.name === 'monitor-down' && camdrop.expect.proofs[0].windowMs === 633 && camdrop.expect.proofs[1].signature === 'mask-on',
  'a camdrop is proven by the office within 600 ms plus its contact, or by the mask coming on within 900');
check(contacts.find(row => row.id === 'toys-1').expect.inverse === 'mask-on', 'a mask-off press is inverted by mask-on reappearing');

const report = audit({ events, plan, trace });
check(report.schema === SCHEMA, 'schema');
check(report.clock.gate.lateOffsetMs === 0 && report.clock.gate.earlyOffsetMs === -20 && report.clock.gate.bracketMs === 20,
  `the gate bracket is the 20 ms read by construction, got ${JSON.stringify(report.clock.gate)}`);
// Effects follow taps by 40 ms here and land on the next 16.7 ms frame, so
// the schedule anchor's own bracket is about 80 ms wide; against a 20 ms gate
// bracket it can only confirm it, never widen it.
check(report.clock.basis === 'schedule' && report.clock.schedule.transitions === 3 &&
  report.clock.earlyOffsetMs >= -20 && report.clock.lateOffsetMs <= 0 && report.clock.bracketMs <= 20,
  `the schedule anchor stays inside the gate bracket, got ${JSON.stringify(report.clock)}`);
const byKey = new Map(report.contacts.map(row => [`${row.id}@${row.atMs}`, row]));

// Cycle 0: everything lands.
for (const key of ['toys-1@9200', 'toys-3@10100', 'toys-6@14000', 'toys-7@14449'])
  check(byKey.get(key).status === 'LANDED', `${key} landed in the clean cycle, got ${byKey.get(key).status}`);
check(byKey.get('toys-3@10100').coveredByStall === false, 'a contact on a steady 60 Hz grid is not covered');

// A 200 ms mask press whose pressed sprite blanks the strokes until release
// still grades LANDED when mask-on shows after the release, inside the
// contact-stretched window; and the camdrop before it grades LANDED on
// monitor-up being gone, whether or not the office is ever read.
{
  const heldPlan = JSON.parse(JSON.stringify(plan));
  for (const block of heldPlan.cycles.toys.blocks) for (const row of block.actions)
    if (row.control === 'mask') row.durationMs = 200;
  const heldSignature = t => {
    const base = signatureAt(t);
    if (t >= 14449 + 40 && t < 14449 + 200 + 40) return null;   // held: both strokes blank
    return base;
  };
  const lines = ['# schema=fnaf2-frame-trace-v3', 'seq'];
  let seq = 0;
  for (let t = 0; t <= 29000; t += FRAME_MS) {
    const signature = heldSignature(t);
    const [mask, monitor] = signature ? strokes[signature] : [0, 20];
    const imageNs = Math.round((NIGHT_GO + t) * 1e6);
    lines.push([seq += 1, imageNs, imageNs, imageNs, 0, 10, 2, 0, 0, mask, monitor, ''].join('\t'));
  }
  const held = audit({ events, plan: heldPlan, trace: parseStrokeTrace(lines.join('\n')) });
  const heldMask = held.contacts.find(row => row.id === 'toys-7' && row.atMs === 14449);
  const heldDrop = held.contacts.find(row => row.id === 'toys-6' && row.atMs === 14000);
  check(heldMask.status === 'LANDED' && heldMask.atLate.landedAfterMs >= 240,
    `a held mask press lands after its release, got ${JSON.stringify({ s: heldMask.status, l: heldMask.atLate })}`);
  check(heldDrop.status === 'LANDED', `a camdrop lands on monitor-up being gone, got ${heldDrop.status}`);
  check(held.clock.basis === 'schedule' && held.clock.schedule.transitions === 2,
    'the 200 ms presses do not anchor the schedule; the two landed 33 ms raises still do');
}

// Cycle 1: the raise is covered by the 60 ms gap and never lands.
const lostRaise = byKey.get('toys-3@20100');
check(lostRaise.coveredByStall && lostRaise.maxGapMs > 55, `the 60 ms gap covers the raise, got ${lostRaise.maxGapMs}`);
check(lostRaise.status === 'MISSING', `the covered raise is MISSING, got ${lostRaise.status}`);
// The camdrop's monitor tap then RAISES the monitor: expected office, saw monitor-up.
check(byKey.get('toys-6@24000').status === 'INVERTED', `the camdrop tap found the monitor down and raised it, got ${byKey.get('toys-6@24000').status}`);
// The mask tap arrives with the monitor up: the mask button is absent.
const maskTap = byKey.get('toys-7@24449');
check(maskTap.atEarly.preSignature === 'monitor-up' && maskTap.atLate.preSignature === 'monitor-up' && maskTap.buttonAbsent,
  'the mask tap is flagged BUTTON ABSENT at both ends of the bracket');
check(maskTap.status === 'MISSING', 'and the mask never came on');
// Holds with no readable effect are UNGRADED, never MISSING.
check(byKey.get('toys-5@10570').status === 'UNGRADED', 'a wind hold is ungraded');
// The hall is graded from the grid cells over FOXY_HALL, on office frames only.
check(byKey.get('toys-2@9500').status === 'LIT' && byKey.get('toys-2@9500').atLate.landedAfterMs <= 60,
  `the cycle-0 hall tap reads LIT within two frames, got ${JSON.stringify(byKey.get('toys-2@9500').atLate)}`);
check(byKey.get('toys-2@19500').status === 'DARK', `the refused cycle-1 hall tap reads DARK, got ${byKey.get('toys-2@19500').status}`);
check(report.summary.hall.lit === 1 && report.summary.hall.dark === 1 && report.summary.hall.darkAt.includes('toys-2@19500'),
  `hall summary counts one lit and one dark, got ${JSON.stringify(report.summary.hall)}`);
// A trace without grid_hex leaves the hall UNREADABLE rather than DARK.
{
  const bare = parseStrokeTrace(buildTrace().split('\n').map(line => line.split('\t').slice(0, 11).join('\t')).join('\n'));
  const bareReport = audit({ events, plan, trace: bare });
  check(bareReport.contacts.find(row => row.id === 'toys-2' && row.atMs === 9500).status === 'UNREADABLE',
    'no grid_hex means an unreadable hall, never a dark one');
}
// The hall rectangle is the envelope the phone's watchlist carried until
// 2026-09-27 (1650,300 450x400 on the 2400x1080 frame); tap-stall-audit.mjs
// is now its only home, and it reads the grid cells of retained traces.
{
  check(HALL_ROI.nativeWidth === 2400 && HALL_ROI.nativeHeight === 1080 &&
    HALL_ROI.x === 1650 && HALL_ROI.y === 300 && HALL_ROI.width === 450 && HALL_ROI.height === 400,
    'HALL_ROI keeps the retired watchlist envelope');
  check(hallCells().length === 20 && hallLumaOf(gridHex(true)) === 255 && hallLumaOf(gridHex(false)) === 0 && hallLumaOf('') === null,
    'the hall covers 20 cells (cols 13-17, rows 2-5) and its luma reads the grid');
}

check(report.summary.coveredAndLost.includes('toys-3@20100'), 'summary names the covered-and-lost contact');
check(report.summary.ambiguous.length === 0, `nothing is ambiguous across a 20 ms bracket, got ${report.summary.ambiguous}`);
check(report.summary.buttonAbsentAtContact.includes('toys-7@24449'), 'summary names the button-absent contact');
check(report.verdict === 'CONTACT_LOST', 'verdict');

// Exposure: one 60 ms gap over a 29 s span; nothing at 100 ms.
const at100 = report.exposure.find(row => row.contactMs === 100);
check(at100.exposure === 0 && at100.pZeroLost === 1, 'no interval exceeds 100 ms, so exposure at 100 ms is zero');
const at33 = report.exposure.find(row => row.contactMs === 33);
const gaps = trace.slice(1).map((row, index) => row.imageMs - trace[index].imageMs);
const expected33 = gaps.reduce((sum, gap) => sum + Math.max(0, gap - 33), 0) / report.frames.spanMs;
check(Math.abs(at33.exposure - expected33) < 1e-9 && expected33 > 0, 'exposure at 33 ms is the interval excess over the span');
check(report.summary.nightTapsPriced === 1 + 2 * 5 + 2, 'the tap class counts every contact at or under 100 ms before stopAtMs (the wind hold excluded; the third iteration fits toys-1 and toys-2)');
check(exposure([16.7, 60, 16.7], 93.4, 33) > 0 && exposure([16.7, 60, 16.7], 93.4, 60) === 0, 'exposure helper');

// Refusals: a run that never reached a night, and a run without a clock anchor.
expectFailure(() => audit({ events: events.filter(event => !event.type.startsWith('hid.night-go')), plan, trace }),
  'refuses a run with no hid.night-go');
expectFailure(() => audit({ events: events.filter(event => event.type !== 'control.gate'), plan, trace }),
  'refuses a run whose gates carry no helper clock sample');
expectFailure(() => audit({ events, plan: { timing: plan.timing, cycles: { toys: plan.cycles.toys } }, trace }),
  'refuses a plan with no opening cycle');

// A 300 ms bracket makes the clean cycle's mask tap ambiguous: at the late end
// the frames sit 300 ms later, so the monitor still reads up when the tap
// arrives, while at the early end the button is present and the tap lands.
const wide = events.map(event => event.type !== 'control.gate' ? event
  : { ...event, reads: [{ startedAt: event.reads[0].startedAt, finishedAt: event.reads[0].startedAt + 300 }] });
check(clockBracket(wide).bracketMs === 300, 'the bracket is the read round trip');
const narrowed = audit({ events: wide, plan, trace });
check(narrowed.clock.basis === 'schedule' && narrowed.clock.bracketMs < 100 &&
  narrowed.summary.lost.includes('toys-3@20100') && narrowed.summary.buttonAbsentAtContact.includes('toys-7@24449'),
  `the schedule anchor narrows a 300 ms gate bracket to under 100 ms and the findings hold, got ${JSON.stringify(narrowed.clock)}`);
const wideReport = audit({ events: wide, plan, trace, anchor: 'gate' });
const wideMask = wideReport.contacts.find(row => row.id === 'toys-7' && row.atMs === 14449);
check(wideMask.buttonAbsent === false && wideMask.buttonAbsentAmbiguous && wideMask.atLate.buttonAbsent && !wideMask.atEarly.buttonAbsent,
  `a fact that holds at one end only is flagged ambiguous, never asserted: ${JSON.stringify({ status: wideMask.status, absent: wideMask.buttonAbsent, amb: wideMask.buttonAbsentAmbiguous })}`);
check(wideReport.summary.ambiguous.includes('toys-7@14449'), 'the summary lists it as ambiguous');

// The two text views render, and the transitions view shows the lost raise's
// cycle without a monitor-up transition before the camdrop.
const text = formatReport(report);
check(text.includes('verdict: CONTACT_LOST') && text.includes('toys-3@20100'), 'the report names the lost raise');
const transitions = formatTransitions(report, trace, plan);
const cycle1 = transitions.split('\n').find(line => line.startsWith('  cycle 1 '));
check(cycle1 && !cycle1.includes('monitor-up@+101') && cycle1.includes('monitor-up@+140'),
  `cycle 1 shows no raise at +10100 and the camdrop raising at +14000: ${cycle1}`);

// The getevent reader: presses stamped on the image (monotonic) clock,
// effects 40 ms later in the trace. The boottime hypothesis (5 s off) must
// match nothing; the monotonic one must give L per control, press and release
// edges apart.
{
  const evt = (ms, code, value) => `[${String(Math.floor(ms / 1000)).padStart(8)}.${String(Math.round((ms % 1000) * 1000)).padStart(6, '0')}] /dev/input/event7: ${code.startsWith('BTN') ? 'EV_KEY' : 'EV_ABS'}       ${code.padEnd(20)} ${value}`;
  const press = (atMs, holdMs) => [evt(NIGHT_GO + atMs, 'ABS_MT_TRACKING_ID', '00000001'), evt(NIGHT_GO + atMs, 'BTN_TOUCH', 'DOWN'),
    evt(NIGHT_GO + atMs + holdMs, 'ABS_MT_TRACKING_ID', 'ffffffff'), evt(NIGHT_GO + atMs + holdMs, 'BTN_TOUCH', 'UP')];
  const text = ['# getevent -lt on ZF525F5BH5, started host 1789240000.000000000, device uptime 100.00 200.00',
    'add device 1: /dev/input/event3', '  name:     "some_touchscreen"', 'add device 2: /dev/input/event7', '  name:     "FNAF Timed Touch"',
    ...press(10100, 33), ...press(14449, 33), ...press(20100, 33), '# stopped host 1789240100.000000000, device uptime 200.00 300.00'].join('\n');
  const parsed = parseInputEvents(text);
  check(parsed.devices['/dev/input/event7'] === 'FNAF Timed Touch' && parsed.events.length === 12, 'getevent devices and rows parse');
  const { node, edges: touch } = touchEdges(parsed);
  check(node === '/dev/input/event7' && touch.length === 3 && Math.round(touch[0].releaseMs - touch[0].pressMs) === 33, 'three press/release edges on the virtual device');
  const reused = parseInputEvents(text.replace('FNAF Timed Touch', 'FNAF Campaign Menu'));
  const reusedTouch = touchEdges(reused);
  check(reusedTouch.node === '/dev/input/event7' && reusedTouch.edges.length === 3,
    'a reused menu HID supplies the scheduled touch edges when no timed-touch node exists');
  const both = parseInputEvents(text.replace('  name:     "some_touchscreen"', '  name:     "FNAF Campaign Menu"'));
  check(touchEdges(both).node === '/dev/input/event7', 'the dedicated timed-touch node wins if both are present');
  const withL = audit({ events, plan, trace, inputEvents: parsed });
  const L = withL.actuationLatency;
  check(L && L.physicalClock === 'monotonic', `the image clock is the physical one, got ${JSON.stringify(L && { physical: L.physicalClock, edges: L.edges })}`);
  check(L.hypotheses.boottime.withEffect < L.hypotheses.monotonic.withEffect && L.hypotheses.monotonic.withEffect === 2,
    `boottime (5 s off) matches fewer presses than monotonic, which matches the two landed ones: ${JSON.stringify(Object.fromEntries(Object.entries(L.hypotheses).map(([k, v]) => [k, v.withEffect])))}`);
  const raise = L.hypotheses.monotonic.perControl['monitor-up'].pressToEffect;
  check(raise && raise.n === 1 && raise.median >= 40 && raise.median <= 60, `raise L is the synthetic 40 ms plus one frame, got ${JSON.stringify(raise)}`);
  const maskOn = L.hypotheses.monotonic.perControl['mask-on'];
  check(maskOn && maskOn.releaseToEffect.median === maskOn.pressToEffect.median - 33, 'release-edge latency is the press-edge latency minus the hold');
  check(formatReport(withL).includes('actuation latency (getevent'), 'the report prints the latency section');
}

console.log('test-tap-stall-audit: ok');
