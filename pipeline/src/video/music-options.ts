import { createHash } from "node:crypto";
import { z } from "zod";

/** Original synthesized scores. No recordings, samples, or external services. */
export const musicOptions = [
  { id: "sunlit-chimes", name: "Sunlit Chimes", description: "Warm, bright bells with an easy, floating melody.", bpm: 76, root: 60, pattern: [0, 7, 12, 4, 9, 7, 16, 12], step: 1, bell: 0.8, pulse: 0.15 },
  { id: "soft-orbit", name: "Soft Orbit", description: "A gentle electronic pulse, warm bass, and chiming arpeggios.", bpm: 84, root: 57, pattern: [0, 7, 12, 16, 12, 7, 19, 16], step: 0.5, bell: 0.45, pulse: 0.5 },
  { id: "glass-garden", name: "Glass Garden", description: "Playful, sparkling chimes with light rhythmic movement.", bpm: 92, root: 62, pattern: [12, 7, 16, 9, 19, 12, 7, 4], step: 0.75, bell: 1, pulse: 0.3 },
  { id: "tidal-glow", name: "Tidal Glow", description: "Spacious, cinematic swells with slow, resonant bells.", bpm: 68, root: 55, pattern: [12, 19, 16, 7, 21, 16, 12, 7], step: 1.5, bell: 0.7, pulse: 0 },
  { id: "night-bloom", name: "Night Bloom", description: "Mellow bass, soft syncopation, and rounded bell phrases.", bpm: 80, root: 60, pattern: [9, 7, 4, 12, 7, 16, 12, 4], step: 0.75, bell: 0.25, pulse: 0.65 },
] as const;
export type MusicOption = typeof musicOptions[number];
export const soundtrackSchema = z.enum(musicOptions.map((option) => option.id));
export type Soundtrack = MusicOption["id"];

/** Pseudorandom per world, stable across retries and independent of the camera seed. */
export function selectSoundtrack(editionId: string, worldSha256: string): Soundtrack {
  const hash = createHash("sha256").update(`soundtrack-v1:${editionId}:${worldSha256}`).digest();
  return musicOptions[hash.readUInt32BE(0) % musicOptions.length].id;
}

export function soundtrackWav(id: Soundtrack, seconds = 10): Buffer {
  const option = musicOptions.find((candidate) => candidate.id === id);
  if (!option) throw new Error("Unknown video soundtrack");
  return musicOptionWav(option, seconds);
}

export function musicOptionWav(option: MusicOption, seconds = 20): Buffer {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error("Audition duration must be 1–60 seconds");
  const rate = 48000, count = Math.round(seconds * rate);
  const left = new Float32Array(count), right = new Float32Array(count);
  const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const beat = 60 / option.bpm;
  const tau = 2 * Math.PI;
  // Overlapping major/add9 voicings with a slow harmonic change halfway through.
  for (let chord = 0; chord < Math.ceil(seconds / (beat * 8)); chord++) {
    const start = chord * beat * 8;
    const notes = chord % 2 ? [5, 9, 12, 19] : [0, 4, 7, 14];
    for (const [voice, note] of notes.entries()) {
      const hz = frequency(option.root - 12 + note);
      for (let i = Math.round(start * rate); i < Math.min(count, (start + beat * 10) * rate); i++) {
        const t = i / rate - start;
        const envelope = Math.min(1, t / 1.5) * Math.min(1, Math.max(0, (beat * 10 - t) / (beat * 2)));
        const tone = Math.sin(tau * hz * t + 0.12 * Math.sin(tau * 0.16 * t)) * 0.018;
        left[i] += tone * envelope * (voice % 2 ? 0.7 : 1);
        right[i] += Math.sin(tau * hz * 1.0007 * t) * 0.018 * envelope * (voice % 2 ? 1 : 0.7);
      }
    }
  }
  // Bell phrases: softened attack, decaying overtones, alternating stereo position.
  let event = 0;
  for (let start = 0.4; start < seconds - 1; start += beat * option.step, event++) {
    const note = option.pattern[event % option.pattern.length];
    const hz = frequency(option.root + note);
    const pan = 0.5 + 0.32 * Math.sin(event * 2.4);
    const accent = event % 4 === 0 ? 1 : 0.65;
    for (let i = Math.round(start * rate); i < Math.min(count, (start + 3.5) * rate); i++) {
      const t = i / rate - start;
      const attack = 1 - Math.exp(-t * 65);
      const tone = (Math.sin(tau * hz * t) * Math.exp(-t * 1.45)
        + option.bell * 0.35 * Math.sin(tau * hz * 2.005 * t) * Math.exp(-t * 3)
        + option.bell * 0.12 * Math.sin(tau * hz * 3.98 * t) * Math.exp(-t * 5)) * attack * accent * 0.09;
      left[i] += tone * Math.sqrt(1 - pan);
      right[i] += tone * Math.sqrt(pan);
    }
  }
  // A quiet rounded pulse beneath the melody, never a sharp click or loud drum.
  for (let start = 0; start < seconds; start += beat * 2) {
    for (let i = Math.round(start * rate); i < Math.min(count, (start + 0.6) * rate); i++) {
      const t = i / rate - start;
      const pulse = Math.sin(tau * frequency(option.root - 24) * t) * (1 - Math.exp(-t * 90)) * Math.exp(-t * 9) * 0.09 * option.pulse;
      left[i] += pulse; right[i] += pulse;
    }
  }
  // Cross-channel taps give the chimes space without a sampled reverb tail.
  for (let i = 0; i < count; i++) {
    const a = i - Math.round(beat * 0.75 * rate), b = i - Math.round(beat * 1.25 * rate);
    if (a >= 0) left[i] += right[a] * 0.16;
    if (b >= 0) right[i] += left[b] * 0.13;
  }
  let square = 0, peak = 0;
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / rate / 0.8, (seconds - i / rate) / 1.8);
    left[i] *= fade; right[i] *= fade;
    square += left[i] ** 2 + right[i] ** 2;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const gain = Math.min(0.075 / Math.sqrt(square / (count * 2)), 0.65 / Math.max(peak, 0.001));
  const wav = Buffer.alloc(44 + count * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) {
    wav.writeInt16LE(Math.round(left[i] * gain * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(right[i] * gain * 32767), 46 + i * 4);
  }
  return wav;
}
