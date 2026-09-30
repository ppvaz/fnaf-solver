// What a stock-device native-resolution pixel watchlist can see, modelled with
// the real sensor's coarseness and latency. Plan 19 package 1.
//
// The device sensor is the cue helper's MediaProjection VirtualDisplay read
// (~59 ms device-local, ~15 Hz, its own surface -- no SurfaceFlinger contention,
// ONE-PIXEL-VISION.md). It samples a fixed watchlist of native pixels / tiny
// ROIs and returns their reduced values; the calibration that maps those values
// to game facts is plan 19 package 3.
//
// Every fact is `{ state: 'OBSERVED', value }` or `{ state: 'UNKNOWN', reason }`
// -- never a bare value (CLAUDE.md: "UNKNOWN(reason) is worth more than a
// plausible value"). A fact whose pixels are ambiguous THIS frame -- the screen
// mid-animation, the office panned, a blackout hiding the opening -- resolves
// UNKNOWN rather than guessing.
import * as C from '@sixam/source/games/fnaf2/config.js';

// One read per this many frames: ~15 Hz, the measured device cadence.
export const OBSERVE_INTERVAL = 4;

const MON_UP = 'up', MON_DOWN = 'down';

/** @param {any} value @returns {any} */
const O = (value) => ({ state: 'OBSERVED', value });
/** @param {any} reason @returns {any} */
const U = (reason) => ({ state: 'UNKNOWN', reason });

export const FACTS = ['blackout', 'amHour', 'monitorUp', 'maskOn', 'boxPie',
                      'cameraSelected', 'cameraHighlights', 'splitArmed',
                      'leftOpening', 'ventLightL',
                      'bbVent', 'bbVentId', 'ventThud', 'ventThudId', 'ventThudAge',
                      'mangleStatic', 'mangleStaticCam'];

// How long a heard thud stays in the fact set. The same retention the Balloon
// Boy opening cue already uses: the fact is an edge, and the consumer decides
// what an edge of that age still means.
const THUD_WINDOW = C.s(12);

// A complete fact set with every entry UNKNOWN -- what the controller sees
// before the first read completes.
const NO_READ = () => {
  const o = { frame: -1 };
  for (const k of FACTS) o[k] = U('no-read-yet');
  return o;
};

export class Observer {
  constructor({ interval = OBSERVE_INTERVAL, readDelayFrames = 0, dropRate = 0,
                rng = null, audioLatencyFrames = 12, audioDropRate = 0,
                audioFalseNegativeRate = 0, audioFalsePositiveRate = 0,
                mangleAudioLatencyFrames = audioLatencyFrames,
                mangleAudioDropRate = audioDropRate,
                mangleAudioFalseNegativeRate = audioFalseNegativeRate,
                mangleAudioFalsePositiveRate = audioFalsePositiveRate } = {}) {
    this.interval = interval;
    this.readDelayFrames = readDelayFrames;  // model host round-trip latency
    this.dropRate = dropRate;                // fraction of reads that come back UNKNOWN
    this.rng = rng;
    this.audioLatencyFrames = audioLatencyFrames; // A2DP transport, ~200 ms
    // These are independent detector parameters. Defaults are deliberately
    // zero because the current engine feed is only a privileged cue proxy;
    // device promotion must supply measured rates rather than inherit an
    // oracle. They are nevertheless available for cue-free/error sweeps.
    this.audioDropRate = audioDropRate;
    this.audioFalseNegativeRate = audioFalseNegativeRate;
    this.audioFalsePositiveRate = audioFalsePositiveRate;
    // Mangle's cue is a sustained static loop (s0020, g732/733), not a
    // visually sampled opening. Keep its transport and detector errors
    // independently tunable from the BB event classifier.
    this.mangleAudioLatencyFrames = mangleAudioLatencyFrames;
    this.mangleAudioDropRate = mangleAudioDropRate;
    this.mangleAudioFalseNegativeRate = mangleAudioFalseNegativeRate;
    this.mangleAudioFalsePositiveRate = mangleAudioFalsePositiveRate;
    this.evtCursor = 0;                      // how much of the event feed is heard
    this.lastCueAt = -Infinity;              // device-frame the last cue became audible
    /** @type {any} */ this.lastCueType = false; // 'route' | 'pending' | 'opening'
    this.lastCueId = null;                   // one engine event = one visit cue
    this.audioSeq = 0;
    this.lastThudAt = -Infinity;             // device-frame the last thud became audible
    this.lastThudId = null;
    this.mangleStaticByContext = { office: false, cam11: false };
    this.mangleStaticPending = [];
    this.mangleAudioSeq = 0;
    this.lastReadFrame = -Infinity;
    this.cache = NO_READ();
    this.pending = [];                       // delayed reads not yet visible
  }

  // Take a fresh read off a live Sim if the cadence allows, then return the
  // most recent read that has finished its round-trip.
  read(sim) {
    // Audio is not on the video cadence: the event feed stands in for the
    // detector, each discrete cue surfacing after the transport latency.
    // Cue semantics are the device owner's play (2026-08-30): laughs are
    // belief only (route position), the FIRST thud (stage-4 CAM 05 arrival,
    // cam:true) means BB is pending -- committed to the vent, not yet
    // evictable -- and the SECOND thud (the thud+21 arrival pair, g607) means
    // he is at the opening and evictable. Most recent cue wins.
    let cueSeen = false;
    for (; this.evtCursor < sim.events.length; this.evtCursor++) {
      const e = sim.events[this.evtCursor];
      // The marker-122 thud, WITHOUT an identity.
      //
      // `[SOURCED]` every vent-bang the engine raises carries the same
      // `C.THUD_SAMPLE` (17) -- Balloon Boy's, Toy Chica's, Withered Bonnie's,
      // an arrival and a departure alike -- and config.js's own note beside
      // that constant says "Nothing in the audio distinguishes them". A
      // detector that can hear Balloon Boy's thud therefore hears every other
      // one too. This observer used to keep only `who === 'bb'` and drop the
      // rest, which is not a coarser sensor than the device's: it is a
      // DIFFERENT one, with a per-character discrimination the hardware does
      // not have, and it hid the single most common cause of death in this
      // repository's cohorts (Toy Chica walking into the office on a cams-up
      // frame, 6/22/12/0/25/10/19 runs of 60 on Nights 1-7, measured
      // 2026-09-04). The identity stays unavailable; the event does not.
      if (e.type === 'vent-bang' &&
          !(this.audioFalseNegativeRate > 0 &&
            this._random() < this.audioFalseNegativeRate)) {
        this.lastThudAt = e.f + this.audioLatencyFrames;
        this.lastThudId = `${this.evtCursor}:${e.f}:thud`;
      }
      let cue = null;
      if (e.type === 'laugh') cue = 'route';
      else if (e.type === 'vent-bang' && e.data?.who === 'bb') {
        if (e.data.arrival) cue = 'opening';
        else if (e.data.cam) cue = 'pending';
      }
      if (cue) {
        cueSeen = true;
        if (this.audioFalseNegativeRate > 0 &&
            this._random() < this.audioFalseNegativeRate) continue;
        this.lastCueType = cue;
        this.lastCueAt = e.f + this.audioLatencyFrames;
        this.lastCueId = `${this.evtCursor}:${e.f}:${cue}`;
      }
      if (e.type === 'mangle-static') {
        if (this.mangleAudioFalseNegativeRate > 0 &&
            this._random() < this.mangleAudioFalseNegativeRate) continue;
        this.mangleStaticPending.push({
          at: e.f + this.mangleAudioLatencyFrames,
          context: e.data?.context ?? 'office',
          present: !!e.data?.present,
          id: `${this.evtCursor}:${e.f}:${this.mangleAudioSeq++}`,
        });
      }
    }
    // A false-positive detector model is opt-in and has no engine event or
    // privileged identity. That distinction is useful in the cue-free
    // control: the controller can only consume a real visit identity.
    if (!cueSeen && this.audioFalsePositiveRate > 0 &&
        this._random() < this.audioFalsePositiveRate) {
      this.lastCueType = 'opening';
      this.lastCueAt = sim.frame;
      this.lastCueId = `fp:${this.audioSeq++}`;
    }
    if (sim.frame - this.lastReadFrame >= this.interval) {
      this.lastReadFrame = sim.frame;
      const snap = this._sample(sim);
      this.pending.push({ at: sim.frame + this.readDelayFrames, snap });
    }
    while (this.pending.length && this.pending[0].at <= sim.frame)
      this.cache = this.pending.shift().snap;
    while (this.mangleStaticPending.length &&
           this.mangleStaticPending[0].at <= sim.frame) {
      const cue = this.mangleStaticPending.shift();
      if (cue.context === 'office' || cue.context === 'cam11')
        this.mangleStaticByContext[cue.context] = cue.present;
    }
    return { ...this.cache, ...this._audioFacts(sim) };
  }

  _random() { return this.rng ? this.rng.next() : Math.random(); }

  _drop() {
    if (!this.dropRate) return false;
    // `rng` is a src/rng.js Rng (next() -> [0,1)) or any {next()}; else Math.random.
    return (this.rng ? this.rng.next() : Math.random()) < this.dropRate;
  }

  _sample(sim) {
    const midMon = sim.monitor !== MON_UP && sim.monitor !== MON_DOWN;
    const midMask = sim.maskAnim > 0;
    const drop = this._drop();
    const hour = Math.min(6, Math.floor(sim.frame / C.HOUR_FRAMES));

    // A monitor-dependent read within the lower animation of a monitor press is
    // exactly the night 6-38 false positive: refuse it.
    const officeVisible = sim.monitor === MON_DOWN && !midMon && !midMask;
    const feedVisible = sim.camsUp && !midMon;
    const cameraUp = feedVisible && sim.viewing > 0;
    const cameraNumbers = cameraUp
      ? [...new Set([sim.cam, sim.viewing].filter(camera =>
          Number.isInteger(camera) && camera > 0 && camera <= 12))]
          .sort((a, b) => a - b)
      : [];
    const cameraNames = cameraNumbers.map(camera => `cam:${camera}`);

    return {
      frame: sim.frame,

      // whole-screen luma collapse -- the one fact a coarse read never misses
      blackout: drop ? U('read-dropped') : O(sim.blackout.active),

      // digit strokes, a phase anchor; small but high-contrast white-on-dark
      amHour: drop ? U('read-dropped') : O(hour),

      monitorUp: drop ? U('read-dropped')
        : midMon ? U('monitor-animating') : O(sim.camsUp),

      maskOn: drop ? U('read-dropped')
        : midMask ? U('mask-animating') : O(sim.maskFullyOn),

      // the box-pie fraction, only legible on the CAM 11 feed
      boxPie: drop ? U('read-dropped')
        : (feedVisible && sim.viewing === C.BOX_CAM) ? O(sim.box)
        : U('box-not-on-screen'),

      // A split glitch is an observed set, not a singular camera. Keep the
      // exact marker/view pair so an arming verifier can distinguish CAM 08 +
      // CAM 11 (Minus 3) from CAM 09 + CAM 11 (Minus Toys).
      cameraHighlights: drop ? U('read-dropped')
        : cameraUp && cameraNames.length ? O(cameraNames)
        : U('cams-not-up'),
      cameraSelected: drop ? U('read-dropped')
        : cameraUp && cameraNames.length === 1 ? O(cameraNames[0])
        : cameraUp ? U('multiple-camera-highlight')
        : U('cams-not-up'),

      // both camera buttons lit == viewing marker disagree, monitor up
      splitArmed: drop ? U('read-dropped')
        : feedVisible && sim.viewing > 0 ? O(sim.cam !== sim.viewing)
        : U('cams-not-up'),

      // ONE-PIXEL-VISION.md: pixel (451,730) is 194 for the known-safe empty
      // opening, 0 for BB in it. `bb.inside` also reads black; treat both as
      // threat. Only legible with the office in view and undisturbed.
      leftOpening: drop ? U('read-dropped')
        : officeVisible && !sim.blackout.active
          ? O((sim.bb.inOpening || sim.bb.inside) ? 'threat' : 'empty')
          : U('opening-not-in-view'),

      // the left vent light widget, only while the office is shown
      ventLightL: drop ? U('read-dropped')
        : officeVisible ? O(sim.ventLightL) : U('office-not-in-view'),

    };
  }

  // Audio is returned from the live cadence, not from the delayed video
  // snapshot. This keeps A2DP latency/detector loss independent of monitor
  // animation, video read cadence, and video drop coins.
  _audioFacts(sim) {
    let bbVent = O(false), bbVentId = O(null);
    // One detector, one drop coin: the thud and the Balloon Boy classification
    // are the same audio channel, so a dropped read loses both.
    const audioDropped = this.audioDropRate > 0 && this._random() < this.audioDropRate;
    let ventThud = O(false), ventThudId = O(null), ventThudAge = O(null);
    if (audioDropped) {
      ventThud = U('audio-dropped');
      ventThudId = U('audio-dropped');
      ventThudAge = U('audio-dropped');
    } else if (this.lastThudId !== null) {
      const age = sim.frame - this.lastThudAt;
      if (age >= 0 && age <= THUD_WINDOW) {
        ventThud = O(true);
        ventThudId = O(this.lastThudId);
        ventThudAge = O(age);
      }
    }
    if (audioDropped) {
      bbVent = U('audio-dropped');
      bbVentId = U('audio-dropped');
    } else if (this.lastCueType !== false) {
      const age = sim.frame - this.lastCueAt;
      if (age >= 0) {
        const window = this.lastCueType === 'opening' ? C.s(12) : C.s(20);
        if (age <= window) {
          bbVent = O(this.lastCueType);
          bbVentId = O(this.lastCueId);
        }
      }
    }

    // The same s0020 waveform can be raised by two proximity contexts: CAM 11
    // (the winding/Prize Corner camera) and the office/right-vent edge. Keep
    // them as separate facts. The camera occurrence is diagnostic only; the
    // reactive policy consumes the office occurrence.
    let mangleStatic = O(this.mangleStaticByContext.office);
    let mangleStaticCam = O(this.mangleStaticByContext.cam11);
    if (this.mangleAudioDropRate > 0 && this._random() < this.mangleAudioDropRate) {
      mangleStatic = U('audio-dropped');
      mangleStaticCam = U('audio-dropped');
    } else if (!this.mangleStaticByContext.office && this.mangleAudioFalsePositiveRate > 0 &&
               this._random() < this.mangleAudioFalsePositiveRate) {
      mangleStatic = O(true);
    }
    return { bbVent, bbVentId, ventThud, ventThudId, ventThudAge,
             mangleStatic, mangleStaticCam };
  }
}

// Convenience: the value if OBSERVED, else the fallback.
export const val = (fact, fallback = null) =>
  fact && fact.state === 'OBSERVED' ? fact.value : fallback;
