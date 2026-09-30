// The single entry point for the suite.
//
//   node tools/test.mjs             # every check that can run here
//   node tools/test.mjs --engine    # fast headless checks for edit feedback
//   node tools/test.mjs --gates     # --engine minus BACKLOG; test:unit runs it
//   node tools/test.mjs --engine --extended # include exhaustive model sweeps
//   node tools/test.mjs --browser   # Chrome checks only (minutes)
//   node tools/test.mjs --reports   # also print the diagnostic tools
//   node tools/test.mjs --parallel  # run the browser checks at once (see below)
//   node tools/test.mjs --gates --list  # print what those flags select; run nothing
//
// Two kinds of tool live in tools/, and the split matters: CHECKS assert and
// exit non-zero, so a runner can give a verdict on them. REPORTS print numbers
// for a human to read and always exit 0 -- running them under a PASS heading
// would be a lie, so they are opt-in and unjudged.
//
// The engine checks run concurrently. A few exhaustive model sweeps live in
// the extended tier: they are valuable CI gates, but re-running thousands of
// full simulated nights after every edit makes the normal feedback loop drag.
// The browser checks do NOT, by default:
// they drive a trainer that runs at real time and grades inputs in
// milliseconds, and five headless Chromes on four cores measurably degrade it
// -- the same lessontest run reached best streak 5 alone and 3 under load.
// Neither run passed, so nothing here rests on that; but a timing-graded page
// is the wrong thing to starve for wall clock. `--parallel` opts in and takes
// the group from about 280 s to about 200 s.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { chromeBinary, chromeAvailable } from './chrome.mjs';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TOOLS, '..');
const TRAINER_TOOLS = join(ROOT, 'apps', 'trainer', 'test');
const PORT = 8731;
const PAGE = `http://localhost:${PORT}/dist/index.html`;

const ENGINE = [
  // First, because it is the only check that fails on a wrong *rule* rather
  // than a wrong *outcome*: the population checks below all pass with a
  // corrupted sourced constant.
  ['sourcetest', ['../packages/source/test/sourcetest.mjs']],
  // Stock-APK seed recovery is bounded to device-time windows or explicit
  // observed outcomes; it never turns an inferred candidate into authority.
  ['seed recovery', ['../packages/source/test/seed-recoverytest.mjs']],
  // Plan 18 package 3: JavaScript/Python statistical primitives agree on
  // Wilson intervals, planning-N, two-proportion tests and fail-closed bars.
  ['stat helper', ['../packages/review/test/stat.test.mjs']],
  // Plan 02's reopened Android route: the sourced split-camera state must arm,
  // the published 10 s Minus Toys loop must clear both normal and pinned
  // worst-luck seeds, and the same loop without the split must fail.
  ['minus toys', ['../packages/propose/bin/minustoystest.mjs', '200', '--assert']],
  ['minus toys worst', ['../packages/propose/bin/minustoystest.mjs', '100', '--worst', '--assert']],
  ['minus toys no-split', ['../packages/propose/bin/minustoystest.mjs', '200', '--no-split', '--assert']],
  ['simtest', ['../packages/source/test/simtest.mjs', '--sweep']],
  ['hidreporttest', ['../packages/play/test/hid-report.test.js']],
  // Plan 19 pkg 1: the stock-device observation model (OBSERVED/UNKNOWN facts,
  // sensor cadence + latency + drops) and the blackout-reactive controller
  // (animation-window guard, lower-mask-verify-raise, graceful under a noisy
  // observer).
  ['reactivetest', ['../packages/propose/test/reactivetest.mjs', '--assert']],
  // Plan 19/21 BB vent policy: this is deliberately a release gate. Its
  // measured policy regressions must fail -- they are not printable
  // known-negatives that allow --assert to pass.
  ['vent reactive', ['../packages/propose/bin/ventreacttest.mjs', '--assert']],
  // Mangle audio-static contexts and the named five-tick mask response;
  // kept separate from the BB gate so the two audio channels cannot cross.
  ['mangle reactive', ['../packages/propose/test/mangletest.mjs', '--assert']],
  // Plan 21 phase-clock foundation: paired A2DP latency calibration, 2 Hz
  // period/phase lock, explicit 500 ms parity, and stale/low-confidence
  // recovery. No privileged engine phase is used here.
  ['phase clock', ['../packages/play/test/phase-clock.test.js']],
  // Plan 20 package 6 foundation: bounded fact messages, ordered receipt and
  // gap/stale reporting, plus a local drain that can finish an already-
  // approved cycle without inventing actions after the host link drops.
  ['fact link', ['../packages/kernel/test/factlinktest.mjs']],
  // Plan 20 package 1: unknown-safe, calibration-bound facts and explicit
  // action verification in a deterministic replayable belief contract.
  ['belief state', ['../packages/play/test/belief.test.js']],
  // Plan 20 package 2: controller-visible reduced transition model agrees with
  // seeded Sim control/resource traces; hidden routes remain risk buckets.
  ['reduced model', ['../packages/propose/test/reducedmodeltest.mjs']],
  // Plan 20 package 3: delayed facts retain event time, UNKNOWN never clears
  // risk, stale controls require verification, and contradictions fail safe.
  ['estimator', ['../packages/play/test/estimator.test.js']],
  // Plan 20 package 4: reviewed cycle data, reduced-model locks, device
  // contact floors, and mandatory exact-engine proof callback.
  // Plan 20 package 5 foundation: worst-case (not average) selection across
  // plausible reduced states with readable rejection records.
  // Plan 20 package 5: exact-engine blackout controls compare fixed open-loop,
  // truth-state oracle, disabled observations, and the estimator controller.
  // Plan 21 package 1: the current Minimal Minus Toys headers are represented
  // once as finite policy IR and round-trip with a canonical hash.
  ['policy IR', ['../packages/propose/bin/policy/test-policy-ir.mjs']],
  // Plan 21 package 2 foundation: compile the finite IR into semantic press /
  // release events, including repeat and terminal phases.
  ['policy interpreter', ['../packages/propose/bin/policy/test-policy-interpreter.mjs']],
  // Plan 21 package 3: finite phase/action grammar, engine-shaped ordering
  // checks, and duplicate-family classification.
  ['policy grammar', ['../packages/propose/test/policygrammartest.mjs']],
  // Plan 21 package 5: IR, device-plan text, and mocked phone trace stay
  // equivalent, including arm timing, repeat cadence, and terminal tail.
  ['policy equivalence', ['../packages/propose/test/policyequivalencetest.mjs']],
  // Plan 21 package 4: explicit structural mutations run through grammar,
  // device-equivalence, exact-engine, and provenance/Pareto gates.
  ['policy search', ['../packages/propose/test/policysearchtest.mjs']],
  // Plan 21 package 6: canonical policy artifact, compiled-plan hash binding,
  // runner wiring, and the opt-in post-run analysis boundary.
  ['policy artifact', ['../packages/propose/test/policyartifacttest.mjs']],
  // Plan 16 pkg 1/3 gates: Sim.snapshot()/restore() bit-identity, the semantic
  // action layer, and the parameter search harness reproducing the 803feb3
  // ladder on a zero perturbation.
  ['minus7 search', ['../packages/propose/parked/minus7/test-search.mjs']],
  ['reactive pilot', ['../packages/propose/parked/minus7/reactive-pilot.mjs', '200', '--assert']],
  ['reactive pilot --worst', ['../packages/propose/parked/minus7/reactive-pilot.mjs', '100', '--worst', '--assert']],
  // The human-slack budget, measured 2026-08-25: reactive Minus 7 holds
  // 200/200 at +/-60 ms uniform per-input error, 89/200 at +/-100, 0/200 at
  // +/-150. The strategy's human-executability rests on this margin (and on
  // human error correlating rather than being iid -- plans/04), so hold the
  // floor of the bracket. If this flips, the human-viability picture changed.
  ['reactive pilot jitter 60', ['../packages/propose/parked/minus7/reactive-pilot.mjs', '200', '--jitter=60', '--assert']],
  // The pilot asserts one narrow claim, not survival: Balloon Boy never
  // reaches the office, and no Foxy death follows him taking the lights.
  ['stock device pilot', ['../packages/propose/parked/minus7/stock-device-pilot.mjs', '200', '--vent', '--sync', '--assert']],
  ['stock device pilot --worst', ['../packages/propose/parked/minus7/stock-device-pilot.mjs', '100', '--vent', '--sync', '--worst', '--assert']],
  ['stock device pilot --guard', ['../packages/propose/parked/minus7/stock-device-pilot.mjs', '200', '--night=6', '--vent', '--sync', '--assert-guard']],
  // The sparse-left Night 7 candidate is an aligned simulator contract, not a
  // device clear. Its explicit pilot offset keeps the phase dependency visible.
  ['hidpilot sparse-left', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '500', '--night=7', '--sparse-left', '--assert']],
  ['hidpilot sparse worst', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=7', '--sparse-left', '--worst', '--assert']],
  // The phone-accepted 790 ms sweep invalidates that idealized table. Preserve
  // the rejection until a different policy is consciously modeled and proven.
  ['hidpilot device reject', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=7', '--sparse-left', '--device-sweep', '--assert-rejected']],
  // The selected Night 6 left-opening route, priced against the actuator the
  // phone actually has. Held at 790 ms it dies -- and not only on stalls: a
  // 47-frame lit sweep 84 times over spends more than night 6's whole 3000
  // frame flashlight. Pulsing the light around each contact fixes the power,
  // but at the phone's proven 240 ms spacing the stun bridge across the
  // five-tick BB mask still lapses. Both rejections stay until a faster
  // camera actuator is measured on a phone.
  ['hidpilot n6 device reject', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=6',
    '--device-sweep', '--assert-rejected']],
  ['hidpilot n6 pulse reject', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=6',
    '--device-sweep', '--pulse-light', '--sweep-slot-ms=240',
    '--mask-margin-ms=800', '--pilot-offset-ms=217', '--assert-rejected']],
  // The route at the human floor's 350 ms slots: 0/200 at every offset tried
  // (0/83/167/250/300, 2026-08-25), dying to stun-lapse office attacks -- the
  // sweep span cannot bridge the five-tick mask. The left-opening architecture
  // cannot be slowed into human compliance; a human-executable night 6 needs a
  // different route shape. If this check ever flips, that is a finding.
  ['hidpilot n6 human reject', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=6',
    '--device-sweep', '--pulse-light', '--sweep-slot-ms=350',
    '--mask-margin-ms=900', '--read-latency-ms=480', '--pilot-offset-ms=167',
    '--assert-rejected']],
  // The policy target: 120 ms model slots, the pessimistic 480 ms lit-frame
  // latch, and the centre of the 83-267 ms scheduler-phase window. The device
  // emitter widens those slots to 133 ms by moving the sweep start earlier and
  // preserving its end; recipe replay and the human gate cover that actuator.
  ['hidpilot n6 target', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '500', '--night=6',
    '--device-sweep', '--pulse-light', '--sweep-slot-ms=120',
    '--mask-margin-ms=900', '--read-latency-ms=480', '--pilot-offset-ms=167',
    '--assert']],
  ['hidpilot n6 target worst', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=6',
    '--device-sweep', '--pulse-light', '--sweep-slot-ms=120',
    '--mask-margin-ms=900', '--read-latency-ms=480', '--pilot-offset-ms=167',
    '--worst', '--assert']],
  // Just past the window's upper edge (83-267 ms), so the window is a
  // measurement and not a hope. Below the edge survival is a 1-in-400
  // straggler rather than a clean zero, which is why this control sits above.
  ['hidpilot n6 off-phase', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=6',
    '--device-sweep', '--pulse-light', '--sweep-slot-ms=120',
    '--mask-margin-ms=900', '--read-latency-ms=480', '--pilot-offset-ms=300',
    '--assert-rejected']],
  // Perfect sourced events only: this guards the visual policy upper bound,
  // while plan 08's forced-miss report explicitly rejects promotion as-is.
  ['hidpilot vocal bound', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=7', '--vocal-cam5', '--assert']],
  // The bang-armed policy, and the property that makes it worth having: the
  // CAM 05 read re-syncs the count, so false positives are absorbed. Guard
  // both, because the false-tolerance is the whole argument for it over the
  // counted-vocal policy plan 08 rejected.
  ['hidpilot bang', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=7', '--bang-cam5', '--assert']],
  ['hidpilot bang false', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=7', '--bang-cam5',
    '--false-bang=2', '--assert']],
  // The cue detector's front end, on synthesised signals: the reference
  // samples are game content and live outside the repository.
  // The sweep probe is a device action, but its report stream is not: the
  // trap-2 contact discipline and the pulsed light are checked without a phone.
  ['hid sweep probe', ['../packages/play/bin/phone/test-hid-sweep-probe.mjs']],
  // The device pilot's cycle recipes and their budgets: contact lengths above
  // the phone's floor, camera spacing it has actually landed, a hall flash per
  // cycle, wind above break-even, the flashlight inside night 6's 3000 frames,
  // and the monitor/mask polarity invariants.
  ['recipe', ['../packages/propose/test/test-recipe.mjs']],
  // The microroutine oracle: the runner can record every report it sends, and
  // this audits that artifact for contact length, released time between two
  // buttons, and the trap-2 release discipline. Its self-test runs here; point
  // it at a captured trace to audit a real run.
  ['hid trace', ['../packages/propose/test/test-hid-trace.mjs']],
  // The Minus Toys device plan (plan 02 pkg 2a, device half): the ported
  // glitch loop still clears nights 2 and 7 in the exact model with the split
  // armed, the no-split control still loses, and every instruction kind and
  // control it emits is one the on-phone interpreter implements.
  ['minus toys plan', ['../packages/propose/bin/plans/test-minus-toys-plan.mjs']],
  // The per-instruction timing margin map for that plan: how far each press can
  // move before a seed dies. Pins the two facts the 2026-08-28 device-run
  // writeup rests on -- the split-arming pair has ~one Fusion poll of slack, and
  // the whole-schedule phase tolerance (33/99 ms) is far under the 302 ms epoch
  // bracket the run reported.
  ['minus toys margin', ['../packages/propose/bin/plans/test-minus-toys-margin.mjs']],
  // The robustness objective: replays the loop through a calibrated model of
  // the first device run's clock error (epoch bracket, game-vs-wall drift,
  // per-press jitter) with an optional per-hour AM re-anchor. A search fitness
  // function -- the deterministic gate's 200/200 has ~66 ms of phase tolerance
  // behind it.
  ['minus toys jitter', ['../packages/propose/bin/plans/test-minus-toys-jitter.mjs']],
  // The engine cannot price an input the port refuses, so the plan is checked
  // against the phone's measured input-acceptance gaps separately.
  ['device input gaps', ['../packages/propose/parked/minus7/test-device-input-gaps.mjs']],
  // The measured actuator as a simulator layer -- launch lateness and the
  // mask-seam monitor drop. This gates that the model reproduces the desync
  // census's band rates, keeps hold lengths, and replays under a seed.
  ['device actuator', ['../packages/propose/test/test-actuator.mjs']],
  // Nothing reaches the phone unless locally proven (2026-08-25, absolute,
  // no override). The model gate replays the plan through the engine under
  // measured human slack before the runner's first adb command, and refuses
  // old inline-schedule modes are no longer selectable; the live press floor
  // stays as the backstop for recovery actions outside the artifact. These
  // checks verify both layers against mocks, exercise the sole runner path
  // with a fake adb, and assert the shipped Night 6 plan PASSES (648/1200 with
  // the sourced Fusion LCG and measured-safe maskraise compound).
  ['human gate', ['../packages/propose/bin/plans/test-human-gate.mjs']],
  // The gate counts the deaths and prints its top four; on Night 2 that cut
  // says "Foxy, mostly" when Foxy is 58% and the office is 42%. deathchart.mjs
  // charts the whole census by the engine's own kill() reasons. This pins the
  // part that can go wrong silently: a new engine death cause with no slice,
  // and slices ordered by count rather than by character (which would repaint
  // Foxy between two panels meant to be compared).
  ['deathchart', ['device/test-deathchart.mjs']],
  // Plan 13 package 3 foundation: a labelled, nearest-centroid visual Foxy
  // cause envelope can add attribution after the last office segment, but it
  // is hard-bound to shadow mode and cannot replace lifecycle authority.
  ['death cause', ['device/test-death-cause.py']],
  // The external audio recorder must expose a fail-closed, phone-free route
  // preflight before it can create an output directory or stop monitoring.
  ['BT audio route', ['../packages/play/bin/audio/test-capture-bt-audio.sh']],
  ['BT audio link', ['../packages/play/bin/audio/test-bt-audio-link.sh']],
  // The external authority owns rendered audio and publishes the same bounded
  // fact contract regardless of its receiver. The ESP32 receiver and its
  // firmware are archived (docs/ARCHIVED-ROUTES.md); BlueALSA is the one left.
  ['audio authority', ['../packages/propose/parked/minus7/cue/test-audio-authority.py']],
  // The campaign can request any story night, so every story night must build,
  // replay and receive a verdict priced against ITS OWN AI table. Nights 1 and
  // 3 used to crash the builder on one shared message that covered two
  // opposite facts -- Balloon Boy is impossible on 1 and merely rare on 3.
  ['night matrix', ['../packages/propose/bin/plans/test-night-matrix.mjs']],
  // Nothing is pressed on the title screen that was not seen there, and New
  // Game -- which erases a save that cannot be restored -- needs a capability
  // the caller sets for one run. The structural half proves no second title
  // table exists to route around this.
  ['menu selector', ['../packages/play/bin/phone/test-menu.sh']],
  // plans/10 package 0: an interaction must be distinguishable from a dropped
  // contact and from a pan. Two nights were lost to a finger that missed a
  // light hitbox and landed in the pan band, and nothing in the run noticed.
  // The alive/dead authority, and the regression that made it one: the New Game
  // newspaper cutscene read as `night` because it is bright everywhere, and no
  // route had ever pressed New Game so the gap had never been reachable.
  ['screenstate', ['../packages/play/src/sensors/screencap/test-screenstate.py']],
  // Plan 13 package 3: a generic intro-card label needs all four measured
  // signals. It must reject the brighter pre-card cutscene, fade, office and
  // 6 AM, and must never turn "an intro exists" into a guessed night number.
  ['intro card', ['../packages/play/test/test-intro-card.py']],
  // plans/15: a classifier reads the capture method it was calibrated for and
  // refuses the rest. Resizing a foreign frame to fit is what makes a sensor
  // mismatch look like a working reading.
  ['sensor', ['../packages/play/src/sensors/screencap/test-sensor.py']],
  // FNaF 1's live loop learns its doorway ROI and normal lit-frame variation
  // from the current run. Native-only geometry and explicit UNKNOWN bands are
  // safety properties, so the synthetic gate belongs beside sensor.
  ['fnaf1 door light', ['../packages/play/games/fnaf1/test-fnaf1-door-light.py']],
  // This pins the FNaF 1-only Continue title binding, audio requirement, and
  // serial-lease wrapper without touching a phone.
  ['fnaf1 night runner', ['../packages/play/games/fnaf1/test-fnaf1-night-run.mjs']],
  // First/final PCM receipt bounds must survive an interactive stop; otherwise
  // a recorder's startup and teardown become fabricated Bluetooth loss.
  ['BT audio collector', ['../packages/play/bin/audio/test-bt-audio-collector.py']],
  // Plan 19 P3: derive a native-resolution watch adapter from labelled frames;
  // weak separation is an explicit refusal and foreign geometry is not resized.
  // Plan 22 device boundary: fit the monitorUp rule over the helper grid from
  // labelled frames. Mask/animation/blackout evidence is mandatory: a rule
  // that cannot separate the mask, contain the animation, or clear a blackout
  // refuses, and the artifact must drive the production JS detector.
  ['monitor calibration', ['../packages/play/bin/calibrate/test-monitor-calibrate.py']],
  // The cameraSelected rule: twelve measured map-button pixels; exactly one
  // lit names the camera, zero and several are distinct refusals (a camera
  // transition and the Android double-camera glitch must stay separable).
  ['camera calibration', ['../packages/play/bin/calibrate/test-camera-calibrate.py']],
  // The trainer's per-step lateness census -- the raw material for a future
  // HumanActuator's measured bands (plans/04). Checks the Coach's trace rows
  // against known lateness and the /save-trace endpoint against a temp dir,
  // no browser involved.
  ['trainer trace', ['../apps/trainer/test/trace.test.mjs']],
  // Plan 11's exact-engine policy adapter and the independently reimplemented
  // Jason/Shooter25/Couraeel baselines, with their controls: a null policy, a
  // wind-only policy, an inverted ladder and a flash-deleted Minus 7 must all
  // score zero on Night 7, and Night 1 -- whose AI table cannot arm Balloon Boy
  // -- is the positive control every family must clear.
  ['policytest', ['../packages/propose/parked/minus7/policytest.mjs', '--assert']],
  ['camtrace', ['device/test-camtrace.py']],
  // Plan 09's read-only corpus index: classify existing artifacts without
  // rewriting them, preserve basename joins, and surface unknown/empty files.
  // The dump's frame instance list, and the trap that comes with it: an
  // instance OI is in event space, named through the same XOR-28 lookup, and
  // the image the dumper wrote beside it is the XOR partner's. The 2026-08-26
  // reading had it backwards; recompiled Office positions decide it, 186/189.
  // Also gated in npm run test:unit.
  ['dump instances', ['../packages/source/decompile/test-instances.py']],
  // Unwired since it was written; the AI table is what every survival figure
  // in this repository is computed against.
  ['aimap', ['../packages/source/decompile/test-aimap.py']],
  ['observation index', ['device/test-index-observations.py']],
  // Plan 09's v1 session contract: the manifest/event schemas, and the proof
  // that each way of being malformed fails with its own reason rather than one
  // generic rejection. A validator that refuses everything identically is
  // indistinguishable from one that refuses everything.
  ['session contract', ['device/test-validate-session.py']],
  // Plan 09 package 2's producer half: one session id threaded through the
  // runners, hashes rather than filenames, and a manifest on every exit path.
  // Mock adb, synthetic artifacts, no phone.
  ['session producer', ['../packages/play/bin/phone/test-session-manifest.sh']],
  // Plan 23's retained overlay evidence must be complete before a qualification
  // sidecar can be reviewed: no-device synthetic records exercise the same
  // refusal reasons as the device-side gate.
  // Plan 23's device observer must retain enough paired telemetry to calculate
  // detector delta and render cadence, without inventing a qualified HUD run.
  // The Companion's detector, compiled and exercised on the host. CueDetector
  // imports nothing from android.*, so this needs no phone and no Android SDK
  // -- only a JDK, which test.sh probes for and fails loudly without.
  //
  // It is here because it was the one check that actually exercises the live
  // detector and it ran nowhere: not in this suite, not in ci.yml. The mock-ADB
  // regressions around it drive `query-companion.sh` against fixtures that
  // FABRICATE the detector's answers, so before this entry the detector's own
  // fail-closed behaviour -- shadow evidence cannot arm control, silence is
  // UNKNOWN, an unsupported rate refuses -- was asserted by nothing that ran.
  ['cue detector (java)', ['../android/companion/test.sh']],
  ['fnaf1 teach presenter (java)', ['../android/fnaf1-teach/test.sh']],
  ['fnaf1 teach overlay clearance', ['../packages/play/games/fnaf1/test-fnaf1-teach-overlay.py']],
  // One screen->raw transform, held to one answer over the real tap table
  // wherever it is written: the HID transport (the authority) and the
  // Companion's Java copy. Its shell and Python copies once disagreed on 24 of
  // 39 coordinates; they left with the legacy lane.
  ['screen map', ['../packages/play/bin/phone/test-screen-map.mjs']],
  // Plan 18 Package 5: parse source-side InputDispatcher evidence without a
  // phone or a trace-processor dependency in the normal checkout.
  ['input trace', ['../packages/play/bin/probe/test-inputtrace.py']],
  // Plan 18 Package 1 foundation: reproduce the three shell failures that
  // already cost recorded nights, without requiring a phone or shellcheck.
  ['shell footguns', ['../packages/play/bin/phone/test-shell-footguns.sh']],
  // Plan 18 Package 4: bounded dependency-free properties for Sim state,
  // event determinism, and sourced Night-1 reachability.
  ['engine properties', ['../packages/source/test/propertytest.mjs']],
  // The indexes are how a cold session finds anything, and nothing recomputed
  // them: TOOLS.md was missing 47 of 137 scripts including grade-run.sh, and
  // docs/README.md was missing HID-MULTITOUCH.md. Cheap, so it runs here
  // rather than being remembered.
  ['docs', ['test-docs.mjs']],
  // Same story: the transport helper every device runner picks its phone
  // with, whose exclusion reads "gated by test-select-adb.sh".
  ['select-adb', ['../packages/play/bin/phone/test-select-adb.sh']],
  // The drawer itself: every tools/device script is either invoked by
  // grade-run.sh, a test- gate, or consciously excluded with a reason -- and
  // every test- gate is actually reachable from this list or from ci.yml.
  // The tearing-vs-flash discriminator. sweepcheck reported 68/75 sweeps
  // flashed on a night where it was reading camera-switch tearing: a
  // torn-and-unlit frame's whole-ROI mean is 173 against a clean-and-lit
  // frame's 111. The four reference frames were removed on 2026-09-29 (no
  // game media beyond the two README clips); the synthetic checks remain.
  ['sweepcheck discriminator', ['device/test-sweepcheck.py']],
  ['grade-run coverage', ['device/test-grade-run-coverage.mjs']],
  ['cuetest', ['../packages/propose/parked/minus7/cue/test-cue.py']],
  ['BB cue state', ['../packages/propose/parked/minus7/test-bb-cue-state.mjs']],
  ['latency experiment', ['../packages/propose/parked/minus7/cue/test-latency-experiment.py']],
];

// These checks establish robustness margins and campaign-wide survival floors,
// rather than a local engine invariant. Keep them in the default full suite
// and CI, but let `--engine` remain a practical edit-time command.
const EXTENDED_ENGINE = new Set([
  // Green, but four minutes on its own (2026-09-24): too slow for --gates.
  'minus toys plan',
  'minus toys margin',
  'minus toys jitter',
  'night matrix',
]);

// The engine checks that are red on purpose or red pending work, each with the
// reason. `--gates` runs every other engine check, and `npm run test:unit`
// runs `--gates`, so a green check here is a CI gate rather than something a
// session has to remember to run. A backlog entry that turns green belongs out
// of this map in the same commit that fixes it.
const BACKLOG = new Map([
  // Minus 7 is parked, not retired: Pedro means to bring it back as a second
  // device-bot strategy (2026-09-24). These are the recovery list -- the route
  // predates the sourced Golden Freddy, Foxy and office-attack rules and the
  // model now kills it.
  ['simtest', 'Minus 7: the canonical cycle sweep dies 200/200'],
  ['minus7 search', 'Minus 7: the 803feb3 ladder and the item-10 oracle no longer reproduce'],
  ['reactive pilot', 'Minus 7: the BB-aware bot dies 200/200 to Golden Freddy'],
  ['reactive pilot --worst', 'Minus 7: as reactive pilot'],
  ['reactive pilot jitter 60', 'Minus 7: as reactive pilot'],
  ['hidpilot sparse-left', 'Minus 7: HID pilot, Night 7 0/500'],
  ['hidpilot sparse worst', 'Minus 7: as hidpilot sparse-left'],
  ['hidpilot n6 target', 'Minus 7: HID pilot, Night 6 below its floor (Golden Freddy)'],
  ['hidpilot n6 target worst', 'Minus 7: as hidpilot n6 target'],
  ['device input gaps', 'Minus 7: the Night 6 recipe sweeps 226 ms after the raise, under 233'],
  ['device actuator', 'Minus 7: Night 6 loop-debt exemption is now stale'],
  ['human gate', 'Minus 7: the shipped Night 6 plan is 123/1200 under human slack'],
  // Red on code the live route uses. Open defects, not controls.
  ['reactivetest', 'observer: a dropped VIDEO read is not UNKNOWN(read-dropped) on every video fact'],
  ['reduced model', 'vent press with the monitor up diverges from the Sim (true vs false)'],
  // Scientific controls that stay red until Plans 20-21 price the rescue cost.
  ['vent reactive', 'control: the reactive layer still pays a monitor-down/box cost'],
  // Not red: CI runs test-docs.mjs in its own step, and here it would also
  // read untracked files a concurrent session has not indexed yet.
  ['docs', 'run by the CI documentation step'],
]);
const BROWSER = [
  ['browsertest', ['../apps/trainer/test/browser.test.mjs']],
  ['caltest', ['../apps/trainer/test/calibration.test.mjs']],
  ['lightcheck', ['../apps/trainer/test/light.test.mjs']],
  ['phasetest', ['../apps/trainer/test/phase.test.mjs']],
  ['lessontest', ['../apps/trainer/test/lesson.test.mjs']],
  // The Pages entry: the root index.html, unbundled, from its own GET-only
  // server, the way GitHub Pages serves it; the checks above load dist/.
  ['pages entry', ['../apps/trainer/test/pages.test.mjs']],
];
const REPORTS = [
  ['minus2test', ['../packages/propose/bin/minus2test.mjs']],
  ['minus6test', ['../packages/propose/bin/minus6test.mjs']],
  ['rvctest', ['../packages/propose/bin/rvctest.mjs', '200']],
  ['androidstalltest', ['../packages/propose/test/androidstalltest.mjs']],
  // The blind schedule, still unjudged: it is what the phone runs today, and
  // it fails the assertion above by construction (200/200 BB->Foxy).
  ['stock device pilot blind', ['../packages/propose/parked/minus7/stock-device-pilot.mjs']],
  // ...and on the night the device actually selects, where the same schedule
  // reaches about 118 s instead of 48 s and still loses.
  ['stock device pilot 6th night', ['../packages/propose/parked/minus7/stock-device-pilot.mjs', '200', '--night=6', '--vent', '--sync']],
  // The same night through the measured actuator (launch lateness plus the
  // mask-seam drop). A report, not a check: survival under the model is still
  // a statement about the model.
  ['stock device pilot actuator', ['../packages/propose/parked/minus7/stock-device-pilot.mjs', '200', '--night=6', '--vent',
    '--sync', '--device-actuator']],
  // The shipped n6 target under the same actuator.
  //
  // Corrected 2026-08-26. This used to read "the price of open-loop monitor
  // toggling ... not a verdict on the live runner", on the strength of the
  // resyncing pilot surviving the same actuator better. That comparison
  // changed the ROUTE as well as the loop, and the same route with the resync
  // removed is equally tolerant. The live runner's loop was then modelled and
  // measured: it reclaims zero, at every lateness band, and so does a free,
  // instant, always-right, bidirectional one. The cliff is geometric -- camera
  // stalls lapse, occupants reach the opening, and 177/180 die to the 45-frame
  // office-defense fuse. Read this as the price of LATENESS, not of open loop.
  ['hidpilot n6 target actuator', ['../packages/propose/parked/minus7/hid-device-pilot.mjs', '200', '--night=6',
    '--device-sweep', '--pulse-light', '--sweep-slot-ms=120',
    '--mask-margin-ms=900', '--read-latency-ms=480', '--pilot-offset-ms=167',
    '--device-actuator']],
  // What the live runner's monitor loop reclaims against that, per night. The
  // answer is zero, and the controls are what make that worth printing: a
  // loop whose reads are always wrong HURTS, one that reads inside the flip
  // window causes the desyncs it looks for, and a free perfect one gains
  // nothing either.
  ['closed-loop reclaim', ['../packages/propose/parked/minus7/closed-loop-reclaim.mjs', '--runs=200']],
  // What a lateness reduction would be worth. Two controls before a table: the
  // zero row must reproduce the exact figure and the 110-300 ms row must
  // reproduce plans/12, so a drifted cell fails instead of being re-read. The
  // knee is the 2->3 frame boundary -- free to 41 ms, gone at 42.
  ['lateness sweep', ['../packages/propose/parked/minus7/latenesssweep.mjs', '--runs=200', '--assert']],
  // The measured human bands, from whatever trainer runs have been recorded.
  // Empty until practice sessions accumulate under /save-trace.
  ['tracereport', ['../apps/trainer/test/tracereport.mjs']],
];

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

function runTool(argv, { timeoutMs = 120_000, streamLabel = null } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Most checks are node; the cue front end is stdlib Python, like the rest
    // of the device tooling, so dispatch on the extension.
    const runner = argv[0].endsWith('.py') ? 'python3'
      : argv[0].endsWith('.sh') ? 'bash' : process.execPath;
    const child = spawn(runner, [join(TOOLS, argv[0]), ...argv.slice(1)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    let settled = false;
    const stream = (d) => {
      const text = d.toString();
      out += text;
      if (streamLabel) {
        process.stderr.write(text.split('\n').map((line, i, lines) => {
          const suffix = i === lines.length - 1 ? '' : '\n';
          return line ? `      [${streamLabel}] ${line}${suffix}` : suffix;
        }).join(''));
      }
    };
    child.stdout.on('data', stream);
    child.stderr.on('data', stream);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const finalCode = timedOut ? 124 : code;
      const suffix = timedOut ? `\nTIMEOUT after ${secs(timeoutMs)}\n` : '';
      resolve({ code: finalCode, out: out + suffix, ms: Date.now() - started, timedOut });
    });
  });
}

// Checks report as they land, because the browser group runs for minutes and a
// silent terminal is indistinguishable from a hung one. The verdict block that
// follows is in list order, so a run stays diffable against the last one.
async function runGroup(group, judge, { progress = false, concurrent = true, concurrency = 6 } = {}) {
  const one = async ([name, argv]) => {
    if (progress) process.stderr.write(`    ... ${name} started\n`);
    const timeoutMs = name === 'minus7 search' ? 600_000
      : name === 'vent reactive' ? 900_000
      : name === 'reactivetest' ? 300_000
        : name === 'human gate' ? 240_000
      : name === 'minus toys plan' ? 360_000
          : name.startsWith('browser') || name === 'caltest' || name === 'lessontest'
            ? 360_000 : 180_000;
    const r = await runTool(argv, {
      timeoutMs,
      streamLabel: progress ? name : null,
    });
    if (progress) process.stderr.write(`    ... ${name} finished in ${secs(r.ms)}${r.timedOut ? ' (TIMEOUT)' : ''}\n`);
    return r;
  };
  let results;
  if (concurrent) {
    results = new Array(group.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < group.length) {
        const index = cursor++;
        results[index] = await one(group[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, group.length) }, worker));
  } else {
    results = [];
    for (const entry of group) results.push(await one(entry));
  }
  let failed = 0;
  group.forEach(([name], i) => {
    const r = results[i];
    const bad = judge && r.code !== 0;
    if (bad) failed++;
    console.log(`  ${(judge ? (bad ? 'FAIL' : 'pass') : '----').padEnd(4)}  ${name.padEnd(16)} ${secs(r.ms).padStart(7)}`);
    if (bad || !judge) console.log(r.out.trimEnd().split('\n').map(l => `        ${l}`).join('\n'));
  });
  return failed;
}

// The browser checks load the built single-file page, so a stale dist/ would
// test the last build rather than the working tree.
function build() {
  return new Promise((resolve, reject) => {
    spawn('python3', [join(TRAINER_TOOLS, 'build.py')], { cwd: ROOT, stdio: 'ignore' })
      .on('close', c => c === 0 ? resolve() : reject(new Error(`build.py exited ${c}`)));
  });
}

const reachable = async () => {
  try { return (await fetch(PAGE)).ok; } catch { return false; }
};

async function serve() {
  if (await reachable()) return null;   // the user already has one running
  const child = spawn('python3', [join(TRAINER_TOOLS, 'serve.py'), String(PORT)],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    if (await reachable()) return child;
    await new Promise(r => setTimeout(r, 25));
  }
  child.kill();
  throw new Error(`apps/trainer/test/serve.py never answered on ${PORT}`);
}

const gates = process.argv.includes('--gates');
const only = process.argv.includes('--engine') || gates ? 'engine'
  : process.argv.includes('--browser') ? 'browser' : 'all';
const extended = process.argv.includes('--extended') || only === 'all';
let failed = 0;

for (const name of BACKLOG.keys())
  if (!ENGINE.some(([entry]) => entry === name))
    throw new Error(`BACKLOG names ${name}, which is not an engine check`);

let engine = extended ? ENGINE : ENGINE.filter(([name]) => !EXTENDED_ENGINE.has(name));
if (gates) engine = engine.filter(([name]) => !BACKLOG.has(name));

// `--list` prints every registered entry, one JSON object per line, with
// whether THESE flags would run it, and runs nothing. test-mistake-register.mjs
// reads it instead of re-deriving the --gates filter from this file's text.
if (process.argv.includes('--list')) {
  const selected = new Set([
    ...(only !== 'browser' ? engine : []),
    ...(only !== 'engine' ? BROWSER : []),
    ...(process.argv.includes('--reports') ? REPORTS : []),
  ]);
  for (const [group, entries] of [['engine', ENGINE], ['browser', BROWSER], ['reports', REPORTS]])
    for (const entry of entries)
      console.log(JSON.stringify({
        name: entry[0], group, path: relative(ROOT, join(TOOLS, entry[1][0])),
        args: entry[1].slice(1), selected: selected.has(entry),
        backlog: BACKLOG.get(entry[0]) ?? null, extended: EXTENDED_ENGINE.has(entry[0]),
      }));
  process.exit(0);
}

if (only !== 'browser') {
  console.log(gates ? `engine gates (${BACKLOG.size} backlog checks left out)`
    : extended ? 'engine checks (including extended model sweeps)' : 'engine checks');
  failed += await runGroup(engine, true, { progress: !gates, concurrent: true });
}

if (only !== 'engine') {
  console.log('browser checks');
  if (!chromeAvailable()) {
    console.log(`  SKIP  no Chrome at ${chromeBinary()} -- set $CHROME to override`);
  } else {
    await build();
    const server = await serve();
    try {
      failed += await runGroup(BROWSER, true,
        { progress: true, concurrent: process.argv.includes('--parallel') });
    }
    finally { server?.kill(); }
  }
}

if (process.argv.includes('--reports')) {
  console.log('reports (no pass/fail -- read the numbers)');
  await runGroup(REPORTS, false, {});
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
