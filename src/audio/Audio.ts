import * as THREE from 'three';

/**
 * Procedural audio — every sound effect is synthesised at runtime with the
 * Web Audio API, so the game ships with zero downloaded audio assets.
 * The announcer uses the browser's built-in SpeechSynthesis.
 *
 * Positional audio is approximated: a sound played at a world position is
 * attenuated by distance and panned left/right relative to the camera.
 */
export class Audio {
  private ctx: AudioContext;
  private master: GainNode;
  private muffler: BiquadFilterNode;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private lastAnnounce = 0;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.muffler = this.ctx.createBiquadFilter();
    this.muffler.type = 'lowpass';
    this.muffler.frequency.value = 22000;
    this.muffler.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.pickVoice();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  private pickVoice() {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    // Prefer a deep English male voice for the tournament announcer feel.
    this.voice =
      voices.find((v) => /en.*(david|daniel|google uk english male)/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0] ?? null;
  }

  /** Must be called from a user gesture (click) to satisfy autoplay policy. */
  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMasterVolume(v: number) { this.master.gain.value = v; }
  setEnabled(on: boolean) { this.enabled = on; }

  /** Low-pass the whole mix while paused / dead, for a "muffled" feel. */
  setMuffled(muffled: boolean) {
    this.muffler.frequency.setTargetAtTime(muffled ? 600 : 22000, this.ctx.currentTime, 0.05);
  }

  updateListener(pos: THREE.Vector3, forward: THREE.Vector3) {
    this.listenerPos.copy(pos);
    this.listenerRight.set(forward.z, 0, -forward.x).normalize();
  }

  private spatial(pos: THREE.Vector3 | undefined): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const dist = this.listenerPos.distanceTo(pos);
    const gain = Math.max(0, 1 - dist / 90) ** 1.5;
    const toSrc = pos.clone().sub(this.listenerPos).normalize();
    const pan = THREE.MathUtils.clamp(toSrc.dot(this.listenerRight), -1, 1);
    return { gain, pan };
  }

  /** Route a node chain through a per-sound gain + panner, then to master. */
  private out(volume: number, pos?: THREE.Vector3): GainNode {
    const { gain, pan } = this.spatial(pos);
    const g = this.ctx.createGain();
    g.gain.value = volume * gain;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    g.connect(panner);
    panner.connect(this.muffler);
    return g;
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---- effect synths -------------------------------------------------

  play(name: SfxName, pos?: THREE.Vector3) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'railgun': this.railShot(t, pos); break;
      case 'railcharge': this.railCharge(t, pos); break;
      case 'rocketload': this.beepShot(t, pos, 220, 90, 0.07, 0.24); break;
      case 'shard':   this.shardShot(t, pos); break;
      case 'rocket':  this.rocketShot(t, pos); break;
      case 'pulse':   this.pulseShot(t, pos); break;
      case 'orb':     this.orbShot(t, pos); break;
      case 'explosion': this.explosion(t, pos); break;
      case 'combo':     this.combo(t, pos); break;
      case 'hit':       this.beepShot(t, pos, 1100, 1100, 0.05, 0.25); break;
      case 'hitmarker': this.beepShot(t, undefined, 2000, 1700, 0.04, 0.3); break;
      case 'jumppad':   this.sweep(t, pos, 200, 1200, 0.35, 0.4); break;
      case 'pickup':    this.beepShot(t, pos, 700, 1500, 0.14, 0.35); break;
      case 'pickupbig': this.sweep(t, pos, 400, 1600, 0.4, 0.45); break;
      case 'jump':      this.beepShot(t, pos, 380, 520, 0.08, 0.18); break;
      case 'dodge':     this.noiseShot(t, pos, 0.12, 2600, 0.22); break;
      case 'spawn':     this.sweep(t, undefined, 1400, 300, 0.3, 0.3); break;
      case 'die':       this.sweep(t, pos, 600, 90, 0.5, 0.4); break;
    }
  }

  private beepShot(t: number, pos: THREE.Vector3 | undefined, f0: number, f1: number, dur: number, vol: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.out(vol, pos);
    g.gain.setValueAtTime(vol * (g.gain.value / vol || 1), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseShot(t: number, pos: THREE.Vector3 | undefined, dur: number, cutoff: number, vol: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = cutoff;
    filt.Q.value = 1.2;
    const g = this.out(vol, pos);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt);
    filt.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private sweep(t: number, pos: THREE.Vector3 | undefined, f0: number, f1: number, dur: number, vol: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.out(vol, pos);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.exponentialRampToValueAtTime(g.gain.value || vol, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private explosion(t: number, pos: THREE.Vector3 | undefined, scale = 1) {
    // Noise body.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.6 * scale);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1800, t);
    filt.frequency.exponentialRampToValueAtTime(120, t + 0.5 * scale);
    const g = this.out(0.7 * scale, pos);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55 * scale);
    src.connect(filt);
    filt.connect(g);
    src.start(t);
    src.stop(t + 0.62 * scale);
    // Low thump.
    const thump = this.ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(140, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const tg = this.out(0.6 * scale, pos);
    tg.gain.setValueAtTime(tg.gain.value, t);
    tg.gain.exponentialRampToValueAtTime(0.0008, t + 0.35);
    thump.connect(tg);
    thump.start(t);
    thump.stop(t + 0.4);
  }

  // ---- weapon synths -------------------------------------------------

  /** A single oscillator voice with a pitch glide + decay (optional attack). */
  private oscVoice(
    t: number, pos: THREE.Vector3 | undefined,
    type: OscillatorType, f0: number, f1: number,
    vol: number, dur: number, attack = 0,
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.out(vol, pos);
    const peak = Math.max(0.0009, g.gain.value);
    if (attack > 0) {
      g.gain.setValueAtTime(0.0008, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
    } else {
      g.gain.setValueAtTime(peak, t);
    }
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A filtered-noise voice with a swept cutoff. */
  private noiseVoice(
    t: number, pos: THREE.Vector3 | undefined,
    filterType: BiquadFilterType, f0: number, f1: number,
    q: number, vol: number, dur: number,
  ) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    filt.Q.value = q;
    const g = this.out(vol, pos);
    g.gain.setValueAtTime(Math.max(0.0009, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt);
    filt.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Railgun — an electric crack + magnetic zap + a rolling thunder tail. */
  private railShot(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sawtooth', 2600, 220, 0.34, 0.2);          // zap
    this.noiseVoice(t, pos, 'highpass', 2200, 900, 0.7, 0.42, 0.12);  // crack
    this.oscVoice(t + 0.015, pos, 'sine', 170, 44, 0.5, 0.55, 0.03);  // thunder
  }

  /** Railgun wind-up — a rising electrical whine. */
  private railCharge(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sawtooth', 220, 1500, 0.24, 0.14, 0.05);
    this.oscVoice(t, pos, 'sine', 440, 2400, 0.12, 0.14, 0.05);
  }

  /** Shard Cannon — a chunky flak burst with a crystalline shimmer. */
  private shardShot(t: number, pos?: THREE.Vector3) {
    this.noiseVoice(t, pos, 'bandpass', 1100, 700, 1.0, 0.5, 0.13);   // body
    this.oscVoice(t, pos, 'square', 210, 70, 0.34, 0.1);              // thunk
    for (let i = 0; i < 3; i++) {                                    // shimmer
      this.oscVoice(t + i * 0.018, pos, 'triangle', 2800 + i * 240, 1900, 0.1, 0.06);
    }
  }

  /** Rocket Launcher — a deep launch WHOOMP with an ignition whoosh. */
  private rocketShot(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 300, 58, 0.55, 0.36, 0.02);         // whoomp
    this.noiseVoice(t, pos, 'lowpass', 1300, 320, 0.8, 0.4, 0.3);     // whoosh
    this.noiseVoice(t, pos, 'highpass', 2400, 1600, 0.6, 0.24, 0.07); // ignition
  }

  /** Pulse Rifle — a fast, bright plasma bolt (fires many times a second). */
  private pulseShot(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sawtooth', 1350, 430, 0.26, 0.08);
    this.oscVoice(t, pos, 'square', 2700, 1500, 0.08, 0.05);
  }

  /** Pulse Rifle secondary — a deep, wobbling energy-orb launch. */
  private orbShot(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 540, 170, 0.32, 0.24, 0.02);
    this.oscVoice(t, pos, 'sawtooth', 270, 120, 0.16, 0.22);
    this.oscVoice(t, pos, 'sine', 150, 90, 0.2, 0.24, 0.03);
  }

  /** Pulse combo detonation — the big blast plus an electric crack. */
  private combo(t: number, pos?: THREE.Vector3) {
    this.explosion(t, pos, 1.6);
    this.oscVoice(t, pos, 'sawtooth', 3000, 500, 0.3, 0.25);
    this.noiseVoice(t, pos, 'highpass', 3000, 1400, 0.7, 0.3, 0.18);
  }

  // ---- announcer -----------------------------------------------------

  announce(text: string) {
    if (!this.enabled || typeof speechSynthesis === 'undefined') return;
    const now = performance.now();
    if (now - this.lastAnnounce < 350) return; // avoid overlap spam
    this.lastAnnounce = now;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 0.95;
    u.pitch = 0.6;
    u.volume = 1;
    speechSynthesis.speak(u);
  }
}

export type SfxName =
  | 'railgun' | 'railcharge' | 'rocketload'
  | 'shard' | 'rocket' | 'pulse' | 'orb'
  | 'explosion' | 'combo' | 'hit' | 'hitmarker'
  | 'jumppad' | 'pickup' | 'pickupbig' | 'jump' | 'dodge'
  | 'spawn' | 'die';
