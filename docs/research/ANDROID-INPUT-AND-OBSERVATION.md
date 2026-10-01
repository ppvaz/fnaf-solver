# Real-time Android input and observation: what is physics, what is this handset

**Commissioned and completed 2026-08-26.** A literature and primary-source
survey against AOSP and the Linux kernel. **Nothing in this document was run on
this project's handset, and no number in it is a measurement of this phone.**

This is the *integral* research report, retained in full. The distilled,
project-specific conclusions — and the corrections applied to this repository as
a result — live in [`docs/device/HID-MULTITOUCH.md`](../device/HID-MULTITOUCH.md)
§"Input injection and sequential budgets, against the platform source" and its
addendum, with the observation-cost half in
[`docs/device/ON-DEVICE-VALIDATION.md`](../device/ON-DEVICE-VALIDATION.md)
§"What an observation costs elsewhere". Read those for the answers; read this
for the evidence and the method.

**Labels used throughout:** `MEASURED` (source + methodology) · `COMMUNITY`
(forum/GitHub/marketing assertion) · `SOURCE` (read directly out of AOSP/kernel
code — a fact about the implementation, not a timing measurement) · `INFERENCE`
· `UNKNOWN(reason)`.

---

## 0. Verdict in five lines

The architecture is the right shape and matches what every serious practitioner
converges on. Two of the seven briefed numbers are misattributed rather than
wrong, and one is almost certainly leaving a lot on the table:

1. **`input tap` is slow — but the JVM story is only true up to Android 11.** On
   Android 12+ AOSP replaced it with `cmd input`. Still unusable, for different
   reasons.
2. **The ≥100 ms hold is right, but not for the reason usually given.** It is an
   *engine* constraint, not a digitizer one — injected events bypass the
   touchscreen's 10–35 ms sensing entirely. The correct value is a function of
   the game's frame rate, and it can be measured.
3. **The ~240 ms press-to-press spacing has no support anywhere in Android or
   the kernel.** Nothing at the platform level imposes it.
4. **The 59 ms sampler is paying fixed overhead, not pixels** — AOSP does the
   same job in a 3 ms budget, and on the capture path `screencap` uses, the crop
   rectangle is *ignored in source*.
5. **Observation is where the remaining 5–25× lives.** scrcpy's mechanism
   reaches 8–33 ms for a *whole frame*.

---

## 1. Are real-time Android game bots viable?

### The headline finding is a negative, and it is solid

**ABSENT:** no published source — academic or practitioner — reports a measured
end-to-end see→decide→act loop latency for a *reactive* bot on a *physical*
Android handset. Every source is one of: one leg of the loop only;
emulator-based; open-loop replay with no perception; or wins by *prediction*
rather than by closing the loop.

That is not evidence it can't be done. It is evidence of operating **past the
edge of the published record**, and that own instrumented numbers are worth more
than anything citable.

### Where the field actually sits

| System | Platform | Per-step latency | Label |
|---|---|---|---|
| V-Droid ([arXiv:2503.15937](https://arxiv.org/html/2503.15937v2)), self-described "first mobile agent capable of near-real-time response" | emulator + 2×RTX 4090 | **3.8 s/step** (0.7 s decision) | MEASURED (emulator) |
| MobileAgentBench ([arXiv:2406.08184](https://arxiv.org/html/2406.08184v1)), 5 agents | Pixel 3a emulator | **4.85 – 26.09 s/action** | MEASURED (emulator) |
| AndroidWorld ([arXiv:2405.14573](https://arxiv.org/abs/2405.14573)) M3A | emulator | 3.9 min/task | MEASURED |
| **Physical Atari** ([arXiv:2606.19357](https://arxiv.org/html/2606.19357)) — Javed, Modayil, Kennickell, Sutton, Carmack | robot + camera + real Atari | **~165 ms end-to-end**, 30 Hz agent | MEASURED |
| RERAN ([ICSE 2013](https://ieeexplore.ieee.org/document/6606553/)) — *replay*, not reaction | real phones | **3.87 ms median** replay delay, µs-accurate | MEASURED |
| Fastbot2 ([ASE 2022](https://dl.acm.org/doi/fullHtml/10.1145/3551349.3559505), ByteDance) | real devices | claimed "12 actions/second" (~83 ms) | PAPER CLAIM, unverified |

The Physical Atari number is the most useful comparison available: a full
physical closed loop, built by people who care about latency, lands at ~165 ms —
"comparable to typical human reaction times" — and they run the agent at 30 Hz.
A 5000 ms cycle with ~680 ms of observation slack is a *far* easier regime.

### The three ways the successful real-time cases cheat

Every documented real-time win on a touchscreen escapes the loop rather than
closing it:

- **Predict ahead.** The Piano Tiles record robot watches with an *external*
  120 fps camera (above the 60 Hz display) and "looks ahead based on this to get
  ahead of the communication delay and fastest swing time of the motors."
  COMMUNITY, but the architecture statement is primary.
- **Read the future from data, not pixels.** Android rhythm-game "autoplay" is
  universally a modified client or mod APK (`osudroid-rx`, Arcaea autoplay),
  never a vision loop. **ABSENT: no closed-loop Android rhythm bot exists in
  public.**
- **Get inside the process.** Airtest/Poco and GameDriver inject an SDK into the
  engine; Fastbot runs as on-device instrumentation.

**An open-loop schedule with sparse reactive reads is the fourth member of this
family, and it is the correct one for a game whose threat model is a known AI
table.**

### What AndroidEnv says about the real-time problem (primary, DeepMind)

- "the OS does not pause when providing observations or when accepting actions";
  agents "may need to handle a non-negligible amount of delay between
  consecutive action executions."
- Risk: "an unexpectedly long agent deliberation time could turn an intended
  *tap* gesture into a *long press*." — precisely the `LONG_PRESS_TIMEOUT`
  exposure in §3.5.
- Their mitigation is a **throttle** (`max_steps_per_second`) — slowing down to
  stabilise, not speeding up.
- They report **no fps or ms/step figure at all**, and explicitly refuse to: the
  rate "depends on the resolution of the device, the performance of the machine,
  and whether the rendering is done through software or hardware."
- ([arXiv:2105.13231](https://arxiv.org/abs/2105.13231))

### Bot-detection literature: mostly a dead end

Every paper that would give real human-vs-bot tap-interval distributions is
paywalled or non-extractable (Kim & Lee 2015; Kang et al. ETRI 2023 — 97%
acc/100% precision from *action-time-interval mean and standard deviation*;
ICANN 2022 GMM). One frequently-cited paper is **RETRACTED** (Tsaur et al. 2022,
[Wiley 10.1155/2022/9429475](https://onlinelibrary.wiley.com/doi/10.1155/2022/9429475))
— do not cite it.

Vendor marketing claiming "humans 150–1500 ms with >100 ms variance, bots SD
<5 ms" ([GeeTest](https://www.geetest.com/en/article/behavioral-biometrics-bot-detection))
is COMMUNITY folklore with no methodology.

**Relevant to `human-gate.ts`'s ±60 ms iid slack: there is no external
corroboration to cite, because the literature reports means and never
variance.** The one public route to real numbers is **HuMIdb** (600 users, 179
device models, freely available, [arXiv:2005.13655](https://arxiv.org/abs/2005.13655))
— the distributions would have to be measured.

---

## 2. The touch-injection ladder

### 2.1 `adb shell input tap` — the stated rationale is version-dependent

`SOURCE`, verified per release branch:

| Android | `frameworks/base/cmds/input/input` | Mechanism |
|---|---|---|
| ≤ 11 | `export CLASSPATH=$base/framework/input.jar`; `exec app_process $base/bin com.android.commands.input.Input "$@"` | **Full ART/app_process start per invocation** |
| 12+ | `input.sh`: `#!/system/bin/sh`; `cmd input "$@"` | `cmd` → binder → `InputShellCommand` **already running in system_server** |

- Old: [oreo-release `cmds/input/input`](https://android.googlesource.com/platform/frameworks/base/+/oreo-release/cmds/input/input)
- New: [main `cmds/input/input.sh`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/cmds/input/input.sh) (now a bare `sh_binary`)
- Implementation: [`InputShellCommand.java`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/services/core/java/com/android/server/input/InputShellCommand.java)

So on a modern handset the JVM-startup cost is **gone**. `input tap` is
nonetheless unusable, for three version-independent reasons:

1. **`INJECT_INPUT_EVENT_MODE_WAIT_FOR_FINISH`** — both implementations inject
   synchronously and block until dispatch completes. `SOURCE`. That couples the
   injector to the target app's frame loop.
2. **`input` has no multitouch verb.** Confirmed against the Android 15
   `onHelp()`. Single pointer only. `SOURCE`.
3. **Per-command process spawn + adb round trip** remain.

Measured cost, `COMMUNITY` (weak methodology, Xiaomi Mi Mix, pre-12): "at least
**300 ms**, often worse with about **400 ms**"
([xarantolus](https://blog.010.one/how-to-tap-the-android-screen-from-the-underlying-linux-system)).
rom1v's own breakdown for the pre-12 path: "All of this is executed for every
`adb shell input …` command. **The main delay is step 6 (starting the Java
process)**" ([scrcpy#231](https://github.com/Genymobile/scrcpy/issues/231)).

**UNKNOWN(no published measurement)** for `cmd input` on Android 12+. Nobody has
re-measured after the rewrite. Any doc citing the JVM cost is citing a fact about
Android ≤11.

One AOSP number worth having from the new implementation:
`SWIPE_EVENT_HZ_DEFAULT = 120` — AOSP's own synthesised swipe emits MOVE events
at **8.33 ms intervals**. Default swipe duration 300 ms. `SOURCE`.

### 2.2 `sendevent` / direct `/dev/input/eventX`

`SOURCE`, kernel [`drivers/input/evdev.c`](https://raw.githubusercontent.com/torvalds/linux/master/drivers/input/evdev.c):
userspace writes land in `input_inject_event()` in a tight loop:

```c
while (retval + input_event_size() <= count) {
    if (input_event_from_user(buffer + retval, &event)) { retval = -EFAULT; goto out; }
    retval += input_event_size();
    input_inject_event(&evdev->handle, event.type, event.code, event.value);
    cond_resched();
}
```

**There is no rate limit and no per-event delay.** The only constraint is a
4096-byte cap per write ("corresponds to 170 input events") to avoid holding
`evdev->mutex` too long. This is the single most important fact for §3.

**Critical caveat nobody documents:** injected events go into the input core
*below* the digitizer driver. They therefore **skip the 10–35 ms
physical-to-kernel sensing latency entirely** (see §3.6). `INFERENCE`, grounded
directly in the source path above.

**Availability regression, `SOURCE`:** shell's write access to `/dev/input` was
**removed by SELinux policy** in commit `51156264b4b9` (2018-08-28, Bug
30861057) — *"Shell access to existing input devices is an abuse vector… Remove
the write ability for shell users, and add a neverallow assertion (which is also
a CTS test) to prevent regressions."* The AVC denial was captured by minitouch's
own author on a Pixel/Android Q preview, with `id` confirming shell was still in
group `1004(input)` — DAC untouched, SELinux alone the blocker
([openstf/minitouch#41](https://github.com/openstf/minitouch/issues/41)).

**A route writing to `/dev/input/eventX` as shell depends on root and will not
survive a stock modern device.**

### 2.3 `/dev/uinput` and `/dev/uhid` — the non-root route, and when it opened

`SOURCE`, per-tag `ueventd.rc` + sepolicy:

| Android | `/dev/uhid` | `/dev/uinput` | shell can open |
|---|---|---|---|
| ≤ 8.0 | `0660 system bluetooth` | `0660 system bluetooth` | neither |
| **8.1** | **`0660 uhid uhid`** | `0660 system bluetooth` | **uhid only** |
| 9 | `0660 uhid uhid` | `0660 system bluetooth` | uhid only |
| **10+** | `0660 uhid uhid` | **`0660 uhid uhid`** | **both** |

Commits [`0729dd1edb1e`](https://android.googlesource.com/platform/system/core/+/0729dd1edb1e392f60f9a2ad5cc06a84df2ab1f6)
(→8.1) and [`e615b2aa76af`](https://android.googlesource.com/platform/system/core/+/e615b2aa76afd80291c189c292b0118c8f6664d9)
(→10). Corroborated `MEASURED` by scrcpy reports: Android 6 → `EACCES`, Android
8.0 → `EACCES`, Android 10/11 → works
([scrcpy#4473](https://github.com/Genymobile/scrcpy/pull/4473#issuecomment-1963004171),
[#4811](https://github.com/Genymobile/scrcpy/issues/4811)). **Caveat:** vendor
`ueventd` can override — a redroid container on Android 15 still returns
`EACCES`.

**Actionable:** `adb shell uinput -` is a **first-party AOSP command** that
registers arbitrary `ABS_*` axes with full `input_absinfo` and replays evemu
recordings, with a shipped multitouch example
(`cmds/uinput/examples/test-touchpad.evemu`). `EventHub` classifies any node
declaring `ABS_MT_POSITION_X/Y` + `BTN_TOUCH` as `TOUCH|TOUCH_MT`, and
`TouchInputMapper` treats `INPUT_PROP_DIRECT` as a touchscreen. That is a
**non-root multitouch actuator with no HID descriptor to hand-roll**, on exactly
the Android versions where the `/dev/input` route is dead.

### 2.4 The "Android 12/13 blocked shell injection" myth — it is false

`SOURCE`: scrcpy v1.23's reflection wrapper, failing to find the 2-arg
`injectInputEvent`, fell back to a 3-arg overload passing `0`:

```java
return (boolean) method.invoke(manager, inputEvent, mode, 0);   // ← that 0 is targetUid
```

Every event became a *targeted* injection at uid 0, which owns no app window →
`TARGET_MISMATCH`. Never a permission failure. Fixed in
[PR #3190](https://github.com/Genymobile/scrcpy/pull/3190) / v1.24.

Per-tag `IInputManager.aidl` confirms `injectInputEventToTarget` is an
**Android 13** addition (absent in 11, 12, 12.1, T-preview-2). Current AOSP
comments the uid check explicitly: *"We are not checking if targetUid matches the
callingUid, since having the permission already means you can inject into any
window."*

**`INJECT_EVENTS` for shell has never been removed on any Android version.**
Shell.apk declares `sharedUserId="android.uid.shell"` and
`<uses-permission android:name="android.permission.INJECT_EVENTS"/>`, is
platform-signed, so the signature permission lands on uid 2000.

### 2.5 `AccessibilityService#dispatchGesture`

`SOURCE`, [`GestureDescription.java`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/accessibilityservice/GestureDescription.java):

```java
private static final int MAX_STROKE_COUNT = 20;
private static final long MAX_GESTURE_DURATION_MS = 60 * 1000;
```

Stroke validation: `duration > 0`, `startTime >= 0`; `addStroke()` throws
`IllegalStateException("Gesture would exceed maximum duration with new stroke")`.

**There is no documented per-second rate limit.** `MEASURED throughput: ABSENT`
— nobody has published one.

AOSP's own CTS fixture cadence (`cts/.../GestureUtils.java`, `SOURCE`):
`TAP_DURATION_MS_DEFAULT = ViewConfiguration.getTapTimeout()` (=100),
`STROKE_TIME_GAP_MS_DEFAULT = 40` → **140 ms/tap** as AOSP's test default. That
is a fixture default, *not* a rate limit.

The only published per-tap cost for this route is `COMMUNITY` (Auto.js official
API docs, on `click(x,y)`): blocks until complete, 大约150毫秒 (~150 ms), and
explicitly 使用该函数模拟连续点击时可能有点击速度过慢的问题 — too slow for continuous
clicking; use the root `RootAutomator` path, where *"these actions execute with
no delay."*

**Autoclicker CPS numbers: ABSENT, verified rather than merely unfound.**
Fourteen Play listings were read in full, including the 824K-rating
`com.truedevelopersstudio.automatictap.autoclicker` and one literally named
"Auto Clicker — Super Fast". **None publishes a maximum CPS or minimum
interval.** The circulating "500–700 clicks/sec" figure is a *Windows* number
and must not be transplanted.

The most relevant community observation: *"android accessibility service allows
you to click hundreds of times per second, but what's the point… if your average
Unity game can only register 10 clicks per second and at 30 just hangs or
crashes?"* — **the receiving app, not the OS, is the binding constraint.**

### 2.6 `Instrumentation.sendPointerSync` / UiAutomator

`SOURCE` + primary docs. Injection goes through
`IUiAutomationConnection.injectInputEvent` — "a very low-level method… only
accessible via reflection in automated tests." Permission gate passes via
`getInstrumentationSourceUid(callingUid)`, which is why UiAutomation must be
launched from adb.

Appium's own primary documentation of the timing contract
([appium.io](https://appium.github.io/appium.io/docs/en/writing-running-appium/android/actions/)):

- Tap = `ACTION_POINTER_DOWN`, **wait 125 ms**, `ACTION_POINTER_UP`. "525ms or
  longer wait will synthesize a long tap action instead."
- `downTime` must match the DOWN timestamp; `eventTime` =
  `SystemClock.uptimeMillis()`; coordinates identical between start/end.
- **"The OS simply ignores given events if they don't follow internal action
  requirements."**
- On MOVE cadence: *"Google uses 5ms as interval duration between move events in
  UiAutomator code, but according to our observations this value is too little,
  which causes noticeable delays in actions execution"* — they use 20 ms.

`COMMUNITY`: a 100 ms press-release renders as ~100 ms under UiAutomator1 but
**>1000 ms under UiAutomator2**; root cause never established
([appium#12707](https://github.com/appium/appium/issues/12707)).

The Appium vendor statement on the whole WebDriver route is the clearest
"where the wall is" statement in the field: *"the WebDriver protocol
communicates via HTTP REST API, requiring a roundtrip for each command… for some
complex setups the roundtrip duration may even be counted in seconds"* — their
`scheduled-actions` feature exists purely to move gestures server-side and
escape it.

### 2.7 scrcpy's input path

`SOURCE`: default is Android `InputManager.injectInputEvent` via reflection.
Since 2.4+ there are also **UHID** (kernel HID device) and **AOA** (raw USB HID
in OTG mode, no adb at all) routes.

**Input latency numbers: ABSENT.** scrcpy publishes none. rom1v's qualitative
statement is the key one, and it is the field's consensus:

> "What is called the input latency is the duration between the time you press a
> key and the time you get the result on your screen, so it is a full round
> trip… **The time to forward the event is insignificant.**"
> — [scrcpy#3275](https://github.com/Genymobile/scrcpy/issues/3275)

**scrcpy's entire advertised latency budget is observation.**

### 2.8 Ladder summary

| Method | Root? | Multitouch? | Cost | Label |
|---|---|---|---|---|
| `adb shell input tap` | no | **no** | ≥300–400 ms (≤A11); UNKNOWN (A12+) | COMMUNITY / UNKNOWN |
| `AccessibilityService.dispatchGesture` | no | yes (≤20 strokes) | ~150 ms/tap, blocking | COMMUNITY |
| UiAutomator / `injectInputEvent` | adb-launched | yes | 125 ms tap contract; 5–20 ms MOVE cadence | SOURCE |
| `sendevent` per-event via adb | root (pre-A10 shell) | yes | dominated by adb round trip | COMMUNITY |
| **write evdev/uinput from a resident on-device process** | uinput: no (A10+) | yes | **no platform-imposed floor** | SOURCE |
| RERAN-style raw stream replay | root | yes | **3.87 ms median, µs-accurate** | MEASURED |
| USB AOA HID (scrcpy OTG) | no adb | yes | UNKNOWN | ABSENT |

---

## 3. Sequential input time budgets — the core question

### 3.1 The per-event cost is not the bound. The buffer is.

There is no rate limiter anywhere on the write path (§2.2). But there **is** a
hard ceiling, and AOSP documents that overrunning it silently drops events:

`SOURCE`, `drivers/input/evdev.c`: each `open()` of the node gets its own ring
buffer. `EVDEV_BUF_PACKETS = 8`, `EVDEV_MIN_BUFFER_SIZE = 64`, sized
`roundup_pow_of_two(hint_events_per_packet * 8)` where `hint_events_per_packet`
is derived from **how the device's MT slots and axes were declared**
(`input_estimate_events_per_packet()`). Overflow queues `SYN_DROPPED`; Android's
`EventHub` responds by **dropping the whole frame and re-querying device
state.**

AOSP's own uinput README says it outright:

> "That time is probably in the past, so many of the 1000 injections will be
> sent immediately. This **will likely fill the kernel's event buffers, causing
> events to be dropped**."
> — [`cmds/uinput/README.md`](https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/cmds/uinput/README.md)

Downstream, `InputTransport.cpp`: `constexpr size_t SOCKET_BUFFER_SIZE = 32 * 1024`,
commented *"big enough to hold a few dozen large multi-finger motion events in
the case where an application gets behind processing touches."*

**This is the real ceiling, and it is testable with its own control**: declare
the virtual device two ways — few vs many MT slots — and confirm the drop
threshold moves with `evdev_compute_buffer_size`. Cross-check drops against
`getevent` observing `SYN_DROPPED`, **never** against the writer's own success
count.

### 3.2 Kernel duplicate filtering — a gotcha that will bite an injector

`SOURCE`, [`drivers/input/input.c`](https://raw.githubusercontent.com/torvalds/linux/master/drivers/input/input.c),
`input_get_disposition()`:

```c
// EV_KEY: unchanged state is dropped
if (!!test_bit(code, dev->key) != !!value) {
    __change_bit(code, dev->key);
    disposition = INPUT_PASS_TO_HANDLERS;
}
// EV_ABS: unchanged value after defuzz is dropped
if (pold) {
    *pval = input_defuzz_abs_event(*pval, *pold, dev->absinfo[code].fuzz);
    if (*pold == *pval) return INPUT_IGNORE_EVENT;
    *pold = *pval;
}
// SYN_REPORT always passes
case SYN_REPORT: disposition = INPUT_PASS_TO_HANDLERS | INPUT_FLUSH;
```

**Consequence:** two consecutive presses at the *identical* coordinate will have
their second `ABS_MT_POSITION_X/Y` silently dropped by the kernel. The tap still
registers, because `ABS_MT_TRACKING_ID` and `BTN_TOUCH` do change — but
re-asserting position does not work. Note `fuzz`: a nonzero `fuzz` means
*near*-identical values are dropped too. **Declare `fuzz = 0` on the virtual
device.**

### 3.3 InputDispatcher batching — and the fact that saves you

`SOURCE`, AOSP's own
[`android_view_InputEventReceiver.md`](https://android.googlesource.com/platform/frameworks/base/+/master/core/jni/android_view_InputEventReceiver.md):

> "Most apps draw once per vsync. Therefore, apps can only respond to 1 input
> event per frame." Batched events are consumed via a runnable "scheduled via the
> `Choreographer`" to fire "a short time before the next frame."

But batching applies to **MOVE only**. `SOURCE`, `InputTransport.cpp` — a batch
is only *started* for:

```cpp
mMsg.body.motion.action == AMOTION_EVENT_ACTION_MOVE ||
mMsg.body.motion.action == AMOTION_EVENT_ACTION_HOVER_MOVE
```

and `canAddSample()` returns false when the action differs.

**Therefore: `ACTION_DOWN` and `ACTION_UP` are never coalesced or dropped by the
Android framework.** Two events 10 ms apart both arrive. There is no
framework-level floor below which distinct touches vanish.

Resampling constants, for completeness (`SOURCE`, same file):

```
RESAMPLE_LATENCY        =  5 ms   // added latency to reduce mispredicted positions
RESAMPLE_MIN_DELTA      =  2 ms
RESAMPLE_MAX_DELTA      = 20 ms
RESAMPLE_MAX_PREDICTION =  8 ms
```

These affect MOVE interpolation only — irrelevant to discrete taps.

**This directly corroborates the mask-seam diagnosis.** 9-of-14 desyncs from "a
monitor press within 180 ms of a mask press" cannot be an Android coalescing
artifact, because DOWN/UP are never coalesced. It is a hit-testing/visibility
problem — the monitor bar isn't drawn, so InputDispatcher delivers to whatever
window *is* there. The framework source rules out the alternative.

### 3.4 Frame-rate coupling — where the drop actually happens

The drop is at the **engine**, and this is universal across engines that poll:

- **Unity (first-party):** *"If a touch is shorter-lived than a single input
  update, `Touchscreen` may overwrite it with a new touch coming in in the same
  update whereas this class will retain all changes that happened on the
  touchscreen in any particular update."* And: *"If you read out touch state from
  `Touchscreen` directly inside of the `Update` or `FixedUpdate` methods, your
  app will miss changes in touch state."*
  ([EnhancedTouch.Touch](https://docs.unity3d.com/Packages/com.unity.inputsystem@1.1/api/UnityEngine.InputSystem.EnhancedTouch.Touch.html),
  [Touch support](https://docs.unity3d.com/Packages/com.unity.inputsystem@1.7/manual/Touch.html))
- **libGDX (first-party):** *"If you rely on polling, you might miss events, e.g.
  a fast paced key down/key up."* `justTouched()` exists exactly for this and is
  disclaimed: *"it is not a reliable method as it is based on polling."*
  ([wiki](https://libgdx.com/wiki/input/polling))
- **Godot:** `Input.is_action_just_pressed()` misses `TouchScreenButton` presses
  on Android; the maintained workaround is signals, i.e. event-driven latching.
  ([#70951](https://github.com/godotengine/godot/issues/70951),
  [#82396](https://github.com/godotengine/godot/issues/82396))
- **Clickteam Fusion:** `COMMUNITY` only. Fusion's event loop "executes events
  whenever it gets there, which will be 60 times a second (or at whatever frame
  rate is set)". The community's own recommendation is to prefer the **Multiple
  Touch object's "A new touch has started"** over the Mouse & Keyboard object —
  i.e. the latched/edge-triggered condition, precisely because the level-sampled
  one drops fast contacts. **UNKNOWN(no Clickteam documentation of Android
  runtime touch latching exists).** The Fusion runtime source is not public.

**So: is 100 ms conservative, right, or wrong?** *Right in practice,
over-specified in principle, and measurable.*

- **Nothing in Android requires it.** DOWN/UP are not coalesced (§3.3). The
  kernel has no floor (§3.1).
- **The digitizer numbers do not apply.** The widely-repeated "20 to 50
  milliseconds to reliably register the touch"
  ([ktnr74, 2013](http://ktnr74.blogspot.com/2013/06/emulating-touchscreen-interaction-with.html))
  and the WALT p2k figures (§3.6) are about the **physical touchscreen scan and
  firmware**. An injected event enters `input_inject_event()` *below* the
  driver. `INFERENCE`, grounded in `evdev_write`'s call path. **Justifying the
  100 ms hold with digitizer physics is the wrong justification.**
- **The right model is ⌈2 frame periods⌉ + injection jitter.** At 60 fps that is
  ~33 ms; at 30 fps, ~67 ms. 100 ms is roughly 3× a 60 fps two-frame rule.
- **But 100 ms is where every professional automation stack independently
  landed:** Appium's tap = 125 ms hold; AOSP's own CTS fixture = 100 ms tap +
  40 ms gap; `ViewConfiguration.TAP_TIMEOUT` = 100. That convergence is not
  nothing.
- **And there is a ceiling:** `DEFAULT_LONG_PRESS_TIMEOUT = 400`. A 100 ms hold
  has 4× headroom before reclassification; a 300 ms hold would not.

**Concrete cheap experiment that could triple the free budget:** measure the
game's actual present cadence with `dumpsys SurfaceFlinger --latency <layer>`
and try halving the hold. Caveat: Fusion's "machine independent speed" *skips
display frames* when behind, so present rate may not equal event-loop rate — the
measurement bounds the answer, it does not settle it.

### 3.5 Gesture reclassification constants — the silent failure surface

`SOURCE`, [`ViewConfiguration.java`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/view/ViewConfiguration.java).
These reclassify a fast sequence into a *different* gesture without any error:

| Constant | Value | Javadoc semantics |
|---|---|---|
| `TAP_TIMEOUT` | **100** | "duration we will wait to see if a touch event is a tap or a scroll" |
| `DEFAULT_LONG_PRESS_TIMEOUT` | **400** | "before a press turns into a long press" |
| `DOUBLE_TAP_TIMEOUT` | **300** | max first-UP → second-DOWN for a double-tap |
| `DOUBLE_TAP_MIN_TIME` | **40** | **min** first-UP → second-DOWN for a double-tap |
| `JUMP_TAP_TIMEOUT` | 500 | |
| `HOVER_TAP_TIMEOUT` / `HOVER_TAP_SLOP` | 150 / 20 | |
| `PRESSED_STATE_DURATION` | 64 | |
| `TOUCH_SLOP` | 8 (dp) | |
| `SEND_RECURRING_ACCESSIBILITY_EVENTS_INTERVAL_MILLIS` | **100** | accessibility content-change coalescing |

**The one that should worry a 240 ms schedule: `DOUBLE_TAP_TIMEOUT = 300` with
`DOUBLE_TAP_MIN_TIME = 40`.** Two taps at the same location 240 ms apart fall
squarely inside the double-tap window. Whether that matters depends on whether
the Fusion runtime consumes double-tap — most game runtimes do not — but it is
exactly the class of silent reclassification that produces a "log reads like a
schedule" failure. Worth one control experiment.

`ANR`: input dispatch timeout is 5 s. Not a constraint here, but the associated
warning *"the touched window has not finished processing certain input events
that were delivered to it over 500.0ms ago"* is a symptom to watch for in logcat
if the rate ever goes up.

### 3.6 Touchscreen report rate vs injected devices

**Does a uinput device inherit the physical digitizer's report rate? No.**
`INFERENCE`, grounded in `SOURCE`: a uinput/uhid device is an independent
`input_dev` registered with the input core. Its event rate is whatever userspace
writes. The physical digitizer's 60/120/240/360 Hz scan rate is a property of
*that hardware device's driver* and has no bearing on a second device. The same
holds when writing to a real device's evdev node, because `evdev_write` calls
`input_inject_event()` directly — the driver's scan loop is not in the path.

Physical touch-sampling rates for context (`COMMUNITY`, vendor/press): 120 Hz
displays commonly pair with 240 Hz touch; gaming phones reach 720–960 Hz.
Irrelevant to an injector, relevant only as the reason a *human* baseline has
the jitter it has.

`MEASURED` physical sensing latency — the numbers an injector **bypasses**:

| Source | Device | ACTION_DOWN physical→kernel | kernel→Java |
|---|---|---|---|
| [google/walt TapLatency.md](https://github.com/google/walt/blob/master/docs/TapLatency.md) | across devices | **9.6 – 29.6 ms** (UP: 14.4–31.0) | 1.1 – 3.3 ms |
| [WALT_usage.md](https://github.com/google/walt/blob/master/docs/usage/WALT_usage.md) | Nexus 9 | 26.3 ms median (UP 19.5) | 1.2 / 1.7 ms |
| [Kämäräinen arXiv:1611.08520](https://arxiv.org/abs/1611.08520) Table 1 | Galaxy S4 / S7 | **40.5 / 24.1 ms** | 5.5 / 3.4 ms |
| same — **gamepad over USB** | S4 / S7 | **0.6 / 0.2 ms** | — |
| [Android Dev Blog 2021](https://android-developers.googleblog.com/2021/03/an-update-on-androids-audio-latency.html) | fleet | "10-35ms, with 20ms being fairly typical" | — |

Kämäräinen verbatim: *"Two surprising components dominate the overall
client-side delay: touch input processing and frame display… The USB connection
conveys user commands to the operating system considerably faster than the
capacitive touch screen. Our measurements show a negligible delay of under 1 ms
on both tested devices."*

**That contrast — 24–40 ms capacitive vs 0.2–0.6 ms USB — is the cleanest
published proof that the sensing layer is what costs, and that an injector does
not pay it.**

### 3.7 Maximum sustainable distinct-touch rate

**No published or reliably community-measured ceiling exists. UNKNOWN.**

What can be said:

- **Platform floor: none.** No rate limit in evdev, uinput, InputReader, or
  InputDispatcher for discrete DOWN/UP.
- **Platform ceiling: buffer-bound**, per §3.1, and the threshold is a function
  of the declared axes — measurable, not universal.
- **AOSP's own synthesised cadence: 120 Hz** (`SWIPE_EVENT_HZ_DEFAULT`), i.e.
  8.33 ms, is a rate AOSP considers safe.
- **Best measured sequential fidelity on a real phone: RERAN, 3.87 ms median,
  microsecond-accurate replay of the raw event stream.**
- **The binding constraint in practice is the receiving app**, per the
  Auto.js/Unity community observation in §2.5.

The one rhythm-game autoplayer publishing per-event timing
(`wlt233/ArcaeaAutoJSAutoplay`) uses **authored constants, not measurements**:
12 ms judgement refresh, 20 ms tap hold — and it routes through **root
`/dev/input`, having abandoned the accessibility path entirely.** That choice is
itself the most informative datum in the category.

---

## 4. Screen observation cost

### 4.1 Why `screencap` is expensive — the full decomposition, from source

`SOURCE`, [`screencap.cpp`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/cmds/screencap/screencap.cpp)
+ `Android.bp`:

1. **fork/exec + dynamic link** of a binary against
   `libcutils libutils libbinder libjnigraphics libhwui libui libgui`. `libhwui`
   alone pulls in Skia. Paid every invocation.
2. **Binder init per invocation:** `ProcessState::self()->startThreadPool()`.
3. **SurfaceFlinger round trip:** `ScreenshotClient::captureDisplay(...)` then
   `waitForResults()`.
4. **Two blocking waits:** the binder promise, *then* a GPU fence —
   `fenceResult.value()->waitForever("")`.
5. **CPU readback:** `buffer->lock(GraphicBuffer::USAGE_SW_READ_OFTEN, &base)`.
6. **PNG encode:** `AndroidBitmap_compress(..., quality=100, ...)` →
   `SkPngEncoder::Encode`. Skia defaults are the expensive ones: `fZLibLevel = 6`,
   `fFilterFlags = kAll` — five filters evaluated per row.
7. **SurfaceFlinger side, per screenshot:** main-thread hop, **fresh
   GraphicBuffer allocation**, and `mFactory.createCompositionEngine()` — a whole
   new CompositionEngine and ScreenCaptureOutput constructed per call. **None of
   it amortised.**

AOSP's own warning, verbatim: **`CAVEAT: This can be extremely slow; avoid use
unless absolutely necessary; prefer to directly use the HardwareBuffer
directly.`**
([`ScreenCapture.java:251`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/window/ScreenCapture.java))

### 4.2 Measured screencap costs

| Source | Device | Method | Time | Label |
|---|---|---|---|---|
| [verikun PR#71](https://github.com/ddikman/verikun/pull/71) | **Samsung SM-A415F, Android 12, physical, USB** | `screencap -p` | **2.60 s** (median of 5) | MEASURED |
| same | same | raw `screencap` + host encode | **1.09 s** | MEASURED |
| same | same | device-side PNG encode delta | **~1.4 s** | MEASURED |
| [MAA#5426](https://github.com/MaaAssistantArknights/MaaAssistantArknights/issues/5426) | BlueStacks, 1920×1080 | `exec-out screencap -p` | **782 ms** | MEASURED |
| same | same | `exec-out "screencap \| gzip -1"` | **366 ms** | MEASURED |
| [Appium Pro #83](https://appiumpro.com/editions/83-speeding-up-android-screenshots-with-mjpeg-servers) | accelerated emulator, 100 iterations | Appium screencap path | **~350 ms** | MEASURED |
| same | same | MJPEG server | **~150 ms** | MEASURED |
| **this project** | Moto handset | `screencap` | **225 ms** | project's own measurement |

**225 ms is faster than every published physical-device figure and faster than
the emulator figures.** That is not implausible — a small display, raw rather
than `-p`, and `exec-out` would all get there — but it is *outside the public
record*, which means **the methodology is the finding**: resolution, `-p` vs raw,
`exec-out` vs `shell`, USB generation, and exactly what the stopwatch enclosed.

**Do not trust [codegenes.net](https://www.codegenes.net/blog/using-adb-to-capture-the-screen/)**,
which publishes a clean-looking screencap timing table including an *"`exec-out`
BMP"* row. `screencap` has never had a BMP flag — verified against
`android-4.4_r1`, `7.1.1_r1`, `10.0.0_r1`, and `main`. COMMUNITY with a known
factual error.

### 4.3 Does cropping actually help? **On the path `screencap` uses — no.**

`SOURCE`. `gui::CaptureArgs` carries a crop and a scale:

```
// Crop in layer space: all content outside of the crop will not be captured.
ARect sourceCrop;
float frameScaleX = 1.0f;
float frameScaleY = 1.0f;
```

But `SurfaceFlinger::captureDisplay(DisplayId, CaptureArgs, ...)` — the overload
`ScreenshotClient::captureDisplay` reaches — does:

```cpp
size = display->getLayerStackSpaceRect().getSize();
size.width  *= args.frameScaleX;
size.height *= args.frameScaleY;
...
captureScreenCommon(RenderAreaBuilderVariant(..., Rect(), size, ...), ...);
```

**`Rect()` — an empty crop, hard-coded. `sourceCrop` is ignored on this path;
`frameScale` is honoured.**

The crop-honouring path is `SurfaceFlinger::captureLayers`, which sizes the
destination from the crop, and it is reachable from shell:
`UiAutomation.takeScreenshot()` → `UiAutomationConnection.takeScreenshot(Rect crop, ...)`
→ `.setSourceCrop(crop)` → `WindowManagerService.captureDisplay()` →
`ScreenCapture.captureLayers(...)`. Gated on `READ_FRAME_BUFFER`, which the Shell
package holds.

Also: `screencap`'s path passes `snapshotFilterFn = nullptr` — **no layer
filtering; every layer is composited regardless of region.**

**So a 20×9 region read through `captureDisplay` is free only in *transfer*. The
composite and readback are full-frame.** The lever that works on that path is
`frameScaleX/Y`.

### 4.4 AOSP's own tiny-region sampler is the worked example — and it budgets 3 ms

`SOURCE`, [`RegionSamplingThread.cpp`](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/services/surfaceflinger/RegionSamplingThread.cpp)
— SurfaceFlinger's own small-region luma sampler for the nav bar:

```cpp
constexpr auto defaultRegionSamplingWorkDuration = 3ms;
constexpr auto defaultRegionSamplingPeriod = 100ms;
```

Every one of its optimisations is a lever:

- Allocates the GraphicBuffer at **exactly `sampledBounds`**, and **caches it**
  across samples (`mCachedBuffer`) — no per-sample allocation.
- Passes a **layer filter**
  (`getLayerSnapshotsForScreenshots(layerStack, UNSET_UID, filterFn)`) that skips
  every layer not intersecting the region, so composition work shrinks too.
- Runs **inside SurfaceFlinger**: no process spawn, no binder round trip, no
  encode, no adb.

**59 ms for 180 pixels is ~20× AOSP's budget for the same shape of work.**
`INFERENCE`: the cost is almost entirely fixed overhead — process/IPC entry into
SurfaceFlinger per read — not pixels. **No published crop-vs-full-frame
measurement exists (ABSENT)**, so this is source-derived reasoning, not a number
to quote.

### 4.5 The fast paths: what "good" looks like

**scrcpy** (`SOURCE`): `DisplayManager.createVirtualDisplay` → `MediaCodec`
**input surface** → H.264/H.265 over the adb socket. **No readback anywhere.**
Encoder tuned for latency: `KEY_LATENCY = 1`, `KEY_PRIORITY = 0` (realtime),
`KEY_FRAME_RATE = 60`, `KEY_I_FRAME_INTERVAL = 10`.

`MEASURED` — [PR #646](https://github.com/Genymobile/scrcpy/pull/646), rom1v,
**Nexus 5**, method: a video incrementing a counter every 33.3 ms played
on-device and photographed beside the mirrored window:

| Config | before | after |
|---|---|---|
| 1080×1920 | ~3 frames ≈ **100 ms** | ~2 frames ≈ **67 ms** |
| 448×800 | ~2 frames ≈ **67 ms** | ~1 frame ≈ **33 ms** |

`COMMUNITY` but with real methodology, same thread: a 1 ms counter photographed
at 1/12000 s on a native 2400×1080 phone at 77 Hz gave **h264 ≈ 12 ms, h265 ≈
8–9 ms** end-to-end. **That is the fastest credible full-frame Android
observation figure in the public record.**

**minicap** (`COMMUNITY`, README, author disclaims it as a measurement): 10–20
fps weak devices, 30–40 fps newer; "one to a few frames behind." sorccu's own
step breakdown: *"3. The frame is converted to JPEG (slow) 4. The JPEG data is
sent via the ADB USB connection (slow)"* — everything else "(fast)". No
named-device figure exists anywhere.

**`screenrecord`** (`SOURCE`): `codec->createInputSurface()`,
`KEY_FRAME_RATE = displayFps` — the display feeds the encoder directly, **no
readback**. `kMaxTimeLimitSec = 180` is a *default*, removable with
`--time-limit 0`. Its `--output-format=frames|raw-frames` options are
undocumented in `usage()` and go through `glReadPixels`, i.e. straight back into
readback-bound territory. **Glass-to-frame latency for `screenrecord`: ABSENT.**
It sets neither `KEY_LATENCY` nor `KEY_PRIORITY`, so it cannot structurally beat
scrcpy.

**MediaProjection + ImageReader:** **per-frame ms ABSENT.** What is known
(`SOURCE`): frames are produced **only on change** on Android 4.2+;
`ImageReader` gives a CPU-readable buffer (readback, like screencap) whereas
SurfaceTexture/MediaCodec keep it on the GPU; `maxImages` ≥ 2 needed for
`acquireLatestImage`; and the producer "may eventually stall or drop Images" if
the consumer lags. The industry default for continuous Android observation is
Appium's MJPEG broadcaster: **10 fps, 50% scale, 50% quality**.

### 4.6 Is observing published as more expensive than acting? Yes — one clean measurement

`MEASURED` — [Mobile-Env](https://github.com/X-LANCE/Mobile-Env) (SJTU X-LANCE,
[arXiv:2305.08144](https://arxiv.org/abs/2305.08144)), rig fully specified
(Pixel 2 AVD API 30, 1080×1920, i7-10700/RTX 3090, KVM):

| Item | Avg | SD |
|---|---|---|
| `TOUCH` action | **410.50 µs** | 64.71 µs |
| `LIFT` action | **412.30 µs** | 84.18 µs |
| screenshot capture | **19.94 ms** | 21.47 ms |
| view-hierarchy capture | **2.53 s** | 1.90 s |

**A screenshot costs ~48× a touch-down; a hierarchy read ~6,200×.** Emulator,
and both operations ride the *same* gRPC transport — which cuts both ways, but
means the 48× asymmetry is isolated cleanly, with process spawn, USB, and PNG
all removed.

Plus rom1v's statement (§2.7) that the input forwarding cost "is insignificant,"
and scrcpy publishing no control-channel number at all because its entire budget
is observation.

**The important correction to the folklore:** "acting is expensive on Android"
is a *process-startup artifact of `adb shell input`*, not injection cost.
Against a persistent actuator, acting collapses to sub-millisecond.
**Observation does not collapse the same way.** So the asymmetry this
architecture is built around is *wider* than commonly assumed, which argues for
the design, not against it.

### 4.7 Cheaper-than-pixels channels

- **`dumpsys SurfaceFlinger --latency <layer>`** (`SOURCE`): per-line
  `desiredPresentTime\tactualPresentTime\tframeReadyTime`,
  `NUM_FRAME_RECORDS = 128`. `actualPresentTime` = "the timestamp at which the
  current frame became visible to the user." **This is frame timing with no
  pixels, and it is how to measure the game's real present cadence for §3.4.**
  Note the field order differs from the 2012 commit message everyone quotes —
  trust the source.
- **`dumpsys gfxinfo <pkg> framestats`**: 23 columns,
  `RingBuffer<FrameInfo, 120>`. **Caveat (`INFERENCE`, unverified):** this comes
  from `libs/hwui`, the View-system renderer. A Clickteam Fusion game drawing its
  own surface is not in the HWUI pipeline, so `framestats` may be empty for it
  while `--latency` still works, because the latter tracks the *layer*. Verify
  before designing around it.
- **`dumpsys` times itself**: it emits
  `--------- %.3fs was the duration of dumpsys %s`. Cheapest correct way to
  price it, measured on-device.
- **Audio.** CDD: continuous input latency STRONGLY RECOMMENDED ≤ **30 ms**;
  `android.hardware.audio.pro` = round-trip ≤ 20 ms. Google fleet 2021:
  round-trip avg **39 ms** (min 28), and typical audio *input* latency ~5 ms.
  **Hard gate to check first:** `AudioPlaybackCapture` (API 29+) requires the
  captured app to use `USAGE_MEDIA/GAME/UNKNOWN` **and** allow
  `ALLOW_CAPTURE_BY_ALL` — default-enabled only for `targetSdkVersion ≥ 29`.
  **A game targeting API ≤ 28 without `android:allowAudioPlaybackCapture="true"`
  is not capturable at all.**
- **Accessibility / UI hierarchy.** No published ms cost, but the structural
  constants bound it hard: `TIMEOUT_INTERACTION_MILLIS = 5000` blocking into the
  target app's **main UI thread**; `MAX_NUMBER_OF_PREFETCHED_NODES = 50`
  (⌈N/50⌉ round trips); **`SEND_RECURRING_ACCESSIBILITY_EVENTS_INTERVAL_MILLIS =
  100`** — recurring content-changed events are coalesced to at most one per
  100 ms. **Accessibility cannot resolve a change faster than 100 ms no matter
  how fast you poll.** And UiAutomator's `waitForIdleTimeout = 10000 ms` runs to
  full timeout on a continuously-animating screen.
- **Frida / Xposed.** Frida's `Interceptor.attach` ~6 µs / ~11 µs figures are
  **iPhone 5S numbers — do not transplant them to Android/ARM64**; no Android
  figure is published. `send()` is explicitly not optimised for high frequency.
  Xposed/LSPosed hook overhead: **ABSENT.**

---

## 5. Verdict

### 5.1 The architecture is right, and for the documented reasons

uinput/HID writes + ≥100 ms contacts + a device-local sampler + an open-loop
schedule with sparse reactive reads is **the shape every serious practitioner
converges on**, and each element is independently supported:

| Element | Support |
|---|---|
| uinput/HID writes over `input tap` | rom1v: forwarding cost "insignificant"; RERAN 3.87 ms; kernel has no rate limit |
| ≥100 ms contacts | Unity/libGDX/Godot first-party docs on polling; Appium 125 ms; CTS 100 ms; `LONG_PRESS = 400` ceiling |
| device-local sampler over `screencap` | Mobile-Env 48×; HeadSpin 350→150 ms; MAA auto-benchmarks; AOSP's own `CAVEAT: extremely slow` |
| open-loop schedule, sparse reactive reads | Every documented real-time touchscreen win escapes the loop; AndroidEnv's mitigation is a *throttle* |
| pricing against the actual actuator | The whole field's failure mode; MAA's 400/800 ms alarms are the same instinct |

### 5.2 What could plausibly beat it — ranked

**1. Observation is where the 5–25× lives. (Biggest.)**

scrcpy's mechanism — VirtualDisplay → MediaCodec **input surface** → hardware
H.264, no readback — reaches 33–67 ms for a *whole 1080p frame* on a Nexus 5 and
8–12 ms on a modern phone. 59 ms buys 180 pixels. Two concrete moves:

- **Go resident and stop re-entering SurfaceFlinger per read.** AOSP's
  `RegionSamplingThread` does the same job in a **3 ms budget** by caching the
  destination GraphicBuffer, filtering layers to the region, and never leaving
  the process.
- **Push, not poll.** Frames are produced **only on change** (Android 4.2+). A
  resident capture consumer is *woken* when the screen changes. That is an
  architectural change: the 680 ms/cycle stops being spent on scheduled reads at
  all, and the "price every observation before scheduling it" rule stops being
  the binding one.
- **Also:** on `captureDisplay`, `sourceCrop` is being ignored (§4.3). Use
  `frameScaleX/Y` on that path, or `captureLayers` via `UiAutomation` if a crop
  is genuinely needed.

**2. The ~240 ms spacing is the number most likely to be recoverable.**

Nothing in Android, the kernel, or the input stack imposes it. AOSP's own swipe
synthesiser runs at **120 Hz**. RERAN replays at **3.87 ms median with
microsecond fidelity on real phones**. If the 240 ms is a *game animation gate*
(like the documented `MONITOR_ANIM_DOWN = 367 ms`), it is real and
phone-independent and should be said so. If it is a *harness* cost — per-press
process spawn, adb round trip, or a sleep chosen for human plausibility — it is
60× recoverable.

*(Project note, added on landing: this repository had already withdrawn the
240 ms figure on 2026-08-24 as a `camtrace.py` grading artifact and measured
120 ms spacing at 4/4. Only `CLAUDE.md` still asserted 240 ms, and that was
corrected on 2026-08-26. The two lines of evidence agree.)*

**3. The 100 ms hold can probably be ~35–70 ms, and that triples the free budget.**

Measure the game's actual present cadence (`dumpsys SurfaceFlinger --latency` on
the game's layer), then hold two frame periods plus jitter. At 60 fps that is
~35 ms; recovering ~65 ms per contact. Caveat: Fusion's "machine independent
speed" skips display frames when behind, so present rate ≠ event-loop rate.
Also check `DOUBLE_TAP_TIMEOUT = 300` / `DOUBLE_TAP_MIN_TIME = 40` isn't
reclassifying same-location repeats.

**4. Per-frame polling cannot be escaped — but the kernel's buffer can be.**

If the engine samples state once per Update(), holding across a frame boundary
is the only guarantee. There is no trick. What *can* be done is making sure
events are not silently lost to the evdev ring: `EVDEV_BUF_PACKETS = 8`, sized
from the declared MT slots, overflow → `SYN_DROPPED` → `EventHub` drops the
whole frame. Test it with a control: two axis declarations, and `getevent`
watching for `SYN_DROPPED` — never the writer's own success count.

**5. Portability, not speed: check which node is written.**

Writing `/dev/input/eventX` as shell has been forbidden by SELinux since 2018
(neverallow + CTS test) — that relies on root. `/dev/uinput` is open to shell
from **Android 10**, `/dev/uhid` from **8.1**, and `adb shell uinput -` is a
**first-party AOSP command** that registers arbitrary `ABS_*` axes and replays
evemu recordings, with a shipped multitouch example.

**6. Two corrections to land, because they are actively misleading if written down.**

- "`input tap` costs a JVM start" — true only on Android ≤ 11. On 12+ it is
  `cmd input` into system_server. Still unusable (no multitouch verb,
  synchronous `WAIT_FOR_FINISH`), but for different reasons, and the cost is
  **UNKNOWN(never re-measured after the rewrite)**.
- "Android 12/13 blocked shell injection" — **false.** It was scrcpy v1.23
  passing `0` as `targetUid` through a reflection fallback. `INJECT_EVENTS` for
  shell has never been removed. This is the kind of claim that quietly rules out
  a working route.

### 5.3 Universal constraints vs this handset

**Universal — a different phone changes nothing:**

- Per-frame polling drops sub-frame contacts. Engine-level, confirmed
  first-party for Unity, libGDX, and Godot.
- Only `ACTION_MOVE`/`ACTION_HOVER_MOVE` are batched; **DOWN and UP are never
  coalesced**. The mask-seam diagnosis is therefore correct and the framework
  rules out the alternative.
- Kernel drops unchanged `EV_ABS` (after fuzz) and unchanged `EV_KEY` state.
- evdev ring overflow → `SYN_DROPPED` → whole-frame drop in `EventHub`.
- `ViewConfiguration`: TAP 100, LONG_PRESS 400, DOUBLE_TAP 300 / min 40,
  TOUCH_SLOP 8dp.
- `input` is synchronous (`WAIT_FOR_FINISH`) and single-pointer.
- Accessibility coalesces content-change events to ≥100 ms.
- Observation ≫ action, structurally.
- SELinux bans shell writes to `/dev/input` from Android 10; uinput open to
  shell from 10, uhid from 8.1.

**This handset / this harness — another phone or implementation moves these:**

- **~240 ms press-to-press.** No platform support. Harness or game-animation,
  and which one matters enormously. *(Resolved on landing — see the project note
  in §5.2 item 2.)*
- **225 ms `screencap`.** Depends on resolution, raw vs PNG, `exec-out` vs
  `shell`, USB generation. Faster than the entire published record — the
  methodology *is* the finding.
- **59 ms sampler.** Dominated by fixed overhead in this implementation, not by
  180 pixels. AOSP's budget for the same job is 3 ms.
- **100 ms hold.** Right ballpark and well-corroborated, but the correct value
  is a function of the *game's* frame rate, not the phone's.
- **21 ms `date`.** Higher than a bare toybox fork+exec would normally cost
  (~1–4 ms on Linux); plausible under load with a cold page cache. **AOSP ships
  the benchmark (`bionic-spawn-benchmarks`) and publishes no results —
  UNKNOWN.** *(Retracted doubt: the project's own on-device measurement — 100
  calls in 2126 ms, with a `/proc/uptime` control at 0.36 ms — is better
  controlled than anything published. Removing the fork was right regardless.)*
- **680 ms free per cycle.** Entirely this project's cycle design.

### 5.4 What is genuinely absent

- Any measured closed-loop latency for a reactive bot on a physical Android
  handset. **This project is past the published record.**
- Any latency number in minitouch, minicap, STF, Airtest/Poco, or scrcpy-OTG
  documentation.
- A published comparison table of `screencap` vs minicap vs scrcpy vs
  MediaProjection in ms. **It does not exist.**
- A controlled ms comparison of `input tap` vs `sendevent` vs uinput.
- Any published crop-vs-full-frame capture measurement.
- `dispatchGesture` measured throughput; autoclicker CPS ceilings (verified
  absent across 14 Play listings).
- Human-vs-bot tap-interval *distributions* — the literature reports means,
  never variance. HuMIdb is the only route to first-hand numbers for the ±60 ms
  slack.
- Android/ARM64 Frida hook overhead; Xposed hook overhead.
- Per-invocation adb round-trip cost. AOSP ships `benchmark_device.py` and
  publishes no results.
