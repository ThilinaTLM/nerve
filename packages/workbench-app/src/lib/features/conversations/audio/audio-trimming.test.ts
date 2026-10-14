import assert from "node:assert/strict";
import { test } from "node:test";
import {
  trimAudioActivity,
  AUDIO_ACTIVITY_THRESHOLD_DBFS,
} from "./audio-trimming";

const RATE = 16_000;
const count = (ms: number) => Math.round((ms * RATE) / 1000);
function capture(...segments: [number, number][]): Float32Array {
  const samples = new Float32Array(
    segments.reduce((n, [ms]) => n + count(ms), 0),
  );
  let offset = 0;
  for (const [ms, amplitude] of segments) {
    samples.fill(amplitude, offset, offset + count(ms));
    offset += count(ms);
  }
  return samples;
}

test("empty, silence and isolated short runs have no retained activity", () => {
  for (const samples of [
    new Float32Array(),
    capture([1000, 0]),
    capture([40, 1], [100, 0], [59, 1]),
  ]) {
    assert.deepEqual(trimAudioActivity(samples, RATE), {
      status: "skipped",
      reason: "no-activity",
    });
  }
});

test("trims outer silence with 200ms padding, preserving internal pauses and samples", () => {
  const samples = capture(
    [600, 0],
    [160, 0.1],
    [1000, 0],
    [140, -0.2],
    [800, 0],
  );
  const result = trimAudioActivity(samples, RATE);
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.deepEqual(result.samples, samples.slice(count(400), count(2100)));
  assert.equal(result.samples[count(400)], 0);
});

test("padding is bounded at capture edges", () => {
  for (const samples of [
    capture([300, 0.1]),
    capture([100, 0], [300, 0.1]),
    capture([300, 0.1], [100, 0]),
  ]) {
    const result = trimAudioActivity(samples, RATE);
    assert.equal(result.status, "accepted");
    if (result.status === "accepted") assert.deepEqual(result.samples, samples);
  }
});

test("eligibility uses actual active samples, including final partial windows", () => {
  for (const ms of [299, 300, 301]) {
    const result = trimAudioActivity(capture([ms, 0.1]), RATE);
    assert.equal(result.status, ms < 300 ? "skipped" : "accepted");
    if (result.status === "skipped") assert.equal(result.reason, "too-short");
    else assert.equal(result.samples.length, count(ms));
  }
  // Partial window RMS must use its actual length, not a full 20ms divisor.
  const threshold = 10 ** (AUDIO_ACTIVITY_THRESHOLD_DBFS / 20);
  assert.equal(
    trimAudioActivity(capture([301, threshold * 1.01]), RATE).status,
    "accepted",
  );
});

test("padding, gaps and discarded runs do not count toward the 300ms minimum", () => {
  for (const samples of [
    capture([500, 0], [280, 0.1], [500, 0]),
    capture([140, 0.1], [1000, 0], [140, 0.1]),
    capture([280, 0.1], [100, 0], [40, 1]),
  ]) {
    assert.deepEqual(trimAudioActivity(samples, RATE), {
      status: "skipped",
      reason: "too-short",
    });
  }
});

test("60ms runs qualify and shorter runs are ignored by their actual length", () => {
  const samples = capture([60, 0.1], [100, 0], [240, 0.1]);
  assert.equal(trimAudioActivity(samples, RATE).status, "accepted");
  assert.deepEqual(trimAudioActivity(capture([59, 0.1]), RATE), {
    status: "skipped",
    reason: "no-activity",
  });
});

test("quiet activity threshold is -45 dBFS RMS, not peak amplitude", () => {
  const threshold = 10 ** (AUDIO_ACTIVITY_THRESHOLD_DBFS / 20);
  assert.deepEqual(trimAudioActivity(capture([400, threshold * 0.99]), RATE), {
    status: "skipped",
    reason: "no-activity",
  });
  assert.equal(
    trimAudioActivity(capture([400, threshold * 1.01]), RATE).status,
    "accepted",
  );
  const spike = capture([400, 0]);
  spike[0] = 1;
  assert.deepEqual(trimAudioActivity(spike, RATE), {
    status: "skipped",
    reason: "no-activity",
  });
});
