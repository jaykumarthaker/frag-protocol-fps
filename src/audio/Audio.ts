import * as THREE from 'three';

/**
 * Procedural audio — every sound effect is synthesised at runtime with the
 * Web Audio API, so the game ships with zero downloaded audio assets.
 * The announcer uses the browser's built-in SpeechSynthesis.
 *
 * The synth style targets the meat of late-90s/early-00s arena shooters
 * (UT2003 in particular): crisp electric transients, heavy sub-bass on
 * launches and explosions, and a short arena reverb tail so impacts ring
 * out instead of dying on the dry signal.
 *
 * Positional audio is approximated: a sound played at a world position is
 * attenuated by distance and panned left/right relative to the camera.
 */
export class Audio {
  private ctx: AudioContext;
  private master: GainNode;
  private muffler: BiquadFilterNode;
  private reverb: ConvolverNode;
  private reverbSend: GainNode;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private lastAnnounce = 0;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.muffler = this.ctx.createBiquadFilter();
    this.muffler.type = 'lowpass';
    this.muffler.frequency.value = 22000;
    this.muffler.connect(this.master);
    this.master.connect(this.ctx.destination);

    // Short arena reverb so weapon impacts and explosions ring in the room.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.buildArenaIR(1.4, 2.2);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverb.connect(this.reverbSend);
    this.reverbSend.connect(this.muffler);

    this.pickVoice();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  /** A noise-decay impulse response — cheap concrete-arena reverb. */
  private buildArenaIR(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Slight early-reflection bump in the first 60ms gives it that
        // big-room slap-back without an explicit delay tap.
        const early = i < rate * 0.06 ? 0.7 + Math.random() * 0.3 : 1;
        data[i] = (Math.random() * 2 - 1) * early * Math.pow(1 - t, decay);
      }
    }
    return buf;
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

  /**
   * Route a node chain through a per-sound gain + panner, then to master.
   * `wet` controls how much of the signal also bleeds into the arena reverb
   * (0 = bone-dry, 1 = soaked).
   */
  private out(volume: number, pos?: THREE.Vector3, wet = 0.25): GainNode {
    const { gain, pan } = this.spatial(pos);
    const g = this.ctx.createGain();
    g.gain.value = volume * gain;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    g.connect(panner);
    panner.connect(this.muffler);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet * gain;
      panner.connect(send);
      send.connect(this.reverb);
    }
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
      case 'rocketload': this.rocketLoad(t, pos); break;
      case 'shard':   this.shardShot(t, pos); break;
      case 'rocket':  this.rocketShot(t, pos); break;
      case 'pulse':   this.pulseShot(t, pos); break;
      case 'orb':     this.orbShot(t, pos); break;
      case 'explosion': this.explosion(t, pos); break;
      case 'combo':     this.combo(t, pos); break;
      case 'hit':       this.hitImpact(t, pos); break;
      case 'hitmarker': this.hitmarker(t); break;
      case 'jumppad':   this.jumpPad(t, pos); break;
      case 'pickup':    this.pickup(t, pos); break;
      case 'pickupbig': this.pickupBig(t, pos); break;
      case 'jump':      this.jumpGrunt(t, pos); break;
      case 'dodge':     this.dodge(t, pos); break;
      case 'spawn':     this.spawn(t, pos); break;
      case 'die':       this.die(t, pos); break;
    }
  }

  // ---- generic voices -----------------------------------------------

  /** A single oscillator voice with a pitch glide + decay (optional attack). */
  private oscVoice(
    t: number, pos: THREE.Vector3 | undefined,
    type: OscillatorType, f0: number, f1: number,
    vol: number, dur: number, attack = 0, wet = 0.25,
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.out(vol, pos, wet);
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
    q: number, vol: number, dur: number, wet = 0.25,
  ) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    filt.Q.value = q;
    const g = this.out(vol, pos, wet);
    g.gain.setValueAtTime(Math.max(0.0009, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt);
    filt.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /**
   * A waveshaped/distorted oscillator voice — adds grit on top of a tone
   * so weapon transients punch through instead of sitting in the mix.
   */
  private gritVoice(
    t: number, pos: THREE.Vector3 | undefined,
    type: OscillatorType, f0: number, f1: number,
    vol: number, dur: number, drive = 8, wet = 0.25,
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.distortionCurve(drive);
    shaper.oversample = '2x';
    const g = this.out(vol, pos, wet);
    g.gain.setValueAtTime(Math.max(0.0009, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(shaper);
    shaper.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private distortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ---- impacts / feedback ------------------------------------------

  /** Body impact — wet flesh thump + a high-mid crack. UT-style "frag" hit. */
  private hitImpact(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 220, 70, 0.5, 0.12, 0, 0.35);
    this.noiseVoice(t, pos, 'bandpass', 1800, 700, 1.8, 0.32, 0.07, 0.3);
    this.noiseVoice(t, pos, 'highpass', 5200, 4200, 0.6, 0.18, 0.04, 0.1);
  }

  /**
   * Hitmarker — a short, dry click confirming the hit. No bell, no bong:
   * a quick noise transient with a low-mid tap underneath so it sits in
   * the headphones like a "tok" rather than a chime.
   */
  private hitmarker(t: number) {
    this.noiseVoice(t, undefined, 'bandpass', 1800, 1200, 3.5, 0.32, 0.035, 0);
    this.oscVoice(t, undefined, 'sine', 520, 280, 0.22, 0.05, 0, 0);
  }

  /** Big arena explosion — sub-bass punch, debris noise, metallic shrapnel. */
  private explosion(t: number, pos: THREE.Vector3 | undefined, scale = 1) {
    // Sub-bass thump that does the work in the chest.
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.45 * scale);
    const sg = this.out(0.85 * scale, pos, 0.5);
    sg.gain.setValueAtTime(sg.gain.value, t);
    sg.gain.exponentialRampToValueAtTime(0.0008, t + 0.5 * scale);
    sub.connect(sg);
    sub.start(t);
    sub.stop(t + 0.55 * scale);

    // Distorted body so the boom has grit, not just noise.
    const body = this.ctx.createBufferSource();
    body.buffer = this.noiseBuffer(0.65 * scale);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2400, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + 0.55 * scale);
    filt.Q.value = 1.4;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.distortionCurve(6);
    shaper.oversample = '2x';
    const bg = this.out(0.6 * scale, pos, 0.55);
    bg.gain.setValueAtTime(bg.gain.value, t);
    bg.gain.exponentialRampToValueAtTime(0.0008, t + 0.6 * scale);
    body.connect(filt);
    filt.connect(shaper);
    shaper.connect(bg);
    body.start(t);
    body.stop(t + 0.65 * scale);

    // Bright initial crack so the transient cuts through.
    this.noiseVoice(t, pos, 'highpass', 4800, 1600, 0.7, 0.35 * scale, 0.09, 0.25);

    // Shrapnel pings tailing off.
    for (let i = 0; i < 3; i++) {
      const dt = 0.05 + i * 0.04;
      this.oscVoice(t + dt, pos, 'triangle', 1800 + Math.random() * 1200, 600, 0.08 * scale, 0.09, 0, 0.4);
    }
  }

  // ---- weapon synths -------------------------------------------------

  /**
   * Railgun / Shock Rifle — a violent electric crack, a screaming zap glide,
   * and a sub-bass thunder slap. The signature UT2003 shock crack.
   */
  private railShot(t: number, pos?: THREE.Vector3) {
    // Electric crack transient.
    this.noiseVoice(t, pos, 'highpass', 5200, 1800, 0.9, 0.55, 0.09, 0.4);
    // Hot sawtooth zap with grit — the "energy" of the beam.
    this.gritVoice(t, pos, 'sawtooth', 3000, 280, 0.42, 0.22, 9, 0.35);
    // Sub-bass thunder slap.
    this.oscVoice(t + 0.012, pos, 'sine', 180, 38, 0.7, 0.55, 0.005, 0.55);
    // High shimmer tail.
    this.oscVoice(t + 0.02, pos, 'triangle', 4200, 2200, 0.12, 0.35, 0, 0.5);
  }

  /** Railgun wind-up — a tightening electrical whine with bit-crush edge. */
  private railCharge(t: number, pos?: THREE.Vector3) {
    this.gritVoice(t, pos, 'sawtooth', 180, 1700, 0.22, 0.18, 7, 0.2);
    this.oscVoice(t, pos, 'sine', 440, 2600, 0.14, 0.18, 0.04, 0.2);
    this.oscVoice(t, pos, 'square', 90, 220, 0.08, 0.18, 0.02, 0.2);
  }

  /** Rocket Launcher reload — a chunky mechanical clack + magazine click. */
  private rocketLoad(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'square', 320, 110, 0.25, 0.04, 0, 0.15);
    this.noiseVoice(t + 0.008, pos, 'bandpass', 2400, 1400, 4, 0.18, 0.05, 0.2);
    this.oscVoice(t + 0.06, pos, 'square', 220, 120, 0.18, 0.04, 0, 0.15);
  }

  /**
   * Flak / Shard Cannon — a mechanical KA-CHUNK, an explosive burst of
   * shrapnel, and a brassy resonant tail.
   */
  private shardShot(t: number, pos?: THREE.Vector3) {
    // Hard chamber thunk.
    this.oscVoice(t, pos, 'square', 240, 55, 0.5, 0.09, 0, 0.3);
    this.oscVoice(t, pos, 'sine', 110, 40, 0.55, 0.18, 0, 0.4);
    // Gritty burst — the shrapnel scatter.
    this.gritVoice(t + 0.005, pos, 'sawtooth', 900, 220, 0.32, 0.14, 10, 0.4);
    this.noiseVoice(t, pos, 'bandpass', 1500, 600, 1.2, 0.55, 0.14, 0.45);
    // Brassy metallic shimmer of the shards spraying out.
    for (let i = 0; i < 4; i++) {
      this.oscVoice(t + i * 0.012, pos, 'triangle', 2600 + i * 320, 1500, 0.09, 0.07, 0, 0.35);
    }
  }

  /**
   * Rocket Launcher — deep launch WHOOOMP, ignition crackle, hissing fuse
   * trail. The kind of fire that makes you brace for the explosion.
   */
  private rocketShot(t: number, pos?: THREE.Vector3) {
    // Sub-bass launch — bigger, lower, fatter than the old version.
    this.oscVoice(t, pos, 'sine', 220, 40, 0.85, 0.45, 0.008, 0.45);
    this.oscVoice(t, pos, 'sawtooth', 260, 80, 0.28, 0.32, 0.012, 0.35);
    // Ignition crackle — bright transient on top.
    this.noiseVoice(t, pos, 'highpass', 3200, 1800, 0.7, 0.38, 0.09, 0.3);
    // Long mid-noise whoosh — the rocket leaving the tube.
    this.noiseVoice(t + 0.01, pos, 'bandpass', 1100, 380, 0.9, 0.5, 0.42, 0.4);
  }

  /** Pulse / Link Rifle — fast, bright, electric stutter (fires rapidly). */
  private pulseShot(t: number, pos?: THREE.Vector3) {
    this.gritVoice(t, pos, 'sawtooth', 1500, 380, 0.32, 0.08, 8, 0.2);
    this.oscVoice(t, pos, 'square', 3000, 1700, 0.12, 0.05, 0, 0.15);
    this.noiseVoice(t, pos, 'highpass', 4200, 2400, 0.6, 0.12, 0.04, 0.15);
  }

  /** Pulse Rifle secondary — wobbling energy-orb launch, deep & ominous. */
  private orbShot(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 560, 140, 0.45, 0.28, 0.02, 0.4);
    this.gritVoice(t, pos, 'sawtooth', 280, 100, 0.22, 0.26, 5, 0.35);
    this.oscVoice(t, pos, 'sine', 140, 70, 0.32, 0.3, 0.03, 0.5);
    // Slight LFO-style wobble via two close detuned sines.
    this.oscVoice(t + 0.01, pos, 'sine', 312, 132, 0.16, 0.26, 0.02, 0.3);
  }

  /** Pulse combo detonation — huge blast plus a screaming electric arc. */
  private combo(t: number, pos?: THREE.Vector3) {
    this.explosion(t, pos, 1.8);
    this.gritVoice(t, pos, 'sawtooth', 3400, 380, 0.42, 0.28, 11, 0.5);
    this.noiseVoice(t, pos, 'highpass', 3600, 1500, 0.7, 0.38, 0.22, 0.55);
    this.oscVoice(t + 0.04, pos, 'triangle', 5200, 2400, 0.14, 0.35, 0, 0.5);
  }

  // ---- player feedback --------------------------------------------

  /**
   * Death — a meaty body slam, an electric short, and a low descending tone.
   * UT2003's deaths were *short and brutal*, not whiny chirps.
   */
  private die(t: number, pos?: THREE.Vector3) {
    // Body thump.
    this.oscVoice(t, pos, 'sine', 160, 40, 0.7, 0.35, 0, 0.55);
    // Crunchy noise — the shield/flesh giving way.
    this.noiseVoice(t, pos, 'lowpass', 1600, 220, 1.2, 0.55, 0.25, 0.5);
    // Electric short circuit.
    this.gritVoice(t + 0.01, pos, 'sawtooth', 900, 90, 0.3, 0.32, 7, 0.4);
    // Dying tone falling away.
    this.oscVoice(t + 0.04, pos, 'triangle', 480, 110, 0.18, 0.4, 0, 0.45);
  }

  /** Pickup — a quick metallic chime, two stacked partials. */
  private pickup(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'triangle', 980, 1480, 0.28, 0.12, 0, 0.3);
    this.oscVoice(t + 0.02, pos, 'sine', 1960, 2640, 0.18, 0.10, 0, 0.25);
    this.noiseVoice(t, pos, 'highpass', 5200, 4200, 0.5, 0.08, 0.04, 0.15);
  }

  /** Big pickup (armor / powerup) — a triumphant ascending power-up flare. */
  private pickupBig(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 320, 1200, 0.32, 0.35, 0.04, 0.45);
    this.oscVoice(t + 0.05, pos, 'triangle', 640, 1800, 0.22, 0.4, 0.04, 0.4);
    this.oscVoice(t + 0.1, pos, 'triangle', 960, 2400, 0.16, 0.4, 0.04, 0.4);
    this.noiseVoice(t, pos, 'bandpass', 2400, 4200, 1.2, 0.14, 0.3, 0.3);
  }

  /** Jump pad — a satisfying upward whoosh with an air pulse. */
  private jumpPad(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 180, 1400, 0.4, 0.4, 0.02, 0.45);
    this.noiseVoice(t, pos, 'bandpass', 600, 3200, 0.9, 0.32, 0.38, 0.4);
    this.oscVoice(t, pos, 'triangle', 360, 1800, 0.18, 0.4, 0.03, 0.35);
  }

  /** Footstep jump — a soft, breathy effort grunt rather than a beep. */
  private jumpGrunt(t: number, pos?: THREE.Vector3) {
    this.noiseVoice(t, pos, 'bandpass', 800, 380, 2.5, 0.18, 0.12, 0.1);
    this.oscVoice(t, pos, 'sine', 220, 140, 0.1, 0.1, 0.01, 0.1);
  }

  /** Dodge — short whip-like air-snap. */
  private dodge(t: number, pos?: THREE.Vector3) {
    this.noiseVoice(t, pos, 'bandpass', 3200, 900, 2.0, 0.28, 0.14, 0.2);
    this.oscVoice(t, pos, 'sine', 260, 120, 0.1, 0.1, 0.01, 0.1);
  }

  /** Spawn / teleport — shimmering descending zap. */
  private spawn(t: number, pos?: THREE.Vector3) {
    this.oscVoice(t, pos, 'sine', 1800, 320, 0.32, 0.32, 0.02, 0.45);
    this.gritVoice(t, pos, 'sawtooth', 1400, 220, 0.18, 0.3, 5, 0.4);
    this.noiseVoice(t, pos, 'bandpass', 3600, 1200, 1.4, 0.22, 0.28, 0.45);
    this.oscVoice(t + 0.04, pos, 'triangle', 2400, 600, 0.14, 0.3, 0, 0.4);
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
    // Slower + lower than default for the deep tournament-announcer feel.
    u.rate = 0.88;
    u.pitch = 0.45;
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
