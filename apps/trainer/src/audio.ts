// Synthesised cues. No sample files: everything is WebAudio, so the whole
// trainer stays a single self-contained page.
export class Audio {
  declare ctx: AudioContext | null;
  declare ready: boolean;
  declare enabled: boolean;
  declare ambNodes: { o: AudioScheduledSourceNode, o2: OscillatorNode | null, g: GainNode } | null;
  declare samples: Record<string, AudioBuffer>;
  // unlock() sets it with ctx, before ready; nothing reads it until then.
  declare master: GainNode;
  constructor() {
    this.ctx = null; this.ready = false; this.enabled = true; this.ambNodes = null;
    // Filled by assets.js when the player has loaded their own sounds; any slot
    // left empty falls back to the synthesised cue below.
    this.samples = {};
  }

  // Every cue below plays only once ready, and unlock() makes the context before it sets ready.
  get live() { return this.ctx as AudioContext; }

  play(slot: string, v = 0.9) {
    const buf = this.samples[slot];
    if (!buf || !this.ready || !this.enabled) return false;
    const src = this.live.createBufferSource();
    src.buffer = buf;
    const g = this.live.createGain(); g.gain.value = v;
    src.connect(g); g.connect(this.master);
    src.start();
    return true;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.ready = true;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  gain(v: number, at: number, dur: number) {
    const g = this.live.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(this.master);
    return g;
  }

  tone(freq: number, at: number, dur: number, v = 0.25, type: OscillatorType = 'square') {
    if (!this.ready || !this.enabled) return;
    const o = this.live.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    o.connect(this.gain(v, at, dur));
    o.start(at); o.stop(at + dur + 0.05);
    return o;
  }

  noise(at: number, dur: number, v = 0.3, freq = 700, q = 1) {
    if (!this.ready || !this.enabled) return;
    const n = Math.floor(this.live.sampleRate * dur);
    const buf = this.live.createBuffer(1, n, this.live.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.live.createBufferSource(); src.buffer = buf;
    const f = this.live.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(this.gain(v, at, dur));
    src.start(at);
  }

  // --- cues ---------------------------------------------------------------
  laugh() {
    if (!this.ready) return;
    if (this.play('laugh')) return;
    const t = this.t;
    for (let i = 0; i < 5; i++) this.tone(520 - i * 25, t + i * 0.075, 0.06, 0.16, 'sawtooth');
  }

  ventBang(leaving = false) {
    if (!this.ready) return;
    if (this.play('ventBang')) return;
    const t = this.t;
    this.noise(t, 0.16, 0.5, leaving ? 220 : 160, 1.4);
    this.noise(t + 0.09, 0.12, 0.34, leaving ? 300 : 200, 1.4);
  }

  // Each control gets its own pitch, so a correct cycle has a recognisable
  // tune. Hearing the routine go wrong is faster than reading that it did.
  tap(kind: string, cam?: number) {
    // A property key is a string, so an absent camera reads the key 'undefined', which has no pitch.
    const f = kind === 'cam' ? (({ 10: 660, 4: 740, 7: 830, 11: 560 } as Readonly<Record<string, number>>)[String(cam)] || 700)
      : kind === 'light' ? 990
      : kind === 'mask' ? 440
      : kind === 'monitor' ? 350
      : kind === 'wind' ? 520 : 700;
    this.tone(f, this.t, 0.028, 0.10, 'square');
  }

  judge(grade: string) {
    const t = this.t;
    if (grade === 'good') { this.tone(1320, t, 0.045, 0.13, 'triangle'); return; }
    if (grade === 'ok') { this.tone(880, t, 0.05, 0.11, 'triangle'); return; }
    this.noise(t, 0.11, 0.3, 150, 0.7);
    this.tone(160, t, 0.1, 0.16, 'sawtooth');
  }

  // Milestones climb, so a long combo audibly builds.
  milestone(n: number) {
    const t = this.t;
    const base = 520 + Math.min(6, n / 10) * 90;
    [0, 1, 2].forEach(i => this.tone(base * (1 + i * 0.26), t + i * 0.06, 0.1, 0.16, 'triangle'));
  }

  // A quiet click on every anchor: the 5-second pulse, always there to lock on to.
  anchorTick(strong: boolean) {
    this.tone(strong ? 1500 : 1000, this.t, 0.022, strong ? 0.13 : 0.06, 'square');
  }

  boxTick() { if (!this.play('boxTick', 0.5)) this.tone(1800, this.t, 0.012, 0.05, 'square'); }
  metronome(strong: boolean) { this.tone(strong ? 1400 : 900, this.t, 0.03, strong ? 0.2 : 0.1, 'square'); }
  good() { this.tone(1250, this.t, 0.035, 0.09, 'triangle'); }
  bad() { this.noise(this.t, 0.09, 0.28, 180, 0.8); }
  gfAppear() { if (!this.play('gf')) this.tone(72, this.t, 0.7, 0.2, 'sawtooth'); }
  death() {
    if (!this.ready) return;
    const t = this.t;
    this.noise(t, 0.85, 0.6, 500, 0.4);
    this.tone(80, t, 0.85, 0.3, 'sawtooth');
  }
  win() {
    const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.13, 0.3, 0.2, 'triangle'));
  }

  // Foxy's hall presence hum: the cue that tells you he is actually there.
  ambience(on: boolean) {
    if (!this.ready || !this.enabled) { return; }
    if (on && this.samples.ambience && !this.ambNodes) {
      const src = this.live.createBufferSource();
      src.buffer = this.samples.ambience; src.loop = true;
      const g = this.live.createGain(); g.gain.value = 0.0001;
      src.connect(g); g.connect(this.master);
      src.start(); g.gain.exponentialRampToValueAtTime(0.5, this.t + 0.4);
      this.ambNodes = { o: src, o2: null, g };
      return;
    }
    if (on && !this.ambNodes) {
      const o = this.live.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58;
      const o2 = this.live.createOscillator(); o2.type = 'sine'; o2.frequency.value = 87;
      const f = this.live.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
      const g = this.live.createGain(); g.gain.value = 0.0001;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o.start(); o2.start();
      g.gain.exponentialRampToValueAtTime(0.07, this.t + 0.4);
      this.ambNodes = { o, o2, g };
    } else if (!on && this.ambNodes) {
      const { o, o2, g } = this.ambNodes;
      g.gain.exponentialRampToValueAtTime(0.0001, this.t + 0.3);
      o.stop(this.t + 0.4); o2?.stop(this.t + 0.4);
      this.ambNodes = null;
    }
  }
}
