import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodePcm16Wav,
  floatSampleToInt16,
  resampleLinear,
  truncateSamplesForDuration,
  WAV_BITS_PER_SAMPLE,
  WAV_CHANNELS,
  WAV_TARGET_SAMPLE_RATE,
} from "./wav-recorder";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("WAV encoding", () => {
  it("writes a mono 16 kHz 16-bit PCM WAV header", () => {
    const bytes = encodePcm16Wav(new Float32Array(WAV_TARGET_SAMPLE_RATE));
    const view = new DataView(bytes.buffer);

    assert.equal(ascii(bytes, 0, 4), "RIFF");
    assert.equal(ascii(bytes, 8, 4), "WAVE");
    assert.equal(ascii(bytes, 12, 4), "fmt ");
    assert.equal(ascii(bytes, 36, 4), "data");
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), WAV_CHANNELS);
    assert.equal(view.getUint32(24, true), WAV_TARGET_SAMPLE_RATE);
    assert.equal(view.getUint32(28, true), 32_000);
    assert.equal(view.getUint16(32, true), 2);
    assert.equal(view.getUint16(34, true), WAV_BITS_PER_SAMPLE);
    assert.equal(view.getUint32(40, true), WAV_TARGET_SAMPLE_RATE * 2);
  });

  it("clamps float samples to signed 16-bit PCM", () => {
    assert.equal(floatSampleToInt16(-2), -32768);
    assert.equal(floatSampleToInt16(-1), -32768);
    assert.equal(floatSampleToInt16(0), 0);
    assert.equal(floatSampleToInt16(1), 32767);
    assert.equal(floatSampleToInt16(2), 32767);
  });

  it("resamples while preserving duration", () => {
    const sourceRate = 48_000;
    const oneSecond = new Float32Array(sourceRate);
    const resampled = resampleLinear(
      oneSecond,
      sourceRate,
      WAV_TARGET_SAMPLE_RATE,
    );

    assert.equal(resampled.length, WAV_TARGET_SAMPLE_RATE);
  });

  it("truncates samples to the requested maximum duration", () => {
    const samples = new Float32Array(WAV_TARGET_SAMPLE_RATE * 2);
    const truncated = truncateSamplesForDuration(
      samples,
      WAV_TARGET_SAMPLE_RATE,
      500,
    );

    assert.equal(truncated.length, WAV_TARGET_SAMPLE_RATE / 2);
    assert.equal(
      truncateSamplesForDuration(samples, WAV_TARGET_SAMPLE_RATE, 3000),
      samples,
    );
  });
});
