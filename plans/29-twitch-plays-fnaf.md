# Twitch Plays FNaF: collective play with pause through the recompile

**Status:** proposed, 2026-10-05, at Pedro's request. Implementation and public
broadcast remain open. **Classification:** research followed by a feature;
this plan is bookkeeping and closes no roadmap step.

## Goal and place on the path

Let Twitch chat collectively survive a FNaF night by choosing bounded game
actions, with time to deliberate provided by an explicit pause in the
recompiled runtime. Start with FNaF 2 Night 1. Progress toward harder nights
only after the controls, pause fidelity and stream pacing work.

The audience question is: **can chat coordinate well enough to reach 6 AM?**
The engineering question is: **can wall-time deliberation be inserted without
changing the game trace for the same seed and landed input sequence?**

This consumes [ROADMAP S2](ROADMAP.md#s2-fidelity-at-the-level-of-encounters)'s
recompile and supports S5's teaching tools and S6's interface. It does not
close their existing conditions. A crowd clear with pauses is a modified play
condition; it is neither a counted retail-phone human clear nor evidence of
phone trace equivalence. S1-S4 retain their own gates.

Dependencies: [Plan 17](17-in-apk-bot.md)'s recompile, the
[runtime toolchain](../packages/source/recompile/README.md),
[architecture](../docs/architecture/README.md), and
[evidence policy](../docs/evidence/README.md). Additional games depend on
[Plan 26](26-second-target-fnaf-1-3-4.md); the first pilot needs only FNaF 2.

## Basis and unanswered questions

| Basis | What it supports | What remains UNKNOWN |
|---|---|---|
| The committed [runtime patch](../packages/source/recompile/mmfparser-chowdren-mobile.patch), `pilot_exchange` and `harness_after_events` | A controller receives state after each update and withholds the `E` terminator to stop further updates; touches apply on the following update and are logged | A rendered, responsive pause boundary, audio freeze, and disconnect behavior suitable for live viewers |
| The [pilot runner](../packages/propose/bin/recompile/pilot/pilot.ts) | Existing TCP exchange and replayable landed touches; its present game modules are FNaF 3 and 4 | FNaF 2 chat integration; the runner's current headless configuration is not a broadcast player |
| [Pilot development record](../docs/evidence/rebuild-pilot-dev-blocks-20260930.json) | MODEL_ONLY rebuilt-runtime pilots and retained replay comparisons | Whether people can play through these controls; the development blocks estimate no audience or success rate |
| [FNaF 2 full-06 rebuild record](../docs/evidence/rebuild-release20-full06-20261001.json), `recompile-phone-encounters-7f49b8e5a17f9754` | A FNaF 2 replay reaches 6 AM, while encounter disagreement with the phone remains explicit | General phone fidelity; pause invariance |
| [Twitch chat documentation](https://dev.twitch.tv/docs/chat/) consulted 2026-10-05 | EventSub receives chat messages and the Twitch API sends chat responses | End-to-end video/chat latency for this channel and viewer devices |

The existing wait occurs before drawing the completed update. It can leave the
display one update behind the controller's state. The current pilot channel
also stops controlling on EOF or `quit`, allowing gameplay to continue. Both
need characterization before adapting the harness for a live session.

Audience appeal is a hypothesis. A working connector does not establish that
the pauses are entertaining, the actions are understandable, or people return.

## First playable format

Use **turn mode** for the pilot:

1. Advance a configured, bounded number of game updates.
2. Render the completed update, freeze gameplay and audio, and show a new round
   ID with the current view, available commands and voting deadline.
3. Accept one ballot per authenticated Twitch user for that round. A replacement
   ballot overwrites the user's earlier choice; repeated messages add no weight.
4. Close the ballot, resolve the winner deterministically and display it.
5. Apply its bounded touches, advance the configured updates, and repeat until
   an observed terminal state or operator abort.

All timings are configuration proposals until measured. Tune the vote window
against observed video delay plus human response time, and tune the game-update
budget against both decision difficulty and total wall time. Single-frame
turns are a debugging facility; they are unsuitable as the default night format.
Track game time and wall time separately. Project full-night wall time from the
measured number and duration of rounds before inviting a larger audience.

After turn mode works, trial **continuous play with a shared pause budget**.
Chat requests a pause using a vote threshold and cooldown; the operator can
always pause or abort locally. A pause is honored at the next completed update,
then has a bounded voting window and an explicit resume. Budget, threshold,
cooldown and maximum pause duration are pinned per session. Show remaining
pauses and elapsed game time. A request based on delayed video cannot rescue a
death that already occurred.

Progression is Night 1, later story nights, then Custom Night with a verified
dial vector. Compare formats before choosing a permanent one. Anonymous
first-message-wins control, independent viewer pause toggles, automatic solver
rescue and rewind are outside the first release.

## Command and voting contract

Expose a small semantic vocabulary: mask, monitor, camera selection, flashlight,
winding, and wait. The game's existing control definitions own legality and
preconditions. The FNaF 2 adapter resolves targets against the pinned rebuild;
chat never supplies coordinates, pointer IDs, code or shell commands.

The overlay lists the exact effects and permitted durations. For example,
`!vote 12 mask 1s` means a ballot for round 12's named mask action. Before that
syntax ships, specify its full press/release sequence, whether the mask remains
on at the next boundary, its game-update duration and rejection conditions.
Camera selection and winding likewise declare any monitor transitions. Fixed
helpers implement mechanics; they never choose the next strategic action.

- Every vote carries the displayed round ID. Reject old, future, malformed and
  late votes. Use Twitch message IDs to deduplicate deliveries across reconnects.
- Ballot eligibility uses the authenticated platform identity. This limits each
  account's influence; it makes no claim that accounts are unique people.
- Only the current round is open; accepted chat never creates a backlog of
  future actions. Close it atomically before committing its winner.
- Ties use a published fixed ordering. A round with no valid ballots advances
  a declared bounded wait; inactivity can lose the night through ordinary rules.
- An action with invalid preconditions is rejected and recorded. Never silently
  substitute a supposedly safer action. The round policy declares whether the
  rejected action consumes its planned wait interval.
- Restart, night selection and session configuration remain operator controls.
  Operator interventions appear in the retained ledger and overlay.

Use EventSub for incoming chat. Keep credentials outside Git and the game
overlay. Keep the controller endpoint local. Rate-limit outbound acknowledgments
and use the overlay for counts, deadlines and results instead of replying to
every ballot. Twitch network traffic never runs inside a game update.

## Pause and execution contract

The host player has explicit `RUNNING`, `PAUSED`, `VOTING`, `EXECUTING`,
`TERMINAL` and `ABORTED` states. The controller acknowledges the exact completed
update at which a pause takes effect; the overlay uses that same state/frame.

A pause freezes simulation updates, timers, RNG draws, game animations and the
game's audio device/playback cursor. The renderer, window event pump, overlay
and stream continue presenting the frozen picture. Resume rebases wall-time
pacing without adding catch-up updates or a large timer delta. Audio resumes
from the paused position without playing the elapsed wall-time backlog.

Input contacts retain their simulated state across a deliberate pause: a held
wind or light resumes as held until its scheduled release. Do not inject a
release into the game's state merely because wall time passes. Emergency abort
has separate cleanup, releases transport resources and records that the run
ended; it makes no trace-equivalence claim.

On controller loss, chat disconnect or an execution deadline failure, close the
round and enter a visible fault pause. Never fall through to uncontrolled
gameplay. Reconnect requires operator acknowledgment, invalidates the prior
round and cannot reapply an already committed action. A bounded fault deadline
ends the session as ABORTED. No public command can disable that supervision.

## Implementation ownership

- **Source:** content-free runtime patch, pause/clock/audio behavior and the
  per-game control definitions. Preserve deterministic update semantics.
- **Play:** runtime transport, pause acknowledgments, bounded contact execution,
  presentation/clock synchronization and failure supervision. It imports only
  kernel and Source, and receives already resolved actions.
- **Propose:** deterministic ballot resolution and the policy converting a chosen
  semantic action into a bounded program using the existing policy/control
  machinery. Add a shared kernel contract only when there are actual consumers.
- **Desktop:** compose Twitch ingress, credentials, host player, policy and
  broadcast overlay. It remains the composition root.
- **Review:** derive results from retained ledgers without importing execution
  modules. The trainer may later consume replay exercises after their value is
  demonstrated.

Keep the first integration thin. Reuse the existing harness and controls rather
than implementing another game model or promoting an experiment script into
production. Owned CCNs, assets, generated game source and binaries remain in the
external local vault. Publish content-free tooling and records within the
existing media and ownership boundaries.

## Milestones and gates

### P0: Characterize and declare the pause experiment

Pin the binary, runtime patch, assets, save, seed, clock configuration and input
ledger. Observe update/draw ordering, audio behavior and controller EOF. Write a
diagnostic declaration naming the explanation: a wall-time wait changes game
state, audio conditions or the rendered decision state.

Choose a reproducible baseline night and a diagnostic prefix covering a held
contact, monitor animation, winding and an impending terminal transition.
Declare pause positions before the comparison. Include proposed wall holds of
1, 10 and 60 seconds, plus repeated holds; these are test inputs, not measured
safe durations. No Twitch account is required for this experiment.

**Exit artifact:** a generated characterization result with hashes and explicit
PASS, DIVERGENT or INCONCLUSIVE findings. If the baseline cannot be reproduced,
stop before building chat integration.

### P1: Qualify a rendered pause player

Characterize, add the contract test, patch the runtime, then compare. Replay the
same input sequence with and without wall-time holds. Compare semantic state,
timer values, RNG draw count/state, input acceptance and terminal outcome at
every game update. Ignore declared wall-clock metadata in this comparison.
Separately measure display/state alignment, actual audio freeze/resume, window
responsiveness and the continuous output seen by the encoder.

Exercise pause during held contacts, transitions and terminal updates, repeated
pause/resume, EOF, reconnect, deadlines and operator abort. A planted timer
advance or duplicate action must fail the comparison. The previous no-pause
pilot trace must still reproduce after the runtime change.

**Exit artifact:** a content-addressed pause comparison and exercised runtime
code. Exact semantic equality and responsive presentation are required. A game
trace match alone cannot grade audio or broadcast output PASS. Host observations
remain MODEL_ONLY; synthetic protocol tests remain FIXTURE.

### P2: Qualify chat voting without an audience

Feed synthetic ballots through the production parser and reducer; use replayed
deliveries for duplicates, ties, replacement votes, stale round IDs, reconnects,
missing votes and floods. Then connect an operator-owned channel to measure the
actual video/chat delay and test displayed round IDs. This milestone authorizes
no public broadcast by itself.

**Exit artifact:** replayable ballot-to-landed-input ledger, protocol controls,
and a latency result naming each clock and measurement uncertainty. All accepted
actions apply at most once; none can apply to another round. A declared scripted
vote sequence must replay to the same game trace without Twitch connected.

### P3: Run a small Night 1 pilot

Invite approximately 3-5 willing players. Before recording another person's
attempt, write the protocol and obtain consent under ROADMAP S5. Agree what may
be broadcast and explain that third-party recordings cannot be withdrawn by
this project. Keep identities and individual attempts in the local Evidence
Vault until participant sign-off; export pseudonymous records afterward.

Use one announced turn-mode session with a proposed 30-minute wall-time cap.
Declare the night/save, seed treatment, action menu, timing parameters, tie/no-
vote rules, intervention rules and stop conditions before play. Changing those
parameters starts a new configuration record. A death is a useful pilot outcome;
a clear is not required to pass the interface gate.

Record valid/stale ballot fractions, participating accounts per round, action
rejections, paused/running wall time, game time advanced, terminal outcome and
operator interventions. Ask whether players understood each action and could
connect it to its consequence. Collect a short explanation of any desire to
continue or stop. This convenience pilot estimates no population retention or
human skill rate.

**Exit artifact:** a permitted pilot result and a proceed/revise/stop decision.
Proceed only if players can make and understand choices without the operator
repeatedly translating them, and measured round pacing fits the declared cap.
If most time is waiting, revise the format before adding harder nights.

### P4: Trial limited pauses and decide on a public series

Run a separately declared continuous-play pilot with the shared pause budget.
Compare its observed coordination, waiting time and qualitative tension with
turn mode. Do not attribute a difference to the format without controlling the
night/configuration or label it exploratory.

Choose the format, difficulty ladder, session limits and visible rules from
those results. A public series begins only after Pedro chooses the channel and
broadcast schedule. Expansion to FNaF 1/3/4 reuses qualified voting and transport
contracts with each game's own controls and pause comparison.

**Exit artifact:** a runnable, supervised collective player, replayable session
record and explicit decision about continued broadcasts. Audience size,
commercial viability and teaching benefit remain UNKNOWN until separately
measured. A retail unpaused clear still follows S5's original protocol.

## Records, verification and next action

Each generated experiment/session record binds its declaration, source/binary
hashes, runtime mode, game/night/dials, seed treatment, save hash, timing config,
state/input trace hashes, pause acknowledgments, rejected commands, operator
interventions and terminal verdict. Declare monotonic host voting/deadline time,
game-update time and platform delivery timestamps separately. Missing
measurements are UNKNOWN. Media remains external and is cited by hash.

Use an evidence ID derived from the retained record and validate it on replay.
Reuse the project's record and custody machinery; add a versioned session
schema only where crowd votes and pauses require fields it cannot represent.
Export permitted game inputs separately so a recorded night can replay without
chat or participant identities. Freeze records after publication.

Run `npm ci`, affected gates, and the committed-winner campaign dry run for
implementation changes. Run `npm run push-gate` against each commit to be pushed;
model/default/binding changes additionally require its `--full` lane. Update
the structured progress/result record with the generated evidence ID and open
questions. Do not weaken the gates to publish this feature.

**Next action:** P0's local rendered-pause characterization. Its comparison can
refute the technical premise before Twitch plumbing or audience recruitment.
No new pause measurement, audience result, phone run or roadmap closure is
claimed by writing this plan.
