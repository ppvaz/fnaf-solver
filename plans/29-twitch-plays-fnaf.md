# Twitch Plays FNaF: collective play with pause through the recompile

**Status:** proposed, 2026-10-05, at Pedro's request. Implementation and public
broadcast remain open. **Classification:** research followed by a feature;
this plan is bookkeeping and closes no roadmap step.

## Goal and place on the path

**Product direction, clarified by Pedro on 2026-10-05:** a 2x2 grid with FNaF
1, 2, 3 and 4 executing through their recompiled runtimes, controlled by one
Twitch chat. Each game has its own pause state. Support both pausing to await
input and pausing through a chat command, with a dark overlay on paused tiles.

Let chat collectively survive all four nights by choosing bounded game actions.
The game prefix routes each command to its tile. Start qualification with FNaF
2 Night 1, then qualify all four before presenting the complete grid. Progress
toward harder nights after the controls, pause fidelity and stream pacing work.

The audience question is: **can one chat get all four games to 6 AM?**
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
[Plan 26](26-second-target-fnaf-1-3-4.md). The first qualification pilot needs
only FNaF 2; the intended product includes all four games.

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

## Four-game grid and presentation

Use a fixed layout so viewers can identify a game without following a moving
window. All four tiles stay visible, including when a tile is paused or done:

```text
+----------------------+----------------------+
| FNAF1                | FNAF2                |
| Game view + status   | Game view + status   |
+----------------------+----------------------+
| FNAF3                | FNAF4                |
| Game view + status   | Game view + status   |
+----------------------+----------------------+
```

Each tile shows its game prefix, night/hour, running or paused state, current
round token, selected action and its remaining game-update duration. Voting
adds counts and a deadline. No hidden actor positions or RNG state appear in
the audience overlay; internal state remains available to offline qualification.
The group objective is four observed 6 AM terminals. Completed tiles stay
visible with `6 AM`; dead tiles show their terminal result. No tile restarts
silently. The operator's declared session rules decide retries and whether a
death ends the group attempt. Teams can form around tiles without requiring
assigned roles or changing the ballot rules.

When a game acknowledges a pause, darken that tile's last completed game frame
with a translucent overlay and center Pedro's requested text:

```text
--- PAUSED ---
Awaiting input
```

Keep the scene recognizable underneath, and keep the game prefix/status strip
readable. The overlay is a presentation layer over captured output; it never
changes game pixels, mechanics or the qualified input geometry. Its state must
match the acknowledged pause, not merely a sent request. Manual pauses use the
same dark treatment with `Awaiting resume`; fault pauses show the fault reason.
Terminal tiles use their terminal label instead of `Awaiting input`.

Start with selectable audio from one tile. Audio selection changes what the
audience hears, not whether that game's simulation or audio clock advances.
Pause freezes the affected game's audio; selecting another tile does not.
Record audio-focus changes and test whether viewers can make decisions when
switching listening focus. Any cue caption must reflect a qualified ordinary
audible cue, never expose hidden runtime state. Four-way audio mixing and the
readability of the encoded 2x2 picture remain questions for the grid pilot.

## Play modes and input resolution

Use **await-input mode** for the first playable version. It is independent per
game; a round in FNaF 2 does not advance FNaF 1, 3 or 4:

1. Render the completed update and freeze that tile's game and audio. Show
   `Awaiting input`, its round token and available commands.
2. Resolve one valid, game-prefixed action according to the declared input policy.
3. Display the selected action, apply its bounded touches and advance only that
   game's configured update budget. Keep all four tiles presenting continuously.
4. When the action finishes, return that tile to `Awaiting input` with a new
   round token, or show its observed terminal state.

Two input policies share this execution contract. **Direct input** accepts the
first valid command for the open tile round, then closes that round atomically.
It is the simplest operator/small-group prototype. **Voting** opens a bounded
ballot window and selects its deterministic winner, for a larger crowd. Pin the
policy per session; chat does not switch it. Neither policy queues actions for
future rounds. This replaces the original proposal's mandatory shared voting
turn: the four tiles need no common simulation clock or round barrier.

An empty direct-input round remains paused. A voting timeout with no valid
ballots returns to `Awaiting input` without advancing the game; it does not
invent a wait action. A separately declared wall-time inactivity deadline can
abort the session. An explicit `wait` is a bounded action that advances game
time and can lose the night under ordinary rules.

All timings are configuration proposals until measured. Tune the vote window
against observed video delay plus human response time, and tune the game-update
budget against both decision difficulty and total wall time. Single-frame
turns are a debugging facility; they are unsuitable as the default night format.
Track game time and wall time separately. Project full-night wall time from the
measured number and duration of rounds before inviting a larger audience.

Also support **live mode**: active games keep running between bounded commands.
Chat can request a pause and an explicit resume for one game, or all games.
The declared command/ballot policy resolves live actions without stopping the
game merely to collect votes. Do not overlap incompatible action programs;
reject requests outside their eligible window and report the reason. Measure
how video delay affects usable decisions before treating live play as qualified.

Trial live play after await-input mode works. A pause takes effect at the next
completed update and shows `Awaiting resume`; ordinary action commands cannot
unpause it. The operator can always pause or abort locally. Initially test
manual pauses without a competition budget; a later challenge can bound pauses
through a declared vote threshold, cooldown and shared budget. Show remaining
pauses and elapsed game time. A request based on delayed video cannot rescue a
death that already occurred. Wall-time limits end an attempt explicitly rather
than silently resuming a game whose tile says paused.

Progression is Night 1, later story nights, then Custom Night with a verified
dial vector. Compare modes and input policies before choosing a public format.
Anonymous input, pause toggles, automatic solver rescue and rewind are outside
the first release. Direct input still authenticates accounts and deduplicates
deliveries; explicit pause/resume commands are state-setting operations.

## Command and voting contract

The public vocabulary starts with Pedro's examples:

```text
FNAF1 doorL
FNAF3 cam10
FNAF4 bed
FNAF2 wind
```

Parse a case-insensitive game prefix, a command and permitted arguments. Route
only to that game's control definitions: a FNaF 4 `bed` command cannot be
interpreted as a FNaF 1 action. Each adapter owns aliases, legality and
preconditions and resolves targets against its pinned rebuild. No game prefix
is inferred from audio focus, the last message or the operator's selected tile.
Chat never supplies coordinates, pointer IDs, code or shell commands.

The overlay lists the exact effects and permitted durations. The short examples
are command aliases, not permission for indefinite holds or ambiguous toggles.
Define `wind`'s bounded default duration, `bed`'s movement/observation duration,
`cam10`'s monitor transitions and `doorL`'s intended state before shipping them.
Prefer explicit door state arguments such as `doorL close` and `doorL open`;
never let duplicate delivery toggle a door back. Fixed helpers implement
mechanics; they never choose the next strategic action.

Qualified session commands include the tile's displayed round token, for example
`FNAF2 wind 1s @12`. The compact examples above describe routing; a bare prefix
and action cannot establish which displayed state a delayed viewer meant.
Reject an absent token when the configured policy requires it. In live mode,
use bounded input epochs/tokens and expiry, not an unbounded command queue.

Explicit pause controls follow the same game routing and token validation
(these short forms omit the token for readability):

```text
FNAF2 pause
FNAF2 resume
ALL pause
ALL resume
```

`ALL` is reserved for session controls; it cannot broadcast a game action to
four incompatible vocabularies. Global pause/resume effects and any pause-budget
charge are resolved once per accepted command. Vote thresholds and permissions
are session configuration, while the operator's local emergency pause/abort
remains available independently of Twitch. Per-game controls use that tile's
token; global controls use a separate session-control token shown by the
compositor. Advancing one game's round does not invalidate another game's token.

- Every accepted gameplay command carries its game's displayed round token.
  Reject old, future, malformed and late commands. Use Twitch message IDs to
  deduplicate deliveries across reconnects; token namespaces include game and
  attempt so identical round numbers cannot cross tiles or restarts.
- Ballot eligibility uses the authenticated platform identity. This limits each
  account's influence; it makes no claim that accounts are unique people.
- Only the current round for each game is open; accepted chat never creates a
  backlog of future actions. Close a round atomically before committing its
  direct-input action or vote winner. Voting permits one ballot per authenticated
  account per game/round; replacement ballots overwrite earlier choices.
- Ties use a published fixed ordering. Empty rounds remain in await-input pause;
  the declared inactivity limit can abort. In await-input mode, only an explicit
  wait action advances a game without another gameplay input.
- An action with invalid preconditions is rejected and recorded. Never silently
  substitute a supposedly safer action or consume a wait interval in await-input
  mode. Gameplay commands during a manual/global/fault hold are rejected; an
  explicit eligible resume removes a manual/global hold. A live game otherwise
  keeps advancing under its ordinary rules when an action is rejected.
- Restart, night selection and session configuration remain operator controls.
  Operator interventions appear in the retained ledger and overlay.

Use EventSub for incoming chat. Keep credentials outside Git and the game
overlay. Keep the controller endpoint local. Rate-limit outbound acknowledgments
and use the overlay for counts, deadlines and results instead of replying to
every ballot. Twitch network traffic never runs inside a game update.

## Pause and execution contract

Each game has its own `RUNNING`, `PAUSED`, `VOTING`, `EXECUTING`, `TERMINAL` and
`ABORTED` states, plus explicit pause reasons: awaiting input, manual hold,
global hold or fault. Track manual/global/fault holds independently; removing
one never removes the others. The overlay prioritizes fault, then global/manual
hold, then awaiting input. The controller acknowledges the exact completed update
at which a pause takes effect; that tile's overlay uses the same state/frame.
The compositor keeps drawing all tiles while each game's updates are gated
independently. Changing a tile's mode is an operator action recorded in the
session configuration; it never follows implicitly from a chat message.

Manual pause can interrupt a bounded action at an update boundary. Retain its
remaining game-update budget and input contacts. Manual resume removes only
the matching manual hold: an interrupted await-input action finishes its
remaining updates and pauses again; an idle await-input tile remains waiting.
Global resume removes the global hold without clearing a separate per-game
manual hold. Repeated pause/resume commands are idempotent. Neither command
revives a terminal tile or clears a fault that requires operator acknowledgment.

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

On loss of one game controller or its execution deadline, close that game's
round and enter a visible fault pause. A shared chat or capture/compositor
failure fault-pauses all active games. Never fall through to uncontrolled
gameplay. Reconnect requires operator acknowledgment, invalidates affected
round tokens and cannot reapply an already committed action. A bounded fault
deadline ends affected attempts as ABORTED. No public command can disable that
supervision, and a global resume does not clear these faults.

## Implementation ownership

- **Source:** content-free runtime patch, pause/clock/audio behavior and the
  per-game control definitions. Preserve deterministic update semantics.
- **Play:** runtime transport, pause acknowledgments, bounded contact execution,
  presentation/clock synchronization and failure supervision. It imports only
  kernel and Source, and receives already resolved actions.
- **Propose:** deterministic ballot resolution and the policy converting a chosen
  semantic action into a bounded program using the existing policy/control
  machinery. Add a shared kernel contract only when there are actual consumers.
- **Desktop:** compose Twitch ingress, credentials, the four host players,
  game-prefixed routing, policy, 2x2 compositor, audio selection and tile
  overlays. It remains the composition root.
- **Review:** derive results from retained ledgers without importing execution
  modules. The trainer may later consume replay exercises after their value is
  demonstrated.

Keep the first integration thin. Reuse the existing harness and controls rather
than implementing another game model or promoting an experiment script into
production. Owned CCNs, assets, generated game source and binaries remain in the
external local vault. Publish content-free tooling and records within the
existing media and ownership boundaries.

## Twitch Plays Pokémon: history, creator and commercial precedents

Documentary research consulted 2026-10-05, at Pedro's request. First-person
interviews and channel/platform announcements support the history below;
community-maintained descriptions are identified separately. This is MODEL_ONLY
documentary synthesis, not a pause experiment or an audience/business result.
Actual channel revenue, profit after labor and the original creator's legal
identity remain UNKNOWN in the cited record.

### The creator and the initial decision

The original creator used `Twitch-Plays-Pokemon` and chose anonymity. In a
[March 2014 interview](https://gameinformer.com/b/features/archive/2014/03/14/an-interview-with-the-mind-behind-twitch-plays-pok-233-mon),
he described himself as a programmer and first-generation Pokémon enthusiast.
SaltyBet inspired an automated broadcast built around audience interaction;
Pokémon was a simple test of whether chat-controlled play would appeal. He
initially created and operated it himself. He did not expect the original
input scheme to beat precision-dependent sections at that scale.

That interview also records an intervention after chat triggered a soft reset:
he restored a recent save state and disabled Select. Operator intervention was
already a format decision worth making visible.

A relevant connection to this repository: in his
[2015 AMA](https://www.reddit.com/r/IAmA/comments/2vow6x/i_am_the_creator_of_twitch_plays_pokemon_ama/),
he said his early game-making tools included The Games Factory and Multimedia
Fusion. That is a biographical connection, not evidence for our recompile.

### Milestones and community decisions

| When | Documented milestone | Relevance to this proposal |
|---|---|---|
| 2014-02-12 | Pokémon Red begins; [Guinness](https://www.guinnessworldrecords.com/world-records/most-participants-on-a-single-player-online-videogame) dates the original collective run through March 1 | A familiar game and a legible shared destination make participation easy to explain |
| 2014-02-18 | Democracy introduced ([contemporary report](https://www.engadget.com/2014-02-18-twitch-plays-pokemon-levels-up-to-75k-concurrent-viewers-learns.html)) | Input policy is part of the product, not merely infrastructure |
| 2014-02-19 | [Twitch reports](https://blog.twitch.tv/en/2014/02/19/recent-chat-issues-and-twitchplayspokemon-4f8219e479b9/) unexpected chat load, a dedicated event-chat server and infrastructure fixes | Load and delivery behavior need measurement before increasing audience size |
| 2014-03-01 | Red completed after about 16 days; Twitch reports 121,000 peak concurrent viewers and 1,165,140 total command participants in its [victory announcement](https://blog.twitch.tv/en/2014/03/01/tpp-victory-the-thundershock-heard-around-the-world-3128a5b1cdf5/) | Concurrent viewers, total participants and views are different quantities; none establishes future demand |
| 2014 | [The Game Awards](https://thegameawards.com/rewind/year-2014) names TPP Best Fan Creation | The community experience gained recognition beyond a single stream |
| 2015-02-12 | [Twitch announces](https://blog.twitch.tv/en/2015/02/12/happy-1st-birthday-to-tpp-let-s-do-it-again-bf34b4d6c3fe/) an anniversary return to Red and charitable commemorative shirts | Returning events can give an established community a new shared occasion |
| 2017-11-22 | Creator announces transfer of development/operations leadership to Aissurtievos following dissatisfaction with his management ([official announcement](https://www.reddit.com/r/twitchplayspokemon/comments/7d0w62/official_transfer_of_leadership_of_the_twitch/)) | Ownership and community governance need a succession path |
| 2024-02-12 | A tenth-anniversary return to Kanto was announced, with a goal of finishing without Democracy ([Nintendo Life, reproducing the channel announcement](https://www.nintendolife.com/news/2024/02/twitch-plays-pokemon-returning-to-kanto-for-its-10th-anniversary)) | A continuing niche community and the original viral peak are separate outcomes |

The initial rules themselves became contested community territory. A
[contemporary community explanation](https://www.reddit.com/r/twitchplayspokemon/comments/1y8o60/anarchydemocracy_explained/)
records resistance to voting and the subsequent ability to choose between
Anarchy and Democracy. The creator's 2015 AMA explains Democracy as a way to
avoid a precision bottleneck becoming an indefinite dead end. Better control
can preserve progress while changing the experience people joined for.

The [official victory account](https://blog.twitch.tv/en/2014/03/01/tpp-victory-the-thundershock-heard-around-the-world-3128a5b1cdf5/)
already records Helix, Dome, Bird Jesus, Flareon, the Ledge and Bloody Sunday,
alongside fan-made trackers, art and music. The community made consequences
into a shared mythology. For FNaF, preserving attempts, deaths, rescues and
coordination failures gives participants material to name and retell; scripting
that mythology in advance is an untested product assumption.

By his [2017 AMA](https://www.reddit.com/r/pokemon/comments/5tlshm/i_am_the_creator_of_twitch_plays_pokemon_ama/),
the creator described two years of almost solo operation followed by distributed
talent, regretted not seeking help sooner, and cited bots outperforming humans
as a reason for restrictions. He also acknowledged pushback against adding more
sidegames to an already busy screen. These are first-person accounts, not
independent findings about retention or the motives of every participant.

### Pause and multiple games have precedents

The [community-maintained Bulbapedia history](https://bulbapedia.bulbagarden.net/wiki/Twitch_Plays_Pokemon)
describes a Vietnamese Crystal sidegame after Anniversary Red, with voted
inputs and pauses between votes and betting matches. It also documents later
simultaneous sidegames. This is a useful historical lead, not a qualified
runtime specification. The creator's 2015 AMA separately discusses considering
two simultaneous games. Our specific four-FNaF grid and independent pause
contract still need P0-P4's measurements; neither paused crowd play nor multiple
game views should be marketed as an invention of this project.

### How it capitalized, and what is not known

- **Donations and low cash overhead:** in the March 2014 interview, the creator
  said Dogecoin donations alone covered dedicated-server rental and described
  the operation as profitable outside the cost of his time. That does not
  establish profit after valuing labor.
- **Reinvestment:** his 2015 AMA says donations largely funded hardware and
  commissioned Lua scripts that extracted state for the overlay. Money could
  improve the broadcast rather than buy control of the main run.
- **Subscriptions, advertising and paid extras:** Bulbapedia documents these
  channels, including donation/subscription tokens for music and visual effects,
  and paid match selection that later became token-based. These are community
  descriptions of mechanisms, not audited receipts or current price promises.
- **Merchandise:** the 2015 anniversary shirts' proceeds went to Extra Life and
  Child's Play, according to Twitch. Do not count that campaign as the creator's
  personal merchandise income.
- **The widely repeated $100,000 figure:** in the 2015 AMA he repeats an
  estimate of what Red *could have* earned with extra advertising beyond
  prerolls, while declining to disclose actual earnings. It is a counterfactual,
  not confirmed turnover, take-home income or a forecast for this project.

Sources for those distinctions: the
[2014 creator interview](https://gameinformer.com/b/features/archive/2014/03/14/an-interview-with-the-mind-behind-twitch-plays-pok-233-mon),
[2015 creator AMA](https://www.reddit.com/r/IAmA/comments/2vow6x/i_am_the_creator_of_twitch_plays_pokemon_ama/),
[community monetization history](https://bulbapedia.bulbagarden.net/wiki/Twitch_Plays_Pokemon),
and [Twitch's charity announcement](https://blog.twitch.tv/en/2015/02/12/happy-1st-birthday-to-tpp-let-s-do-it-again-bf34b4d6c3fe/).
No verified sponsorship revenue or complete channel financial statement was
located in these sources. Absence from this research is not proof of absence.

### Proposed lessons for the four-game format

These are design inferences, not historical findings or standing project rules:

1. Make each accepted action and consequence readable. Preserve the fixed grid
   and restrained pause overlay; test audio attention before adding side widgets.
2. Announce direct input, voting and pause rules before a session. Record rule
   changes and operator interventions, so progress does not look silently forced.
3. Give the community a shared objective, accessible recaps and retained key
   moments. Let tile teams, names and stories emerge from actual play.
4. Prepare named operator/moderator responsibilities and a handover procedure
   before attempting continuous operation. Define how automation may participate.
5. For the initial public trial, propose equal gameplay influence for free and
   paying accounts. Consider voluntary support and cosmetic recognition after
   readability/return interest are observed; paid command priority is outside
   the initial proposal. Do not sell unlimited pause authority.
6. Before adopting a commercial schedule, measure encoder/hosting cost, operator
   and moderation time, returning participants and actual net receipts. The
   original viral peak supplies no revenue forecast for a four-game FNaF channel.

P5's product decision should record which of these proposals survives the
pilots. Commercial viability remains UNKNOWN; this research authorizes no
paid feature or public launch.

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

Before enabling another game's tile, repeat the pause comparison on its pinned
runtime, controls and audio. A FNaF 2 result never qualifies another game.

**Exit artifact:** a content-addressed pause comparison and exercised runtime
code. Exact semantic equality and responsive presentation are required. A game
trace match alone cannot grade audio or broadcast output PASS. Host observations
remain MODEL_ONLY; synthetic protocol tests remain FIXTURE.

### P2: Qualify chat voting without an audience

Feed synthetic ballots through the production parser and reducer; use replayed
deliveries for duplicates, ties, replacement votes, stale round IDs, reconnects,
missing votes and floods. Test all four prefixes, wrong-game commands, direct
input versus voting, identical tokens on different tiles, manual pause/resume
during an action, global holds, and attempted fault/terminal resumes. Assert
that activity in one tile cannot advance another tile's simulation or ballot.
Then connect an operator-owned channel to measure the
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

Use one announced await-input session with a proposed 30-minute wall-time cap.
Declare the night/save, seed treatment, action menu, timing parameters, tie/no-
vote rules, direct-input or voting policy, intervention rules and stop conditions
before play. Changing those parameters starts a new configuration record. A death
is a useful pilot outcome;
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

### P4: Qualify the four-game grid

Pin each game's own night/save, runtime, assets, seed treatment and pause result.
Run all four simultaneously with separate game-update clocks, contacts, round
tokens, logs and terminal outcomes. Test the actual composite stream at its
chosen encoding settings; single-game rendering performance cannot qualify the
four-game workload. Measure host resources, missed presentation deadlines,
tile update pacing, stream delay, overlay readability and audio selection.

Verify that a command changes only its named game, await-input tiles stay
frozen while another executes, and global pause/resume preserves independent
manual/fault holds. Complete and kill selected tiles while the others continue;
completed/dead tiles must stay visible and reject gameplay commands. Replay each
tile's input ledger independently and reproduce its qualified semantic trace.
Shared rendering or resource failure must produce the declared fault behavior,
not silently change game time or shed a tile.

After local qualification, run a separately declared small-group grid pilot
under P3's consent/retention rules. Measure whether viewers can identify command
destinations, interpret pause reasons and coordinate attention across tiles.
Freeze retry rules and the condition for the group attempt to end before play.

**Exit artifact:** a generated four-game execution/presentation comparison and
permitted grid-pilot result. Passing single-game tests or composing four frozen
images is insufficient. Simultaneous execution capacity and audience coordination
remain UNKNOWN until this milestone measures them.

### P5: Trial live play, limited pauses and decide on a public series

Run a separately declared live-mode grid pilot with game-specific and global
pause/resume commands. First qualify manual pauses, then trial a shared pause
budget whose per-game/global charges and cooldown rules are announced.
Compare its observed coordination, waiting time and qualitative tension with
await-input mode. Do not attribute a difference to the format without controlling
the night/configuration or label it exploratory.

Choose the format, difficulty ladder, session limits and visible rules from
those results. A public series begins only after Pedro chooses the channel and
broadcast schedule. The public product is the qualified 2x2 grid; additional
nights reuse voting/transport contracts with each game's own controls and pause
comparison, and do not borrow another tile's qualification.

**Exit artifact:** a runnable, supervised collective player, replayable session
record and explicit decision about continued broadcasts. Audience size,
commercial viability and teaching benefit remain UNKNOWN until separately
measured. A retail unpaused clear still follows S5's original protocol.

## Records, verification and next action

### Alternate format: GPTPlays (Pedro, 2026-10-05)

An LLM receives the goal of finishing the game and owns the next move. Viewers
talk with it: questions, hints and memes can influence its choices. Audience
messages do not directly actuate the game. This is an alternate player over
the same qualified runtime/action/pause interfaces, rather than a requirement
to put an LLM between every crowd vote and its selected action.

Use two independent loops. The player observes a presented state and selects
a bounded named action, which the runtime executes and acknowledges. The
presenter answers chat and describes accepted actions or uncertainty without
holding up the player. A slow conversation must not become an accidental
game-clock policy. The operator retains pause, abort and restart.

For the first experiment, use only the mature FNaF 2 recompile and Night 1.
Give the player its goal, allowed controls, visible observation and a bounded
memory of its prior actions. Decide before running whether it may see internal
runtime state, source mechanics or committed winning schedules: those are
different assistance conditions, not interchangeable results. A player with
a winning schedule is a useful presentation baseline, but it does not measure
discovery from pixels. The other three quadrants remain available for later
qualified runtimes.

Start with a local participant message box and an operator command console.
Then add the LLM as an action producer using the same round tokens and
admission checks. Incoming chat is conversation data; a viewer claiming to
be the operator or proposing a shell command receives no additional authority.
The player can consider a hint, choose a legal experiment or explain why it
ignored it. Separate accepted actions from proposed actions in the ledger and
never invent the reason for a decision that was not recorded.

Compare a run without audience hints with a run under a declared hint policy,
on the same pinned game configuration. Retain actions, results, selected hints,
operator interventions, decision latency and API cost; state the chat retention
rules before collecting participant content. Record terminal outcome, time
spent playing versus waiting and how viewers understood the agent's decisions.
The initial pass is a coherent observe/act/acknowledge loop and an honest
conversation about it; a clear, audience retention and commercial potential
remain separate measurements.

The existing local grid is the transport console for this experiment. It does
not yet have a chat service, LLM connection or a qualified native rendered-pause
bridge. These remain implementation and qualification work after the owned
FNaF 2 has been rebuilt locally.

Each generated experiment/session record binds its declaration, source/binary
hashes, input policy, play mode, per-game night/dials, seed treatment, save hashes,
timing config, state/input trace hashes, pause reasons/acknowledgments, game and
attempt routing, global control effects, audio selection, compositor config,
rejected commands, operator interventions and individual/group terminal verdicts.
Declare monotonic host voting/deadline time,
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
