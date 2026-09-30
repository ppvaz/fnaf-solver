// Microroutine oracle for the runner's own HID stream.
//
// The routine level already has one: the device plan replays through the
// engine and either survives the night or does not. The microroutine level --
// how long a contact is held, how much released time separates two buttons,
// whether a slot ever loses its touch-end -- had no oracle but a phone, and
// every input bug this project has hit lives there. `HID_TRACE_RUN=1` makes
// the runner append every report it sends, and the stream carries its own
// `delay` commands, so the intended timing is recoverable from the artifact.
//
// Usage: test-hid-trace.mjs [trace.jsonl]   (no argument runs the self-test)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Both from device measurement; see docs/device/HID-MULTITOUCH.md.
//
// HID-MULTITOUCH.md's current device result: the Moto g56 registered 33 ms
// contacts on camera, monitor, mask and hall controls. The former 100-120 ms
// value was swipe-era margin and is retained only in the historical record.
export const MIN_CONTACT_MS = 33;
// Fusion polls touch once per frame, so two different buttons with no released
// time between them can read as one finger moving from one to the other. The
// mask press lost that way stuck the mask on and blinded every later read.
export const MIN_RELEASED_MS = 20;

export function audit(text) {
  const events = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const problems = [];
  const active = new Map();          // id -> {at, xy}
  let now = 0, lastReleaseAt = null, lastReleaseXy = null;
  let rebasedMarks = 0, worstDriftMs = 0, totalMarks = 0;
  let contestedBoundaries = 0, worstContestMs = 0;

  for (const event of events) {
    // A mark is the runner's real clock at an action boundary. Without them
    // only hid-side delays advance the timeline, and every wall-timed pair of
    // actions reads as a zero-gap button change.
    if (event.command === 'mark') {
      totalMarks += 1;
      // Marks are the runner's real clock at an action boundary; emitted delays
      // are the timing *inside* an action. Mixing them with `max` let the delay
      // clock run ahead and then swallow every correcting mark -- 56 of 130 in
      // night 6-42, drifting 2742 ms -- because the runner also spends host-side
      // `wait_until` time between actions, and that emits no delay record. Every
      // boundary it waited through then read as zero released time, which is
      // where the "0 ms released" cycle seam came from; measured from the marks
      // those same seams had 112-282 ms.
      //
      // So each source is believed where it is authoritative: between actions
      // the mark re-bases the clock even if that moves it backwards, and inside
      // an action the delays win.
      if (active.size) {
        now = Math.max(now, event.ms);
      } else if (lastReleaseAt !== null && event.ms < lastReleaseAt) {
        // The runner marked the next action before the emitter finished the
        // previous contact. That is routine -- the mark is the host's intent,
        // the delay clock is where the emitter actually is -- and the trace
        // cannot say which one the game saw. Counted, and reported once as
        // context, because per-occurrence it is noise: nights 6-40 to 6-42 have
        // dozens each, 19-117 ms, and an instrument that cries wolf gets
        // ignored. Where it matters is that a released-time figure measured
        // across such a boundary has two candidate values, not one.
        contestedBoundaries += 1;
        worstContestMs = Math.max(worstContestMs, lastReleaseAt - event.ms);
      } else {
        if (event.ms < now) {
          rebasedMarks += 1;
          worstDriftMs = Math.max(worstDriftMs, now - event.ms);
        }
        now = event.ms;
      }
      continue;
    }
    if (event.command === 'delay') {
      // A zero-length delay is not a no-op on the device: `hid` rejects the
      // duration outright and the process exits, so a trace containing one is
      // a trace whose run was already over. It advances a virtual clock by 0,
      // which is why a stubbed interpreter cannot see this and only the
      // artifact can.
      if (!(event.duration > 0))
        problems.push(`delay of ${event.duration} ms at ${now} ms: hid rejects ` +
          'a non-positive duration and exits, taking the co-process with it');
      now += event.duration;
      continue;
    }
    if (event.command !== 'report') continue;
    const report = event.report;
    if (report.length !== 12 || report[0] !== 1 || report[1] > 2) {
      problems.push(`malformed report at ${now} ms: ${JSON.stringify(report)}`);
      continue;
    }
    const count = report[1];
    const records = [report.slice(2, 7), report.slice(7, 12)].slice(0, count);
    const before = new Set(active.keys());
    const consumed = new Set();
    for (const record of records) {
      const id = record[0] >> 2, down = (record[0] & 1) !== 0;
      const xy = `${record[1] | (record[2] << 8)},${record[3] | (record[4] << 8)}`;
      consumed.add(id);
      if (down) {
        if (!active.has(id)) {
          // Fusion polls touch per frame: pressing a different button in the
          // same instant a contact lifts can read as one finger moving.
          if (lastReleaseAt !== null && xy !== lastReleaseXy &&
              now - lastReleaseAt < MIN_RELEASED_MS)
            problems.push(`only ${now - lastReleaseAt} ms released between ` +
              `${lastReleaseXy} and ${xy} at ${now} ms`);
          active.set(id, { at: now, xy });
        }
      } else if (active.has(id)) {
        const held = now - active.get(id).at;
        if (held < MIN_CONTACT_MS)
          problems.push(`contact ${id} at ${active.get(id).xy} held ${held} ms ` +
            `(floor ${MIN_CONTACT_MS}) ending ${now} ms`);
        lastReleaseAt = now; lastReleaseXy = active.get(id).xy;
        active.delete(id);
      }
    }
    // Trap 2: the count is how many records the driver consumes, so a contact
    // that is no longer touching but not named in the packet stays latched.
    for (const id of before)
      if (!consumed.has(id) && count <= id)
        problems.push(`contact ${id} left unnamed by a count=${count} report at ${now} ms`);
  }
  for (const [id, c] of active)
    problems.push(`contact ${id} at ${c.xy} never released (down since ${c.at} ms)`);
  // Context, not defects. Re-basing is the normal case; a contested boundary is
  // the two clocks disagreeing about where the emitter had got to, which the
  // trace cannot settle on its own.
  const notes = [];
  if (rebasedMarks)
    notes.push(`${rebasedMarks}/${totalMarks} marks re-based the clock (worst ${worstDriftMs} ms of delay-clock drift)`);
  if (contestedBoundaries)
    notes.push(`${contestedBoundaries} boundaries where the runner's mark preceded the emitter's release by up to ${worstContestMs} ms -- released figures there have two candidate values`);
  return { problems, spanMs: now, reports: events.filter(e => e.command === 'report').length,
           rebasedMarks, worstDriftMs, totalMarks, contestedBoundaries, notes };
}

const R = (count, ...recs) => JSON.stringify({ id: 92, command: 'report',
  report: [1, count, ...recs.flat(), ...Array(10 - recs.flat().length).fill(0)] });
const D = ms => JSON.stringify({ id: 92, command: 'delay', duration: ms });

function selfTest() {
  const rec = (flags, x, y) => [flags, x & 255, x >> 8, y & 255, y >> 8];
  // Two clean camera selects at 100 ms spacing: 33 ms contacts plus 67 ms
  // released time. Both contacts are named on every release (trap 2).
  const good = [R(2, rec(3, 100, 200), rec(7, 300, 400)), D(33),
                R(2, rec(0, 100, 200), rec(4, 300, 400)), D(67),
                R(2, rec(3, 100, 200), rec(7, 500, 600)), D(33),
                R(2, rec(0, 100, 200), rec(4, 500, 600))].join('\n');
  const clean = audit(good);
  if (clean.problems.length) throw new Error('self-test: a clean stream was rejected: ' +
    clean.problems.join('; '));

  // The three failures this session actually shipped to the phone.
  const short = audit([R(1, rec(3, 700, 800)), D(25), R(1, rec(0, 700, 800))].join('\n'));
  if (!short.problems.some(p => /held 25 ms/.test(p)))
    throw new Error('self-test: a 25 ms contact was not caught');

  const nogap = audit([R(1, rec(3, 100, 200)), D(100), R(1, rec(0, 100, 200)),
                       R(1, rec(3, 900, 900)), D(100), R(1, rec(0, 900, 900))].join('\n'));
  if (!nogap.problems.some(p => /released between/.test(p)))
    throw new Error('self-test: a zero-gap button change was not caught');

  const zero = audit([R(1, rec(3, 100, 200)), D(0), R(1, rec(0, 100, 200))].join('\n'));
  if (!zero.problems.some(p => /hid rejects/.test(p)))
    throw new Error('self-test: a zero-length delay was not caught');

  const latched = audit([R(2, rec(3, 100, 200), rec(7, 300, 400)), D(100),
                         R(1, rec(0, 100, 200))].join('\n'));
  if (!latched.problems.some(p => /never released|unnamed/.test(p)))
    throw new Error('self-test: a latched contact 1 was not caught');

  // Marks were never in a fixture, which is how the drift survived: every case
  // above is delays-only, so `now = max(now, mark)` was never exercised against
  // a mark that arrives behind an over-advanced delay clock.
  const drifted = audit([
    JSON.stringify({ command: 'mark', ms: 0 }),
    R(1, rec(3, 100, 200)), D(100), R(1, rec(0, 100, 200)),
    // The runner now waits host-side: 500 ms of real time, no delay record. The
    // delay clock says 100 ms; the mark says 600. Between actions the mark wins,
    // so the released gap is 500 ms and not the 0 ms `max` used to report.
    JSON.stringify({ command: 'mark', ms: 600 }),
    R(1, rec(3, 900, 900)), D(100), R(1, rec(0, 900, 900)),
  ].join('\n'));
  if (drifted.problems.length)
    throw new Error('self-test: a host-waited boundary was reported as a defect: ' +
      drifted.problems.join('; '));
  if (drifted.spanMs !== 700)
    throw new Error(`self-test: the timeline did not re-base on the mark (span ${drifted.spanMs} ms, expected 700)`);

  // A mark that claims the next action started before the previous contact came
  // up is the two clocks genuinely disagreeing, and must be reported.
  const backwards = audit([
    JSON.stringify({ command: 'mark', ms: 0 }),
    R(1, rec(3, 100, 200)), D(100), R(1, rec(0, 100, 200)),
    JSON.stringify({ command: 'mark', ms: 40 }),
    // 30 ms of emitted delay after the contested mark, so this fixture tests the
    // contested boundary alone and not a genuine zero-gap change on top of it.
    D(30), R(1, rec(3, 900, 900)), D(100), R(1, rec(0, 900, 900)),
  ].join('\n'));
  if (backwards.problems.length)
    throw new Error('self-test: a contested boundary was reported as a defect: ' +
      backwards.problems.join('; '));
  if (backwards.contestedBoundaries !== 1)
    throw new Error('self-test: a mark behind the previous release was not counted');

  console.log('HID trace auditor self-test passed (clean stream accepted; ' +
    'short contact, zero-gap change, zero-length delay and latched contact all caught; \n  the timeline re-bases on marks and a contested boundary is counted, not cried)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { selfTest(); }
  else {
    const text = readFileSync(file, 'utf8');
  if (!/"command":"mark"/.test(text))
    throw new Error(`${file} has no marks: it was recorded before the runner ` +
      'emitted them, and without a real clock every wall-timed action reads ' +
      'as a zero-gap button change');
  const { problems, spanMs, reports, notes } = audit(text);
    console.log(`${file}: ${reports} reports over ${spanMs} ms of scheduled hid time`);
    for (const n of notes) console.log('  note: ' + n);
    for (const p of problems) console.log('  ' + p);
    console.log(problems.length ? `${problems.length} problems` : 'no problems');
    if (problems.length) process.exitCode = 1;
  }
}
