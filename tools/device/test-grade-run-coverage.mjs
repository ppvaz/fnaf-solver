// Gate for the rule "do not add an instrument without adding it to
// grade-run.sh". No phone required.
//
// The failure mode this closes is the one CLAUDE.md documents: the drawer is
// full of instruments and what is not remembered is not run -- screenstate.py
// could have refuted the 163 s claim from any frame, and nobody invoked it.
// So every script in tools/device must be one of three things: invoked by
// grade-run.sh, a test- gate the suite runs, or consciously excluded below
// with a reason. A new instrument fails here until that decision is made in
// the diff.
//
// The other half: every script grade-run.sh does invoke must exist, because
// the pipeline once graded a file that did not exist, printed nothing, and
// read as coverage.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Not instruments, and why. An entry here is a decision, not a formality:
// deleting one is how a script gets promoted into grade-run.sh.
const EXCLUDED = new Map([
  ['office-seed-bracket.py', 'the office frame seed bracket from a live MMFRuntime logcat; consumed by the seed-lock scorer, not by a run grade yet -- it joins grade-run.sh once runs retain mmfruntime.logcat'],
  ['grade-run.sh', 'the pipeline itself'],
  ['game-teardown.sh', 'a lifecycle action that runs AFTER a night and before there is anything to grade: it stops a target game only once title-observe.py has confirmed the title, so the post-night sequence finishes and the save is banked. It sends one force-stop and reads no run artifact; gated by test-game-teardown.sh'],
  ['fact-register.mjs', 'a generated register of which producer answers each semantic fact and on what evidence; it reads source, not a run, and test-fact-register.mjs is the gate over it'],
  ['capabilities.mjs', 'a read-only capability query about the PHONE, not a grader of a run: it sends no input and reads no pixels, and it answers which instruments this handset can feed before one is proposed'],
  ['test-seam-slack.mjs', 'a gate, not an instrument: it audits compiled plans and the timing floors themselves, and is registered in npm run test:unit'],
  ['test-anchor-aim-band.mjs', 'a gate, not an instrument: it multiplies each ANCHOR_AIMS entry out through its own onset bias and input latency and checks the effective epoch lands in a confirmed winning band. It reads the register and evidence records, never a run; registered in npm run test:unit'],
  ['test-schedule-economy.mjs', 'a gate, not an instrument: it derives a night prefix from aiUpdates and a box safe-stop from the drain table, then audits emitted plans against them. It reads source and the model, never a run; registered in npm run test:unit'],
  ['strategy-night-matrix.mjs', 'a coverage report over the emitters, not a grader of a run: it asks which (strategy, night) cells the registered emitters can compile against the resolved profile and what the emitted plan scores in its own replay. It reads source and the model, never a recording, and it sends no input -- the nearest analogue here is capabilities.mjs, which asks the same shape of question about the phone'],
  ['night-run.sh', 'the attempt driver that CALLS grade-run.sh from its exit trap -- wiring it in would recurse; it produces the run this pipeline grades'],
  ['fnaf1-night-run.mjs', 'FNaF 1-specific attempt driver: it retains native screenshots and passive Bluetooth audio while running a title-gated Continue-only loop; it is separate from FNaF 2 night-run.sh so the default title model cannot reach it, and test-fnaf1-night-run.mjs gates its binding/lease/audio contract'],
  ['fnaf1-night-run.sh', 'thin exclusive-lease wrapper around fnaf1-night-run.mjs, covered structurally by test-fnaf1-night-run.mjs; it sends no controls of its own'],
  ['fnaf1-teach-overlay.sh', 'FNaF 1-only passive teaching-presenter control: it only verifies/updates a user-started non-touchable overlay through its own DUMP contract, never reads a game screen or grades a run; test-fnaf1-teach-overlay.py gates its FNaF 1-only geometry and control clearance'],
  ['fnaf1-menu-probe.mjs', 'FNaF 1 menu calibration probe: it captures the title and Custom Night screens and walks the dials under checked single presses to learn their geometry and glyphs; it produces model inputs, never grades a night; test-fnaf1-menu-probe.mjs gates its argument, target and step contract'],
  ['fnaf1-menu-probe.sh', 'thin exclusive-lease wrapper around fnaf1-menu-probe.mjs; it sends no input of its own'],
  ['fnaf1-custom-night-read.py', 'reads the four FNaF 1 Custom Night dials off one native frame for the menu probe; a menu reader, not a run grader, gated by test-fnaf1-menus.py'],
  ['fnaf1-door-light.py', 'per-run native FNaF 1 door-light calibration and occupancy reader; it derives the current run\'s ROI/bands rather than grading a completed run, and test-fnaf1-door-light.py gates its native-only and UNKNOWN behavior'],
  ['hid-intersection-probe.mjs', 'device probe generator -- emits an intersection stream to a phone rather than grading a night run'],
  ['hid-intersection-probe.sh', 'device probe runner for hid-intersection-probe.mjs; it acts on a phone rather than grading a run'],
  ['intersection-state-gate.mjs', 'pure control-intersection state gate consumed by the executor, gated by test-intersection-state-gate.mjs; it decides a press rather than grading a run'],
  ['screenstate.py', 'the live alive/dead authority; grade-night.py applies its predicate to recordings'],
  ['death-prediction.mjs', 'runs BEFORE a run, not after it: writes the model\'s death prediction (killer shares, time quantiles over phases) that night-run.sh retains as prediction.json; grading reads that file, it does not regenerate it -- gated by test-bundle.mjs through the DEATH_TARGETED gate it produces'],
  ['tickphase.py', 'reads the retained Bluetooth audio (night-run.sh --bt-audio) after a run: roll-witness onsets and WinD folds. Run by hand while its thresholds and the clock-rate correction are being calibrated (2026-09-13); it joins grade-run.sh once a fold-based phase read survives a second run'],
  ['epoch-scan.mjs', 'runs BEFORE a run: a model census over release epochs (the bands an anchor aim is priced on); never reads a recording'],
  ['cycle-ledger.py', 'reads the retained video (and audio census) after a run; run by hand while its flash classes and colour rule are calibrated on Night 6 recordings (2026-09-13); its cycle timings come from the winner of the bundle the run names (test-cycle-ledger.py, 2026-09-14); joins grade-run.sh with tickphase.py'],
  ['night7-presets.mjs', 'a model scorer that runs BEFORE any run and never reads a recording: it replays the Minus Toys schedule against the ten Custom Night presets over a fixed seed cohort, in an exact lane and an actuator lane, to price the route and its timing floors. It sends no input to a phone. The gate over it is test-night7-presets.mjs, registered in npm run test:unit'],
  ['night7-robustness.mjs', 'a model scorer that runs BEFORE any run and never reads a recording: it ranks the preset schedule and the committed Night 7 bindings by phase band, per-press lateness and +-60 ms jitter over held-out seeds. It sends no input to a phone. The gate over its record is test-night7-presets.mjs, registered in npm run test:unit'],
  ['custom-night-readback.py', 'a Custom Night observer the campaign composes before a Night 7 run (dial readback); not a grader'],
  ['death-census.py', 'cross-run census -- answers "what keeps happening", not "what happened in this run"'],
  ['deathchart.mjs', 'charts the model gate\'s death census for a PLAN under modeled human slack -- a simulator result with no run artifact to read; gated by test-deathchart.mjs'],
  ['find-events.py', 'mask-camp trial scrubber, not a night-run grader'],
  ['index-observations.py', 'read-only corpus inventory; indexes artifacts rather than grading one run'],
  ['actuator.mjs', 'simulator layer, gated by test-actuator.mjs'],
  ['bb-cue-state.mjs', 'pure BB route uncertainty state machine, gated by test-bb-cue-state.mjs'],
  ['gate-worker.mjs', 'pure worker for test-night-matrix.mjs; it simulates gate chunks and has no run artifacts to grade'],
  ['windtrace.mjs', 'grades a MODEL, not a run: it replays the plan and reports what fraction of its wind frames the engine credited. There is no device counterpart -- the box level is not observable on the phone beyond the CAM 11 pie that windpct.py reads -- so grade-run.sh has nothing to hand it'],
  ['recipe.mjs', 'library, gated by test-recipe.mjs'],
  ['minus-toys-plan.mjs', 'device plan emitter + model gate for Minus Toys, gated by test-minus-toys-plan.mjs; bundle.mjs compiles it and it has no run to grade'],
  ['arm-verification.mjs', 'shared camera-pair constants for strategy arming headers and host verification; not a run grader, covered by test-minus-toys-plan.mjs'],
  ['policy-ir.mjs', 'finite policy artifact builder, gated by test-policy-ir.mjs; it creates a program rather than grading a run'],
  ['policy-interpreter.mjs', 'finite semantic compiler and exact-engine adapter, gated by test-policy-interpreter.mjs; it consumes policy data rather than a device run'],
  ['policy-grammar.mjs', 'finite policy grammar library, gated by tools/policygrammartest.mjs; it validates candidates rather than grading a device run'],
  ['policy-equivalence.mjs', 'IR/device/mock-phone equivalence compiler, gated by tools/policyequivalencetest.mjs; it audits artifacts rather than grading a device run'],
  ['policy-search.mjs', 'explicit-dimension structural search library, gated by tools/policysearchtest.mjs; it emits a campaign report rather than grading a live run'],
  ['policy-artifact.mjs', 'compiled policy artifact builder/verifier, gated by tools/policyartifacttest.mjs; it creates execution provenance rather than grading a device run'],
  ['watch-calibrate.py', 'native PixelWatch spec builder, gated by test-watch-calibrate.py; calibration frames are inputs, not a night-run artifact'],
  ['native-regions.mjs', 'Cue Helper native-region reader: registers rectangles, measures read latency and records calibration corpora; a live observation path and corpus tool, not a post-run grader'],
  ['native-frame.mjs', 'Cue Helper SNAP puller: one native frame as a PNG for title/menu readers and calibration; an observation path, not a post-run grader'],
  ['fnaf1-custom-run.sh', 'lease wrapper for the FNaF 1 Custom Night runner; a live route/calibration executor, not a post-run grader'],
  ['fnaf1-custom-run.mjs', 'FNaF 1 Custom Night runner (calibrate-empty, grid420) behind fnaf1-custom-run.sh; an executor, gated by test-native-regions.mjs'],
  ['fnaf1-detectors.mjs', 'builds FNaF 1 empty-scene templates from a calibration run and classifies REGION reads for the runner; gated by test-native-regions.mjs'],
  ['fnaf4-run.sh', 'lease wrapper for the FNaF 4 night runner; a live route/calibration executor, not a post-run grader'],
  ['fnaf4-run.mjs', 'FNaF 4 night runner (calibrate, loop) behind fnaf4-run.sh; an executor, its teach panel clearance gated by test-native-regions.mjs'],
  ['fnaf3-run.sh', 'lease wrapper for the FNaF 3 night runner; a live route/calibration executor, not a post-run grader'],
  ['fnaf3-run.mjs', 'FNaF 3 night runner (calibrate, loop) behind fnaf3-run.sh; an executor, gated by test-fnaf3-run.mjs and its teach panel clearance by test-native-regions.mjs'],
  ['fnaf3-detectors.mjs', 'FNaF 3 frame readers and per-camera empty templates built from a calibration run; a model builder and in-night reader, gated by test-fnaf3-run.mjs'],
  ['night-kit.mjs', 'the region recorder, run record, actor and video every night runner shares; a library of executors, not a post-run grader'],
  ['fnaf4-detectors.py', 'builds FNaF 4 view templates from a calibration run (held-out accuracy refusal); a model builder, not a post-run grader'],
  ['explore-step.mjs', 'one bounded exploration step (a contact and a native SNAP) for learning a game\'s controls; an operator tool, not a post-run grader'],
  ['fnaf1-calibration-analyze.mjs', 'offline reader of a FNaF 1 calibration record (press-to-frame latency, office onset, hour change); a calibration tool, not a night grader'],
  ['test-native-regions.mjs', 'the gate for the REGION codec, the FNaF 1 classifier and the runner refusals; runs in npm run test:unit'],
  ['fnaf1-teach-media.py', 'cuts a FNaF 1 run video into a README GIF and phone videos; a presentation tool, not a grader'],
  ['camera-calibrate.py', 'native cameraSelected rule builder, gated by test-camera-calibrate.py; labelled calibration frames are inputs, not a night-run artifact'],
  ['monitor-calibrate.py', 'native monitorUp rule builder, gated by test-monitor-calibrate.py; labelled calibration frames are inputs, not a night-run artifact'],
  ['minus-toys-margin.mjs', 'per-instruction timing margin map for the Minus Toys plan -- a model analysis, no run artifact to read; gated by test-minus-toys-margin.mjs'],
  ['minus-toys-jitter.mjs', 'robustness evaluator for the Minus Toys plan -- replays the model under a calibrated clock-error ensemble, no run artifact to read; gated by test-minus-toys-jitter.mjs'],
  ['human-gate.mjs', 'pre-flight gate on plan files, gated by test-human-gate.mjs'],
  ['pan-shift.py', 'measuring stick for pan-probe.sh; the scroll is better read from the dump'],
  ['nightpredicate.py', 'the one definition of the alive/dead rule that screenstate.py and grade-night.py both evaluate; a library, gated by test-screenstate.py'],
  ['sensor.py', 'the capture-method declaration every classifier reads through; a library, gated by test-sensor.py'],
  ['lifecycle-observe.py', 'refines screenstate.py\'s `other` into named screens; a live observer, gated by test-screenstate.py'],
  ['intro_card.py', 'fractional generic intro-card predicate used by lifecycle-observe.py/run-timeline.py; gated by test-intro-card.py'],
  ['death-cause.py', 'shadow-only labelled visual-cause model builder used by run-timeline.py when explicitly supplied; it builds a model rather than grading a run, gated by test-death-cause.py'],
  ['atrace-input.sh', 'trace capture wrapper that brackets a command and writes device evidence; inputtrace.py grades the resulting trace when present'],
  ['framesource.py', 'the one frame source every video instrument decodes through (ffmpeg privately, or the shared single decode when the pipeline offers a pipe); a library, gated by test-framesource.py'],
  ['hid-sweep-probe.mjs', 'device probe'],
  ['session-manifest.py', 'the manifest producer -- grade-run.sh consumes its output through validate-session.py; gated by test-session-manifest.sh'],
  ['session.sh', 'sourced helper that threads one session id through the producers, gated by test-session-manifest.sh'],
  ['validate-overlay-qualification.py', 'validates retained Plan 23 overlay evidence; it gates a qualification record rather than grading a night, gated by test-overlay-qualification.py'],
  ['overlay-qualification-observe.sh', 'retains paired Plan 23 HUD/off visual latency, draw cadence, resource, and lifecycle telemetry; gated by test-overlay-qualification-observe.sh'],
  ['provision-overlay-qualification.sh', 'installs a reviewed Plan 23 sidecar into app-private storage; a provisioner, not a run grader, and it must never invent device qualification'],
  ['collect-cue-audio.sh', 'capture helper'],
  ['coords.sh', 'coordinate helper'],
  ['menu.sh', 'the title/menu selector runners source, mock-gated by test-menu.sh'],
  ['title-observe.py', 'live title observer, mock-gated by test-menu.sh -- it classifies a menu, not a run'],
  ['fnaf1-title-observe.sh', 'FNaF 1-only title-observer wrapper: it removes the FNaF 2 default model and passes FNaF 1\'s model explicitly; test-sensor.py proves an inherited FNaF 2 model cannot be used'],
  ['query-cue-helper.sh', 'live helper, mock-gated by test-query-cue-helper.sh'],
  ['provision-cue-model.sh', 'installs a generated model into the helper\'s private storage on a phone; a provisioner, not a grader -- it has no run to read'],
  ['soak-cue-helper.sh', 'live helper, mock-gated by test-soak-cue-helper.sh'],
  ['select-adb.sh', 'transport helper, gated by test-select-adb.sh'],

  // Added 2026-09-08. These nineteen accumulated after the list was last
  // extended, and the registry bug above hid them behind twelve false
  // "nothing runs" complaints. Each reason below was checked against the
  // gate or caller it names -- an unchecked reason is the drawer problem
  // again, and four earlier exclusions cited gates that did not run.
  ['bundle.mjs', 'winner -> device-bundle compiler and validator, gated by test-bundle.mjs; it builds an artifact rather than grading a run'],
  ['artifact-commands.mjs', 'plan-row -> semantic block compiler, gated by test-bundle.mjs and test-artifact-animation-gates.mjs'],
  ['emit.mjs', 'the device:emit entry point over bundle.mjs, gated by test-bundle.mjs'],
  ['closed-families.mjs', 'closed-family duplicate control imported by policy-search.mjs, gated by tools/observationlanguagetest.mjs'],
  ['minus-3-plan.mjs', 'device plan emitter + model gate for the Minus 3 route, gated by test-minus3-frame-light.mjs; bundle.mjs compiles it and it has no run to grade'],
  ['minus3-frame-light.mjs', 'the device-proven Minus 3 frame-light recipe and its edge-hash checks, gated by test-minus3-frame-light.mjs'],
  ['mask-calibrate.py', 'maskOn grid-anchor fitter, gated by test-mask-calibrate.py; calibration frames are inputs, not a night-run artifact'],
  ['cue-helper-setup.py', 'helper setup and target-menu check, gated by test-cue-helper-setup.py; it prepares a session rather than grading one'],
  ['cue-helper-queue.py', 'persistent job queue for absent-device work, gated by test-cue-helper-queue.py'],
  ['cue_helper_device_lock.py', 'per-serial exclusive lease library, gated by test-cue-helper-device-lock.py'],
  ['device-lock-exec.py', 'holds the lease around one bounded command, gated by test-cue-helper-device-lock.py'],
  ['cue-helper-setup.sh', 'thin one-serial wrapper; all UI work and every gate belong to cue-helper-setup.py'],
  ['cue-helper-queue.sh', 'thin wrapper that deliberately does NOT select a device, so enqueue/list work while the phone is absent; the queue gate is test-cue-helper-queue.py'],
  ['cue-helper-mcp.mjs', 'bounded MCP entry point over the queue, gated by test-cue-helper-mcp.mjs'],

  // The three below have NO gate. They are excused here so the check can be
  // green about the other 216 scripts, and they are recorded as open gaps in
  // docs/architecture/DUPLICATE-IMPLEMENTATION-MAP.md rather than left to
  // read as covered. Do not extend this block without a reason this specific.
  ['screen-calibrate.py', 'GAP: screen-class anchor fitter with no gate of its own -- the only one of the five calibrate fitters without one. Fits a rule adapters consume on device, so it wants a synthetic-frame gate of its own, modelled on the maskOn fitter\'s'],
  ['validate-session.py', 'Plan 09 session-manifest validator, run by session-manifest.py when a session producer (collect-cue-audio.sh, capture-screen-sample.sh) finalizes; night-run.sh writes no session manifest, so no night has one to grade; gated by test-validate-session.py'],
]);

// tools/cue and tools/dump, under the same rule. The audit that widened this
// scan noted the hole: CLAUDE.md's purest "instrument nobody runs" example is
// tools/cue/detect.py, and this check did not look at it.
const SIBLING_EXCLUDED = new Map([
  ['audio-authority.py', 'live rendered-audio authority and run input, not a grader; gated by test-audio-authority.py'],
  ['bridge-audio-authority.py', 'live transport bridge into Cue Helper, not a run artifact grader; gated by test-bridge-audio-authority.py'],
  ['collect-facts.py', 'fact sidecar producer for the external audio authority (latency-experiment.py); it produces facts rather than grading a run'],
  ['latency-experiment.py', 'paired calibration experiment harness that creates evidence rather than grading a night; gated by test-latency-experiment.py'],
  ['detect.py', 'the bang detector scan-night.sh drives'],
  ['scan-night.sh', 'the Balloon Boy bang scan over a receiver PCM capture. grade-run.sh called it only for the legacy trial.sh lane, the one that kept such a capture; night-run.sh keeps the A2DP mix instead, which it has never been pointed at, so it runs by hand (2026-09-25)'],
  ['features.py', 'feature extraction library for detect.py/evaluate.py, gated by test-cue.py'],
  ['correlate.py', 'offline waveform cross-correlation -- the control that refuted the 22 thuds, run by hand against a chosen pair'],
  ['build-shadow-windows.py', 'joins raw helper results to independently established labels and anchored PCM, gated by test-build-shadow-windows.py; it prepares a corpus rather than grading one run'],
  ['evaluate.py', 'offline sweep harness over labelled audio; reports a matrix, grades no run'],
  ['evaluate-shadow.py', 'whole-session held-out evaluator over a labelled shadow corpus, gated by test-evaluate-shadow.py; it grades a model rather than one night run'],
  ['export-model.py', 'model builder and exact-model promotion gate for the on-phone detector, gated by test-export-model.py'],
  ['label-misses.py', 'labelling aid for building the reference set'],
  ['reference-report.py', 'inventory of the reference samples, which live outside the repository'],
  ['aimap.py', 'AI-table extractor from the event-sheet dump, gated by test-aimap.py'],
  ['nightmap.py', 'per-game night reader over any of the four event-sheet dumps -- clock, difficulty table, rolls, movement edges and draw census, gated by test-nightmap.py; it reads source, not a run'],
  ['readdump.py', 'event-sheet dump reader library, gated by test-instances.py'],
  ['coverage.py', 'group-coverage report over the dump; answers what is unread, not what a run did'],
  ['extract-samples.sh', 'asset extraction helper for the audio path'],
  ['capture-bt-audio.sh', 'records the phone A2DP mix via BlueALSA for offline cue proofing; a recorder that writes game audio outside the repo, grades no run'],
  ['bt-audio-collector.py', 'receiver-side BlueALSA PCM collector that retains first/final receipt bounds and a terminal SIGINT state; gated by test-bt-audio-collector.py'],
  ['fnaf4-cues.py', 'FNaF 4 live A2DP cue detector the FNaF 4 runner spawns during a night (matched filters, breathing level); an in-night sensor, not a post-run grader'],
  ['bt-audio-link.sh', 'brings the phone A2DP link up before a capture (night-run.sh --bt-audio); a link action on the phone and BlueALSA, grades no run'],
  ['regen-dump.sh', 'regenerates the event-sheet dump from the APK'],
  ['census.mjs', 'seed census over a game simulator -- a model result, not a run grading; gated by test-fnaf1-census.mjs and test-fnaf3-census.mjs'],
]);

const sh = readFileSync(join(HERE, 'grade-run.sh'), 'utf8');
let failed = 0;
const complain = (message) => { console.error(message); failed = 1; };

// A full 420-second Moto recording is not a small test fixture: decoding it
// into one Python byte string costs gigabytes before the classifier starts.
// These are the full-run graders grade-run.sh invokes; keep their decoders
// streaming and leave the runner's memory/time fuse visible in the contract.
// A grader streams either through its own `subprocess.Popen` or through
// framesource.frames(), the shared seam that streams from ffmpeg or from the
// single shared decode's pipe; framesource.py itself must stream.
for (const name of ['grade-night.py', 'camtrace.py', 'windpct.py',
                    'grade-minus7.py', 'run-timeline.py', 'keyframes.py', 'sweepcheck.py']) {
  const body = readFileSync(join(HERE, name), 'utf8');
  const streams = body.includes('framesource.frames(') || body.includes('subprocess.Popen');
  if (!streams || body.includes('capture_output=True'))
    complain(`${name} is a full-run grader but no longer has a streaming decoder`);
}
const framesource = readFileSync(join(HERE, 'framesource.py'), 'utf8');
if (!framesource.includes('subprocess.Popen') || framesource.includes('capture_output=True'))
  complain('framesource.py must stream frames, never buffer a decode');
const sweepcheck = readFileSync(join(HERE, 'sweepcheck.py'), 'utf8');
if (/list\(stream\(/.test(sweepcheck))
  complain('sweepcheck.py buffers full decoded streams instead of derived features');
if (!/GRADE_MAX_VMEM_KB="\$\{GRADE_MAX_VMEM_KB:-2097152\}"/.test(sh) ||
    !/timeout --foreground/.test(sh) || !/taskset -c "\$GRADE_CPUSET"/.test(sh))
  complain('grade-run.sh lost its per-instrument resource fuse or Linux CPU pin');

// Invocation lines only. The header's prose names instruments the script never
// runs -- counting those as covered is exactly the lie this check exists for.
const invocations = sh.split('\n').filter((line) => !/^\s*#/.test(line));
const referenced = new Set();
for (const line of invocations)
  for (const m of line.matchAll(/\$HERE\/((?:\.\.\/)?[\w./-]+\.(?:py|mjs|sh))/g))
    referenced.add(m[1]);

for (const ref of referenced)
  if (!existsSync(resolve(HERE, ref)))
    complain(`grade-run.sh invokes ${ref}, which does not exist -- ` +
      'that step will silently grade nothing');

// What actually runs a gate: this suite's registry, and CI's workflow. Read
// rather than assumed -- that distinction is the whole point of this block.
//
// Registry entries only, never prose -- for the same reason grade-run.sh is
// read invocation-line-only above. Caught by its own positive control: the
// first version of this check used a substring match, and a COMMENT here
// naming `test-select-adb.sh` was enough to report the file as run while its
// registry entry was deleted. A check that a mention satisfies is a check
// that measures documentation.
const scriptNames = (text) => {
  const found = new Set();
  for (const line of text.split('\n')) {
    if (/^\s*(#|\/\/)/.test(line)) continue;
    for (const m of line.matchAll(/['"`]([\w./-]+\.(?:py|mjs|sh))['"`]/g)) {
      found.add(m[1]);
      found.add(m[1].split('/').pop());
    }
  }
  return found;
};
const suitePath = join(HERE, '..', 'test.mjs');
const ciPath = join(HERE, '..', '..', '.github', 'workflows', 'ci.yml');
const registered = scriptNames(readFileSync(suitePath, 'utf8'));
// CI invokes gates as shell command lines rather than quoted strings.
const ci = existsSync(ciPath) ? readFileSync(ciPath, 'utf8') : '';
const ciNames = new Set();
for (const line of ci.split('\n')) {
  if (/^\s*#/.test(line)) continue;
  for (const m of line.matchAll(/([\w./-]+\.(?:py|mjs|sh))/g))
    ciNames.add(m[1].split('/').pop());
}
// The third registry. CI's lanes are `npm run test:contracts` and
// `npm run test:core`, so a gate whose only registration is a package.json
// script command line IS run -- and reading only tools/test.mjs and ci.yml
// reported eleven such gates as "a gate that nothing runs", including every
// cue-helper gate and three of the calibration gates. A checker that knows
// one of two registries measures the registry it knows, not the coverage.
const pkgPath = join(HERE, '..', '..', 'package.json');
const scriptNamesRun = new Set();
for (const command of Object.values(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}))
  for (const m of String(command).matchAll(/([\w./-]+\.(?:py|mjs|sh))/g))
    scriptNamesRun.add(m[1].split('/').pop());

const runs = (gate) => {
  const base = gate.split('/').pop();
  return registered.has(gate) || ciNames.has(base) || scriptNamesRun.has(base);
};

for (const name of readdirSync(HERE).sort()) {
  if (!/\.(py|mjs|sh)$/.test(name)) continue;
  if (name.startsWith('test-')) {
    // This used to be `continue`, under the comment "suite gates, run by
    // tools/test.mjs". That comment was an assumption, and it was false for
    // five files -- including two that four exclusions below named as their
    // justification. A gate nobody runs excusing a script from coverage is
    // the drawer problem wearing the uniform of the fix for it.
    if (!runs(name))
      complain(`${name} is a gate that nothing runs -- it is in none of ` +
        'tools/test.mjs, package.json scripts, or .github/workflows/ci.yml. ' +
        'Register it, or delete it.');
    continue;
  }
  if (referenced.has(name)) continue;
  if (EXCLUDED.has(name)) continue;
  complain(`${name} is neither invoked by grade-run.sh nor excluded here. ` +
    'Wire it into grade-run.sh, or record above why it is not an instrument.');
}

// A stale exclusion reads as "not an instrument" about something the pipeline
// runs, so it dies the moment it stops being true.
for (const name of EXCLUDED.keys())
  if (referenced.has(name))
    complain(`${name} is excluded but grade-run.sh invokes it -- delete the stale exclusion`);

// The reasons are free text and nothing parsed them, so a script could drop
// out of coverage by citing a gate that did not exist or did not run -- and
// four did. Any `test-*` file a reason names is now resolved and checked.
for (const [name, reason] of EXCLUDED) {
  for (const m of reason.matchAll(/\btest-[\w.-]+\.(?:py|mjs|sh)\b/g)) {
    const gate = m[0];
    if (!existsSync(join(HERE, gate)))
      complain(`${name} is excused because of ${gate}, which does not exist`);
    else if (!runs(gate))
      complain(`${name} is excused because of ${gate}, which nothing runs -- ` +
        'register that gate in tools/test.mjs or ci.yml, or excuse this differently');
  }
  if (!reason.trim())
    complain(`${name} is excluded with no reason at all -- an exclusion is a ` +
      'decision, and a blank one records nothing for the next reader');
}

// The rule is "do not add an instrument without adding it to grade-run.sh",
// and it was scoped to this directory only -- while CLAUDE.md's purest
// example of an instrument nobody runs lives in tools/cue. A sibling
// directory is not a loophole.
for (const dir of ['cue', 'dump']) {
  const path = join(HERE, '..', dir);
  if (!existsSync(path)) continue;
  for (const name of readdirSync(path).sort()) {
    if (!/\.(py|mjs|sh)$/.test(name)) continue;
    const rel = `../${dir}/${name}`;
    if (name.startsWith('test-')) {
      if (!runs(name))
        complain(`${rel} is a gate that nothing runs -- register it in ` +
          'tools/test.mjs or .github/workflows/ci.yml, or delete it.');
      continue;
    }
    if (referenced.has(rel)) continue;
    if (SIBLING_EXCLUDED.has(name)) continue;
    complain(`${rel} is neither invoked by grade-run.sh nor excluded. ` +
      'Wire it in, or record why it is not an instrument.');
  }
}

if (!failed) console.log(`grade-run.sh coverage: ${referenced.size} scripts invoked, ` +
  `${EXCLUDED.size + SIBLING_EXCLUDED.size} exclusions across device/cue/dump, ` +
  'every gate reachable, nothing unaccounted for');
process.exit(failed);
