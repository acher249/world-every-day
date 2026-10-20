export type WorldSound = "hover" | "tap" | "story" | "travel";

const chords = [
  [130.81, 164.81, 196, 293.66], // C add9
  [110, 164.81, 196, 261.63], // A minor 7
  [87.31, 174.61, 220, 329.63], // F major 7
  [98, 146.83, 196, 246.94], // G major
] as const;

/** Small, asset-free soundscape. Construct only in response to a user gesture. */
export class WorldAudio {
  private context: AudioContext | null = null;
  private ambience: GainNode | null = null;
  private movementGain: GainNode | null = null;
  private movementFilter: BiquadFilterNode | null = null;
  private movementTone: OscillatorNode | null = null;
  private pad: { gain: GainNode; tones: OscillatorNode[] } | null = null;
  private chordTimer: ReturnType<typeof setInterval> | null = null;
  private accentTimer: ReturnType<typeof setInterval> | null = null;
  private chordIndex = 0;
  private accentIndex = 0;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTravelAt = -Infinity;
  private lastHoverAt = -Infinity;
  private effectsReadyAt = Infinity;
  private enabled = false;
  private disposed = false;

  async enable(): Promise<boolean> {
    if (this.disposed || typeof window.AudioContext === "undefined") return false;

    try {
      if (!this.context) this.createSoundscape();
      if (this.suspendTimer) clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
      const context = this.context!;
      await context.resume();
      if (this.disposed) return false;
      this.enabled = context.state === "running";
      if (this.enabled) {
        if (this.effectsReadyAt === Infinity) this.effectsReadyAt = context.currentTime + 1.4;
        this.ambience?.gain.setTargetAtTime(1, context.currentTime, 0.7);
        this.startMusic(context);
      }
      return this.enabled;
    } catch {
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
    this.stopMusicTimers();
    const context = this.context;
    this.movementGain?.gain.setTargetAtTime(0, context?.currentTime ?? 0, 0.08);
    this.ambience?.gain.setTargetAtTime(0, context?.currentTime ?? 0, 0.12);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      if (!this.enabled && context?.state === "running") void context.suspend();
    }, 500);
  }

  play(sound: WorldSound): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== "running" || context.currentTime < this.effectsReadyAt) return;
    if (sound === "hover") {
      if (context.currentTime - this.lastHoverAt < 0.35) return;
      this.lastHoverAt = context.currentTime;
    }
    if (sound === "travel") {
      if (context.currentTime - this.lastTravelAt < 0.14) return;
      this.lastTravelAt = context.currentTime;
      this.playTravel(context);
      return;
    }

    const shape = {
      hover: { from: 790, to: 950, peak: 0.014, duration: 0.11 },
      tap: { from: 720, to: 520, peak: 0.025, duration: 0.2 },
      story: { from: 520, to: 780, peak: 0.055, duration: 0.2 },
    }[sound];
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(shape.from, now);
    oscillator.frequency.exponentialRampToValueAtTime(shape.to, now + shape.duration * 0.8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(shape.peak, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + shape.duration + 0.01);
  }

  setMovement(intensity: number): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== "running") return;
    const level = Math.max(0, Math.min(1, intensity));
    this.movementGain?.gain.setTargetAtTime(level, context.currentTime, level > 0 ? 0.15 : 0.25);
    this.movementFilter?.frequency.setTargetAtTime(220 + level * 350, context.currentTime, 0.15);
    this.movementTone?.frequency.setTargetAtTime(90 + level * 45, context.currentTime, 0.15);
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.stopMusicTimers();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    if (this.context) void this.context.close();
    this.context = null;
    this.ambience = null;
    this.movementGain = null;
    this.movementFilter = null;
    this.movementTone = null;
  }

  private createSoundscape(): void {
    const context = new window.AudioContext();
    this.context = context;
    const ambience = context.createGain();
    ambience.gain.value = 0;
    ambience.connect(context.destination);
    this.ambience = ambience;

    // A quiet, repeating wind texture; tapered ends make the loop seamless.
    const length = context.sampleRate * 4;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const taper = Math.sin(Math.PI * i / length) ** 2;
      samples[i] = (Math.random() * 2 - 1) * taper;
    }
    const wind = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const windGain = context.createGain();
    wind.buffer = buffer;
    wind.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 480;
    windGain.gain.value = 0.018;
    wind.connect(filter).connect(windGain).connect(ambience);
    wind.start();

    const movementGain = context.createGain();
    const movementFilter = context.createBiquadFilter();
    const movementWind = context.createBufferSource();
    const movementWindGain = context.createGain();
    const movementTone = context.createOscillator();
    const movementToneGain = context.createGain();
    movementGain.gain.value = 0;
    movementGain.connect(ambience);
    movementFilter.type = "bandpass";
    movementFilter.frequency.value = 220;
    movementFilter.Q.value = 0.5;
    movementWind.buffer = buffer;
    movementWind.loop = true;
    movementWindGain.gain.value = 0.027;
    movementWind.connect(movementFilter).connect(movementWindGain).connect(movementGain);
    movementWind.start();
    movementTone.type = "sine";
    movementTone.frequency.value = 90;
    movementToneGain.gain.value = 0.014;
    movementTone.connect(movementToneGain).connect(movementGain);
    movementTone.start();
    this.movementGain = movementGain;
    this.movementFilter = movementFilter;
    this.movementTone = movementTone;
  }

  private startMusic(context: AudioContext): void {
    if (!this.pad) this.playNextChord(context);
    if (!this.chordTimer) this.chordTimer = setInterval(() => this.playNextChord(context), 13_000);
    if (!this.accentTimer) this.accentTimer = setInterval(() => this.playAccent(context), 5_200);
  }

  private stopMusicTimers(): void {
    if (this.chordTimer) clearInterval(this.chordTimer);
    if (this.accentTimer) clearInterval(this.accentTimer);
    this.chordTimer = null;
    this.accentTimer = null;
  }

  private playNextChord(context: AudioContext): void {
    if (!this.enabled) return;
    const now = context.currentTime;
    if (this.pad) {
      this.pad.gain.gain.setTargetAtTime(0.0001, now, 0.9);
      for (const tone of this.pad.tones) tone.stop(now + 5);
    }

    const notes = chords[this.chordIndex % chords.length];
    this.chordIndex++;
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.setTargetAtTime(1, now, 1.2);
    filter.type = "lowpass";
    filter.frequency.value = 720;
    gain.connect(filter).connect(this.ambience!);

    const tones = notes.map((frequency, index) => {
      const tone = context.createOscillator();
      const voice = context.createGain();
      tone.type = index === 0 ? "triangle" : "sine";
      tone.frequency.value = frequency;
      voice.gain.value = index === 0 ? 0.007 : 0.005;
      tone.connect(voice).connect(gain);
      tone.start(now);
      return tone;
    });
    this.pad = { gain, tones };
  }

  private playAccent(context: AudioContext): void {
    if (!this.enabled || context.state !== "running") return;
    const notes = chords[(this.chordIndex - 1 + chords.length) % chords.length];
    const frequency = notes[2 + (this.accentIndex++ % 2)] * 2;
    const now = context.currentTime;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.009, now + 0.18);
    gain.gain.setTargetAtTime(0.0001, now + 0.18, 0.8);
    tone.connect(gain).connect(this.ambience!);
    tone.start(now);
    tone.stop(now + 3.5);
  }

  private playTravel(context: AudioContext): void {
    const now = context.currentTime;
    const duration = 0.32;
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;

    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    noise.buffer = buffer;
    filter.type = "bandpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter).connect(gain).connect(context.destination);
    noise.start(now);
    noise.stop(now + duration);
  }
}
