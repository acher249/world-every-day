import assert from "node:assert/strict";
import { test } from "node:test";
import { WorldAudio } from "../lib/world-audio";

class FakeParam {
  value = 0;
  targets: number[] = [];
  setValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
  setTargetAtTime(value: number) { this.targets.push(value); this.value = value; }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  connect() { return this; }
  start() {}
  stop() {}
}

class FakeAudioContext {
  static latest: FakeAudioContext;
  currentTime = 0;
  sampleRate = 16;
  state = "suspended";
  destination = new FakeNode();
  oscillators = 0;
  gains: FakeNode[] = [];

  constructor() { FakeAudioContext.latest = this; }
  createGain() { const node = new FakeNode(); this.gains.push(node); return node; }
  createOscillator() { this.oscillators++; return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
}

test("first interaction fades in ambience without a tap effect", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext } as unknown as Window & typeof globalThis;
  const audio = new WorldAudio();

  try {
    assert.equal(await audio.enable(), true);
    const context = FakeAudioContext.latest;
    const initialOscillators = context.oscillators;
    assert.ok(context.gains[0].gain.targets.includes(1));

    audio.play("tap"); // A button's click handler may run after the enabling pointer event.
    assert.equal(context.oscillators, initialOscillators);

    context.currentTime = 1.5;
    audio.play("tap");
    assert.equal(context.oscillators, initialOscillators + 1);
  } finally {
    audio.dispose();
    globalThis.window = previousWindow;
  }
});
