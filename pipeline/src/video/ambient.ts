/** Original procedural music: the viewer's C-add9 pad and soft sine accent. */
export function ambientWav(seed: number, seconds = 10): Buffer {
  const rate = 48000, samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 4);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 4, 40);
  let state = seed >>> 0, wind = 0;
  const notes = [130.81, 164.81, 196, 293.66];
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    wind += 0.06 * ((state / 4294967296 * 2 - 1) - wind);
    const fade = Math.min(1, t / 1.5, (seconds - t) / 1.5);
    let value = wind * 0.018;
    for (let n = 0; n < notes.length; n++) {
      const phase = Math.PI * 2 * notes[n] * t;
      const tone = n === 0 ? Math.asin(Math.sin(phase)) * 2 / Math.PI : Math.sin(phase);
      value += tone * (n === 0 ? 0.007 : 0.005) * 1.3;
    }
    const accent = t - 5.2;
    if (accent >= 0 && accent < 3.5) value += Math.sin(Math.PI * 2 * 392 * accent) * 0.0117 * Math.min(1, accent / 0.18) * Math.exp(-Math.max(0, accent - 0.18) / 0.8);
    const pcm = Math.round(Math.max(-1, Math.min(1, value * fade * 2)) * 32767);
    buffer.writeInt16LE(pcm, 44 + i * 4); buffer.writeInt16LE(pcm, 46 + i * 4);
  }
  return buffer;
}
