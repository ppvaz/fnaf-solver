#!/usr/bin/env node
// Which producer answers each semantic fact, and which consumer believes it.
//
// The repository is rich in written knowledge and poor in REACHABLE knowledge.
// Five times on 2026-09-11 a decision was made in one place while the fact that
// governed it sat in another: a measurement in a comment, a band table a tool
// already computed, a negative recorded in PROGRESS, a gate in a lane CI never
// runs, and -- the one this file exists for -- a better classifier for a fact
// the executor was answering with a worse one.
//
// `packages/play/bin/probe/intersection-state-gate.mjs` consumes the Companion's native
// button downstroke scores and states its discipline plainly: "fitted grid
// anchors are a diagnostic fallback only" and "a missing stroke score is a
// refusal, never a luma fallback". `packages/play/src/campaign/modern-campaign-ports.js`
// answers the same maskOn question from the 20x9 grid and, when that returns
// null, falls back to exactly the luma refutation the other file forbids. Both
// were in the tree for weeks. Nothing compared them, because nothing was
// looking at facts -- only at files.
//
// So this registers the FACT, not the file: every producer of a semantic state,
// the evidence each decides on, and every consumer. `test-fact-register.mjs`
// then refuses a fact whose consumers disagree about which producer to trust.
// That disagreement is the signature of gold sitting under the project's nose.
//
//   node packages/propose/bindings/fact-register.mjs [--json] [--out FILE]
//   node packages/propose/bindings/fact-register.mjs --anchor-aim WINNER_HASH   (prints the aim, exit 3 if none)
//   node packages/propose/bindings/fact-register.mjs --anchor-max-k WINNER_HASH (prints maxK, exit 3 if none)
//   node packages/propose/bindings/fact-register.mjs --anchor-period-ms WINNER_HASH (prints the aim's timer period, exit 3 if none)
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableHash } from '@sixam/kernel/contracts';

export const SCHEMA = 'device-fact-register-v1';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

// A fact is a semantic state some part of the system decides. `evidence` names
// what a producer actually looks at, because that is what separates a strong
// producer from a weak one -- not the file it lives in.
export const FACTS = Object.freeze({
  maskOn: {
    question: 'is the mask fully on?',
    evidenceRanking: ['native-stroke', 'native-explicit', 'grid-anchor', 'grid-luma-fallback'],
    detect: [
      { evidence: 'native-stroke', match: /mask_button_downstroke|maskStroke|maskButtonDownstroke|buttonStrokeState/ },
      { evidence: 'grid-anchor', match: /measureMaskOn|parseMaskRule/ },
      { evidence: 'grid-luma-fallback', match: /MASK_OFF_GRID_LUMA_FLOOR|refutesMaskOn|grid-luma-refutation/ },
    ],
  },
  // DELEGATED, so not ranked against actuating callers. The explicit helper
  // fact is read inside `packages/play/src/sensors/fnaf2/monitor-rule.js`, and every
  // actuating caller reaches it through `measureMonitorUp`. At file
  // granularity this register cannot tell a producer from a caller that
  // delegates to one, and flagging the callers would be a false positive
  // dressed as a finding. Sharpening this needs call-level provenance, not a
  // wider regex.
  monitorUp: {
    authorityFixedByCharter: true,
    delegated: true,
    question: 'is the monitor raised?',
    evidenceRanking: ['native-explicit', 'native-stroke', 'grid-anchor'],
    detect: [
      { evidence: 'native-stroke', match: /monitor_button_downstroke|monitorStroke/ },
      { evidence: 'native-explicit', match: /fields\.monitorUp|explicitMonitor/ },
      { evidence: 'grid-anchor', match: /measureMonitorUp|parseMonitorRule/ },
    ],
  },
  // CLAUDE.md fixes the authority here: screenstate.py decides whether a night
  // is running, and "a detector which knows one way to be dead must never be
  // what says you are alive". So this fact is REPORTED and never gated on
  // "use the strongest" -- the strongest signal is not the authority.
  screenIdentity: {
    authorityFixedByCharter: true,
    question: 'which screen is on the display?',
    evidenceRanking: ['native-screen', 'python-classifier'],
    detect: [
      { evidence: 'native-screen', match: /FNAF2_NIGHT|frame\.screen|screen-identity/ },
      { evidence: 'python-classifier', match: /screenstate\.py|lifecycle-observe\.py/ },
    ],
  },
  // Same: the Python classifier is the authority that a night is running. The
  // native reads may only SHARPEN the timestamp inside the bracket the authority
  // established: `origin.refined` (adb-device-local-executor.js) and, since
  // 2026-09-12, the helper's NightOnsetLatch, which places the RELEASE at the
  // first held FNAF2_NIGHT frame + the registered aim (see ANCHOR_AIMS). The
  // latch never authorises actuation -- lifecycle's state=night still does --
  // and every anchor refusal releases as before (origin.anchor: unavailable).
  nightOrigin: {
    authorityFixedByCharter: true,
    question: 'when did the night actually start?',
    evidenceRanking: ['native-onset-latch', 'native-screen', 'python-classifier', 'intro-handoff'],
    detect: [
      { evidence: 'native-onset-latch', match: /nightOnsetImageNs|latchedNightOnsetMs|origin\.anchor|nightOnsetFromFrames/ },
      { evidence: 'native-screen', match: /NATIVE_NIGHT_SCREEN|nativeNightAt/ },
      { evidence: 'python-classifier', match: /'lifecycle'|lifecycle\(bridge/ },
      { evidence: 'intro-handoff', match: /intro-handoff/ },
    ],
  },
});

// Where the anchored release aims, PER BINDING. The aim is a number the
// executor acts on, so it lives here with the evidence that derived it, not
// as a flag default with a comment (mistake register 9: a measurement in a
// comment is not a gate). A binding without an entry gets no anchor:
// night-run.sh asks `--anchor-aim <winnerHash>` and releases the old way
// when this refuses. test-fact-register.mjs checks that every entry's
// evidence names the same binding, that the aim sits inside one of that
// evidence's winning bands with margin, that its 3000-seed confirmations are
// clean, and that the binding the newest Night 5 qualification binds HAS an
// entry -- so a rebinding cannot inherit an aim priced for another policy.
export const ANCHOR_AIMS = Object.freeze({
  'fnv1a-81b5e51c': Object.freeze({
    night: 5,
    // The aim is a SCHEDULE epoch; the game acts latencyMs later, and the
    // model's bands are effective epochs. 233 was the model band's centre and
    // held only for L < 83 ms (rep1 and anchor4 died within L of an edge);
    // 172 is the centre of the schedule band [136.67, 206.67] that keeps
    // aim + L inside [166.67, 316.67] for every stated L.
    aimMs: 172,
    latencyMs: { min: 30, max: 110, provenance: 'stated, unmeasured' },
    periodMs: 1000,
    // k = whole seconds added to the aim. 0-2 are 3000/3000; 3 and 4 lose ~11%
    // to Balloon Boy (the response is not periodic past ~2.2 s), measured on
    // the first anchored run, which delivered k=3.
    maxK: 2,
    evidence: 'docs/evidence/night5-anchor-aim-20260912.json',
    reason: 'centre of the winning band [166.67, 300]: every model row there is 5 mask ticks and 3000/3000; k is free (233/1233/2233 all 3000/3000)',
  }),
  // Night 6: the band is on Withered Foxy's five-second roll grid (g337), not
  // the one-second grid. The hallfix knobs lose at every epoch in [0, 1000)
  // and win 3000/3000 across effective epochs 2900-4950, perforated every
  // 200 ms by the 50 ms split-arming hole (g263). The aim keeps the effective
  // interval inside the window [3766.67, 3916.67) with 33 ms to each hole;
  // the bundle's gate replays at qualifiedEpochMs (winner.anchorEpochMs).
  'fnv1a-bc5e044c': Object.freeze({
    night: 6,
    aimMs: 3600,
    latencyMs: { min: 200, max: 285, provenance: 'monitor-up press-to-effect median 253 ms measured 2026-09-12; arming CAM taps unmeasured, bounds stated' },
    periodMs: 5000,
    // k=1 is aim + 5 s: the opening wind starts 8.85 s after onset and the
    // model loses 3000/3000 to a Withered inside the office.
    maxK: 0,
    qualifiedEpochMs: 3850,
    evidence: 'docs/evidence/night6-anchor-aim-20260913.json',
    reason: 'window [3766.67, 3916.67) of the Foxy-roll band: 3783.33/3816.67/3850/3883.33/3900 all 3000/3000; 3750 and 3916.67 are Puppet holes (split arming)',
    // REFUTED on the phone 2026-09-13 (night6-anchored2 199 s, night6-anchored3
    // 219 s, both Golden Freddy the second after a camdrop): the model lacked
    // g778's continuous read, and at this phase a five-second tick lands with
    // the cameras up, where he is created. Kept for the record; do not run.
    refuted: 'docs/evidence/night6-anchored-golden-freddy-20260913.md',
  }),
  // Night 6, second binding (model corrected for g778): mask off 500 ms
  // earlier and the flash at 9560 put the band where neither five-second tick
  // sees the cameras up -- Golden Freddy is never created -- and the flash
  // precedes the second tick. Band 5033-5417 effective, holes at 5117-5150
  // and 5317-5350; the aim keeps [5200, 5285] inside [5166.67, 5316.67).
  'fnv1a-94baf687': Object.freeze({
    night: 6,
    aimMs: 0,
    latencyMs: { min: 200, max: 285, provenance: 'monitor-up press-to-effect median 253 ms measured 2026-09-12; arming CAM taps unmeasured, bounds stated' },
    periodMs: 5000,
    // k=0 is the onset itself (never authorized in time); k=1 is the delivery.
    maxK: 1,
    qualifiedEpochMs: 5253,
    evidence: 'docs/evidence/night6-anchor-aim-b-20260913.json',
    reason: 'window [5166.67, 5316.67) of the Foxy-roll band with the g778 model: 5200/5250/5285 and 200/250/285 all 3000/3000',
    // night6-anchoredb1 (effective 5253): 32 gates, died at 320 s to Foxy at
    // the post-mask flash -- the band's Foxy edge is lower on the phone. The
    // same knobs re-bound with the aim 83 ms lower (next entry). Do not run.
    refuted: 'docs/evidence/night6-anchor-aim-c-20260913.json',
  }),
  // Same knobs, aim in the low half of the band: k=0 at onset + 4917 ms.
  // The model's 50 ms arming holes are bridged in the evidence on 9/9 phone
  // arms; the Foxy edge, measured once on the phone, is ~100 ms below the
  // model's 5417.
  'fnv1a-5d414fce': Object.freeze({
    night: 6,
    aimMs: 4917,
    latencyMs: { min: 200, max: 285, provenance: 'monitor-up press-to-effect median 253 ms measured 2026-09-12; arming CAM taps unmeasured, bounds stated' },
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 5170,
    evidence: 'docs/evidence/night6-anchor-aim-c-20260913.json',
    reason: 'low half of the bridged band [5033.33, 5416.67): effective [5117, 5202]; 5166.67/5200 3000/3000, the model hole 5117-5150 bridged on 9/9 phone arms',
    // night6-anchoredc1: delivered 4842 ms by frame trace (latched onset leads
    // the first night frame by 75 ms) and the true input latency is ~50 ms,
    // not the 253 ms proxy: effective ~4900, below the band; died at 81 s to
    // Balloon Boy as the model does there. Do not run.
    refuted: 'docs/evidence/night6-anchor-aim-d-20260913.json',
  }),
  // Same knobs, latency register corrected (hall-lit 47 ms, 1-82) and the
  // 75 ms onset bias applied: aim 240 with k=1 lands effective ~5225, the
  // centre of the band 5033-5417.
  'fnv1a-1292e481': Object.freeze({
    night: 6,
    aimMs: 240,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12); mask/monitor effects include animations the model already carries' },
    periodMs: 5000,
    maxK: 1,
    qualifiedEpochMs: 5300,
    evidence: 'docs/evidence/night6-anchor-aim-d-20260913.json',
    reason: 'centre of the band [5033.33, 5416.67): naive effective [5287, 5322], bias-corrected [5212, 5247]; 5200/5250/5285/5300 3000/3000',
    // night6-anchoredd2: delivered 5175 ms by frame trace (effective ~5225,
    // the band's centre) and Balloon Boy walked in at 150 s: the 4.5 s
    // fully-on window of this family does not hold him on the phone. Do not run.
    refuted: 'docs/evidence/night6-anchored-band-runs-20260913.md',
  }),
  // hallfix knobs (5.2 s mask window) with the g778 model: the only band is
  // where the second tick falls between the flash and the raise, 150 ms wide.
  // Onset bias measured by frame trace on two runs; input latency hall-lit.
  'fnv1a-1cd7cd43': Object.freeze({
    night: 6,
    aimMs: 4870,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 4850,
    evidence: 'docs/evidence/night6-anchor-aim-e-20260913.json',
    reason: 'band [4766.67, 4916.67): effective [4847, 4882]; 4816.67/4850/4883.33/4900 3000/3000',
    // night6-anchorede2: delivered 4814, died 155.5 s, Foxy D = 6 lock on the
    // mid-cycle tick -- the camdrop reset did not count. Superseded by f.
    refuted: 'docs/evidence/night6-anchorede2-audio-20260913.md',
  }),
  // Same knobs and aim as e with the camdrop light held 200 ms past the
  // monitor tap (lit-with-viewing-0 overlap ~400 ms instead of ~270; a 450 ms
  // tail overlapped the mask tap and the executor refused the macro).
  'fnv1a-3554e353': Object.freeze({
    night: 6,
    aimMs: 4870,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 4850,
    evidence: 'docs/evidence/night6-anchor-aim-f-20260913.json',
    reason: 'band [4766.67, 4916.67) as e; tail 200 (model indifferent to the tail) confirmed 3000/3000 at 4816.67/4850/4883.33/4900',
    // night6-anchoredf3: delivered 4802, died 165.5 s exactly as e2 -- the
    // camdrop tail is not the lever; FLAT post-mask flashes precede both.
    refuted: 'docs/evidence/night6-anchoredf3-20260913.md',
  }),
  // Mask off 100 ms earlier (9360): 150-200 ms between mask = 0 and the
  // flash press instead of 50-100, so the mask-off latency tail cannot
  // refuse the flash. Same aim and band.
  'fnv1a-e89a28ca': Object.freeze({
    night: 6,
    aimMs: 4870,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 4850,
    evidence: 'docs/evidence/night6-anchor-aim-g-20260913.json',
    reason: 'band [4766.67, 4916.67) as e; mask off 9360 confirmed at 3000 seeds (see evidence)',
    // night6-anchoredg1: delivered 4821, died 195.5 s -- five cycles later
    // than e/f, same lock on the roll ~130 ms after the flash press.
    refuted: 'docs/evidence/night6-anchoredg1-20260913.md',
  }),
  // Flash 9960 and mask off 9260: the flash lights ~150 ms before the roll
  // it must beat instead of 50-80. Same aim and band.
  'fnv1a-37278c63': Object.freeze({
    night: 6,
    aimMs: 4870,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 4850,
    evidence: 'docs/evidence/night6-anchor-aim-h-20260913.json',
    reason: 'band [4766.67, 4916.67) as e; flash 9960 / mask off 9260 confirmed at 3000 seeds (see evidence)',
    // WON: night6-anchoredh1-20260913T180208Z, 6 AM, 42/42, delivered 4816.
    //
    // An aim is a phase of the SCHEDULE, so it belongs to the emitted plan and
    // not to the hash of a knob set. This key is stableHash(winner), which
    // moves whenever an unrelated KNOBS0 default is added -- and it did, when
    // observeUntilMs gained one. The committed winner below emits this exact
    // plan and still won Night 6 on 2026-09-16, yet `anchorAimFor` refused it
    // for five days: the migration was written down in UNTRACKED_WINNER_DEBT's
    // prose and nothing read it (mistake register 9 -- a measurement in a
    // comment is not a gate). Every Night 6 attempt since has had to be
    // hand-fed 4870/5000/0 through the environment, and on 2026-09-20 two runs
    // released UNANCHORED because that hand-feeding was silently discarded.
    replayHash: 'fnv1a-c651e2ff',
    alsoBinds: Object.freeze({
      'fnv1a-3d5b2167': 'packages/propose/bindings/fnaf2/campaign-night6-h-winner.json',
    }),
  }),
  // h2: h with the mask coming off 300 ms later, and nothing else. Same aim,
  // same band, same 9960 flash against the same Foxy roll -- so the aim carries
  // over unchanged and was re-confirmed at 3000 seeds for this plan.
  //
  // h itself is NOT retired, but it is no longer the binding to run. Its mask
  // window is 4811 ms fully on, which spans the five ticks BB (g907/g292/g294)
  // and Mangle (g400/g401) need only at a lucky phase, and at the delivered aim
  // the fifth tick cleared the mask-off press by 131 ms of game-frame time. On
  // 2026-09-20 the same plan that went 42/42 on 2026-09-13 died twice in a row
  // on that margin: BB inside at 3 AM (which kills hallLit, so the flash cannot
  // repel Withered Foxy) and Mangle at 4 AM, both read off the retained video.
  // 5111 ms spans five at every phase. 6 AM first time out.
  'fnv1a-c27182da': Object.freeze({
    night: 6,
    aimMs: 4870,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 4850,
    evidence: 'docs/evidence/night6-anchor-aim-h2-20260920.json',
    reason: 'band [4766.67, 4916.67) as h; mask off 9560 (5111 ms fully on, five ticks at every phase) confirmed at 3000 seeds',
    replayHash: 'fnv1a-c651e2ff',
    planSha256: Object.freeze({ 6: '103bb20143c616716c3a184c02e89bdbfd49b81d55ca8485082434f8d083d696' }),
    // WON: night6-n6h2-01-20260920T024030Z, 6 AM, 42 gates, Custom Night unlocked.
  }),
  // Night 7 (10/20): the Night 6 loop shifted 2500 ms earlier with a 50 ms
  // opening wind, so the reachable release 2.45-2.62 s after the first frame
  // lands the roll ~100 ms after the post-mask flash. Strict anchor only.
  'fnv1a-651ed623': Object.freeze({
    night: 7,
    aimMs: 2510,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 2500,
    evidence: 'docs/evidence/night7-anchor-aim-i-20260913.json',
    reason: 'bridged band [2433.32, 2649.97): effective [2487, 2522]; 2450/2466.67/2500/2566.67/2600/2616.67 3000/3000, the 2517-2550 arming hole bridged on 15/15 phone arms',
    // night7-anchoredi6: released 0.014 ms from aim, died ~140 s (2 AM) to
    // Balloon Boy through the mask window. The earlier-onset answer is
    // compiler-illegal (mask control reappears lowering+416 ms) and moving the
    // lowering refutes the model; superseded by the widened-window binding j.
    refuted: 'docs/evidence/night7-anchoredi6-20260913.md',
  }),
  // Night 7, second binding: the mask window widened at its END (mask off
  // 6760, hall 7460; mask-on pinned at 1749 by the lowering+416 compiler
  // floor). Band 2383.33-2483.32 at 3000 seeds; the aim keeps the effective
  // interval inside it with the 30 ms register margin.
  'fnv1a-f337717a': Object.freeze({
    night: 7,
    aimMs: 2440,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 2450,
    evidence: 'docs/evidence/night7-anchor-aim-j-20260913.json',
    reason: 'band [2383.33, 2483.32): effective [2417, 2452]; 2383.33/2416.66/2449.99/2483.32 all 3000/3000; 2350 and 2516.65 refuted at 60 seeds',
    // night7-anchoredj12 (aim 2433): died ~61 s to Balloon Boy through the
    // 840 ms off-mask office gap, then Foxy; superseded by k2 (mask off 7000).
    refuted: 'docs/evidence/night7-first-6am-k2-20260914.json',
  }),
  // Night 7, binding k2: j with the masked end extended to 7000 (hall pinned
  // 7460, mask on pinned 1749). WON night7-k2-aim2433-maskoff7000-20260914T004106Z
  // (6 AM at 455.0 s, released 2435.5) with this aim passed as an operator
  // override; registered 2026-09-14 from a re-run census so the cohort takes
  // it from here. Band [2366.68, 2500.04] at 60 seeds; the aim keeps the
  // effective interval inside it with the 30 ms register margin.
  'fnv1a-7e4bf3e8': Object.freeze({
    night: 7,
    aimMs: 2433,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 2433,
    evidence: 'docs/evidence/night7-anchor-aim-k2-20260914.json',
    reason: 'band [2366.68, 2500.04]: effective [2410, 2445]; 2374/2416.66/2433/2449.99 all 3000/3000; 2350.01 (puppet) and 2516.71 (foxy) refuted at 60 seeds',
  }),
  // Night 7, binding k3: k2 with the hall flash at 7400 ms (Foxy edge of the
  // band 2516.71 -> 2583.39 ms). Exploratory single run, 2026-09-15.
  'fnv1a-5c8dcb5f': Object.freeze({
    night: 7,
    aimMs: 2433,
    latencyMs: { min: 47, max: 82, provenance: 'hall-lit press-to-effect n=31 min 1 median 47 max 82 ms (night5-hallfix audit, 2026-09-12)' },
    onsetBiasMs: -70,
    periodMs: 5000,
    maxK: 0,
    qualifiedEpochMs: 2433,
    evidence: 'docs/evidence/night7-anchor-aim-k3-20260915.json',
    reason: 'band [2366.68, 2500.04]: effective [2410, 2445]; 2374/2416.66/2433/2449.99 all 3000/3000; edges puppet at 2350.01 and 2516.71 (60 seeds)',
  }),
});

// Anchor bindings whose winner.json was never committed. A binding is keyed
// by stableHash(winner.json); if that file lives only in a gitignored
// artifacts/ directory on one machine, the binding cannot be rebuilt anywhere
// else -- the evidence records keep knob deltas, and the i -> j -> k2 -> k3
// chain did not reproduce k2's plan hash on 2026-09-15. Pedro, that day:
// "the run that wins on the device, the repository's most precious product,
// is not even part of it." This set is CLOSED: test-fact-register.mjs refuses
// any other ANCHOR_AIMS entry without a tracked packages/propose/bindings/<game>/*-winner.json
// of the same hash, and refuses additions here. Remove an entry by committing
// its winner (packages/propose/bindings/fnaf2/campaign-night<N>-<name>-winner.json) from the
// path each line names.
export const UNTRACKED_WINNER_DEBT = Object.freeze({
  'fnv1a-bc5e044c': 'night 6 a: found 2026-09-25 at artifacts/night6-anchored/bundle/winner.json with this ' +
    'stableHash, but not committable: it no longer rebuilds (winner.gate.replayHash does not match the ' +
    'candidate replay under the current engine), which test-winners-rebuild.mjs refuses by design',
});

/** Minimum distance, in ms, the EFFECTIVE interval [aim + Lmin, aim + Lmax] must keep from both edges of its band. */
export const ANCHOR_AIM_MIN_MARGIN_MS = 30;

/**
 * The registered binding an unregistered winner hash inherits an aim from, or
 * null. A migration is accepted only when the tree still holds the committed
 * winner the entry names AND that file hashes to the hash being asked about,
 * so the alias can never outlive the file that justifies it. Plan identity --
 * that the migrated winner emits the SAME schedule the aim was measured on --
 * is the property that makes the inheritance sound, and test-fact-register.mjs
 * re-emits the bundle to check it against `replayHash`.
 * @param {string} winnerHash
 */
function migrationFor(winnerHash) {
  for (const [registered, entry] of Object.entries(ANCHOR_AIMS)) {
    const file = entry.alsoBinds?.[winnerHash];
    if (!file) continue;
    let stored;
    try { stored = JSON.parse(readFileSync(join(ROOT, file), 'utf8')); }
    catch (error) {
      return { registered, file, reason: `anchor aim migration ${winnerHash} -> ${registered} names ${file}, ` +
        `which could not be read: ${error.message}` };
    }
    if (stableHash(stored) !== winnerHash)
      return { registered, file, reason: `anchor aim migration ${winnerHash} -> ${registered} names ${file}, ` +
        `which hashes to ${stableHash(stored)}; the aim stays with the plan, not with a stale alias` };
    return { registered, file };
  }
  return null;
}

/**
 * The registered aim for a binding, with its evidence read and checked, or a
 * refusal naming why. Never guesses: an unknown binding is `null`.
 * @param {string} winnerHash
 */
export function anchorAimFor(winnerHash) {
  const asked = winnerHash;
  let entry = ANCHOR_AIMS[winnerHash];
  let migration = null;
  if (!entry) {
    // A winner hash moves when an unrelated KNOBS0 default is added, while the
    // plan it emits does not. An aim measured on that plan still holds, so a
    // declared migration resolves it rather than sending a proven binding back
    // to an unanchored release.
    migration = migrationFor(winnerHash);
    if (migration?.reason) return { ok: false, reason: migration.reason };
    if (!migration) return { ok: false, reason: `no anchor aim registered for binding ${winnerHash}` };
    entry = ANCHOR_AIMS[migration.registered];
    winnerHash = migration.registered;
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(join(ROOT, entry.evidence), 'utf8'));
  } catch (error) {
    return { ok: false, reason: `anchor aim evidence ${entry.evidence} unreadable: ${error.message}` };
  }
  if (evidence.binding !== winnerHash)
    return { ok: false, reason: `anchor aim evidence ${entry.evidence} is for binding ${evidence.binding}, not ${winnerHash}` };
  if (evidence.night !== entry.night || evidence.aimMs !== entry.aimMs)
    return { ok: false, reason: `anchor aim evidence ${entry.evidence} disagrees with the register (night ${evidence.night}, aim ${evidence.aimMs})` };
  const latency = entry.latencyMs ?? { min: 0, max: 0 };
  // The helper's latched onset leads the frame trace's first night frame
  // (measured -65..-75 ms on 2026-09-13); an entry that states the bias is
  // checked at the epoch the phone actually delivers.
  const bias = entry.onsetBiasMs ?? 0;
  const effectiveMin = entry.aimMs + bias + latency.min;
  const effectiveMax = entry.aimMs + bias + latency.max;
  const band = (evidence.winningBands ?? []).find(b => b.fromMs + ANCHOR_AIM_MIN_MARGIN_MS <= effectiveMin &&
    effectiveMax <= b.toMs - ANCHOR_AIM_MIN_MARGIN_MS);
  if (!band)
    return { ok: false, reason: `aim ${entry.aimMs} ms + latency [${latency.min}, ${latency.max}] = effective [${effectiveMin}, ${effectiveMax}] ` +
      `is not inside a winning band of ${entry.evidence} with ${ANCHOR_AIM_MIN_MARGIN_MS} ms margin` };
  if (evidence.latencyMs && (evidence.latencyMs.min !== latency.min || evidence.latencyMs.max !== latency.max))
    return { ok: false, reason: `${entry.evidence} states latency [${evidence.latencyMs.min}, ${evidence.latencyMs.max}], the register [${latency.min}, ${latency.max}]` };
  // A bundle gated at an anchor epoch (winner.anchorEpochMs) must be gated at
  // an epoch this aim can deliver: inside the effective interval at some k.
  if (entry.qualifiedEpochMs !== undefined) {
    const period = entry.periodMs ?? 1000;
    const ks = Array.from({ length: (entry.maxK ?? 0) + 1 }, (_, k) => k);
    if (!ks.some(k => entry.qualifiedEpochMs - k * period >= effectiveMin && entry.qualifiedEpochMs - k * period <= effectiveMax))
      return { ok: false, reason: `qualified epoch ${entry.qualifiedEpochMs} ms lies outside the effective interval [${effectiveMin}, ${effectiveMax}] + k x ${period} of aim ${entry.aimMs} for k <= ${entry.maxK ?? 0}` };
  }
  const unclean = (evidence.confirmations3000 ?? []).filter(c => c.wins !== c.seeds);
  if (!evidence.confirmations3000?.length || unclean.length)
    return { ok: false, reason: `3000-seed confirmations in ${entry.evidence} are missing or not clean` };
  if (entry.maxK !== undefined) {
    const covered = evidence.confirmations3000.filter(c => c.wins === c.seeds)
      .map(c => Math.floor((c.epochMs - entry.aimMs + 1) / entry.periodMs));
    for (let k = 0; k <= entry.maxK; k += 1)
      if (!covered.includes(k))
        return { ok: false, reason: `k=${k} is allowed by the register but ${entry.evidence} has no clean 3000-seed row for aim + ${k} s` };
    if ((evidence.kLimit?.maxK ?? entry.maxK) !== entry.maxK)
      return { ok: false, reason: `${entry.evidence} limits k to ${evidence.kLimit?.maxK}, the register says ${entry.maxK}` };
  }
  return { ok: true, ...entry, band, winnerHash,
    migratedFrom: migration ? { hash: asked, winner: migration.file } : null };
}

// Where the facts' producers live: the phone's code in Play and the desktop's runners. Until the ADR
// 0002 moves most of them sat in tools/device, and a directory a producer leaves must be followed here.
const SEARCH_DIRS = ['packages/play/src', 'packages/play/bin', 'packages/play/games', 'apps/desktop/src', 'apps/desktop/bin'];
const SKIP = /^(test-|_)|\.test\.js$|fact-register/;

function sources() {
  const out = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(join(ROOT, dir)); } catch { return; }
    for (const name of entries) {
      const rel = join(dir, name);
      const full = join(ROOT, rel);
      if (statSync(full).isDirectory()) { walk(rel); continue; }
      if (!/\.(mjs|js)$/.test(name) || SKIP.test(name)) continue;
      out.push({ path: rel, text: readFileSync(full, 'utf8') });
    }
  };
  for (const dir of SEARCH_DIRS) walk(dir);
  return out;
}

export function build(files = sources()) {
  const facts = {};
  for (const [fact, spec] of Object.entries(FACTS)) {
    const producers = [];
    for (const file of files) {
      const evidence = spec.detect.filter(rule => rule.match.test(file.text))
        .map(rule => rule.evidence);
      if (evidence.length) producers.push({ file: file.path, evidence });
    }
    const used = [...new Set(producers.flatMap(p => p.evidence))]
      .sort((a, b) => spec.evidenceRanking.indexOf(a) - spec.evidenceRanking.indexOf(b));
    facts[fact] = {
      question: spec.question,
      authorityFixedByCharter: spec.authorityFixedByCharter === true,
      evidenceRanking: spec.evidenceRanking,
      strongestAvailable: used[0] ?? null,
      weakestInUse: used.at(-1) ?? null,
      producers: producers.sort((a, b) => a.file.localeCompare(b.file)),
    };
  }
  return { schema: SCHEMA, generatedFrom: SEARCH_DIRS, facts };
}

export function render(value) {
  const lines = [];
  for (const [fact, info] of Object.entries(value.facts)) {
    lines.push(`${fact} -- ${info.question}`);
    lines.push(`  ranking:  ${info.evidenceRanking.join(' > ')}`);
    lines.push(`  in use:   strongest ${info.strongestAvailable ?? 'none'}` +
      `, weakest ${info.weakestInUse ?? 'none'}`);
    for (const p of info.producers)
      lines.push(`    ${p.evidence.join(', ').padEnd(38)} ${p.file}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const aimIndex = process.argv.indexOf('--anchor-aim');
  if (aimIndex >= 0) {
    // `--anchor-aim WINNER_HASH`: print the registered aim (ms) and exit 0, or
    // print the refusal and exit 3, so a shell caller can fall back loudly.
    const found = anchorAimFor(process.argv[aimIndex + 1] ?? '');
    if (found.ok) { process.stdout.write(`${found.aimMs}\n`); process.exit(0); }
    process.stderr.write(`fact register: ${found.reason}\n`);
    process.exit(3);
  }
  const maxKIndex = process.argv.indexOf('--anchor-max-k');
  if (maxKIndex >= 0) {
    // `--anchor-max-k WINNER_HASH`: the most whole seconds past the onset the
    // aim is confirmed for. The executor refuses to anchor beyond it, and an
    // aim with no bound is refused here, so no caller anchors at an unscored k.
    const hash = process.argv[maxKIndex + 1] ?? '';
    const found = anchorAimFor(hash);
    if (found.ok && Number.isInteger(found.maxK)) { process.stdout.write(`${found.maxK}\n`); process.exit(0); }
    process.stderr.write(`fact register: ${found.ok ? `binding ${hash} registers an aim but no maxK` : found.reason}\n`);
    process.exit(3);
  }
  const periodIndex = process.argv.indexOf('--anchor-period-ms');
  if (periodIndex >= 0) {
    // `--anchor-period-ms WINNER_HASH`: the game timer period the aim is a
    // phase of. k steps by this period, so an executor given the aim without
    // it would anchor a Night 6 aim against the one-second grid.
    const hash = process.argv[periodIndex + 1] ?? '';
    const found = anchorAimFor(hash);
    if (found.ok && Number.isInteger(found.periodMs) && found.periodMs > 0) { process.stdout.write(`${found.periodMs}\n`); process.exit(0); }
    process.stderr.write(`fact register: ${found.ok ? `binding ${hash} registers an aim but no period` : found.reason}\n`);
    process.exit(3);
  }
  const value = build();
  const index = process.argv.indexOf('--out');
  if (index >= 0 && process.argv[index + 1]) {
    writeFileSync(process.argv[index + 1], `${JSON.stringify(value, null, 2)}\n`);
  }
  process.stdout.write(process.argv.includes('--json')
    ? `${JSON.stringify(value, null, 2)}\n` : `${render(value)}\n`);
}
