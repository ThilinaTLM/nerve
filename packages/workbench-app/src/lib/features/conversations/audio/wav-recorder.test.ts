import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PcmWavRecorder } from "./wav-recorder";

function browserCapture(t: TestContext, sampleRate = 16_000) {
  const released = {
    source: false,
    processor: false,
    track: false,
    context: false,
  };
  let blobs = 0;
  const processor = {
    onaudioprocess: null as ScriptProcessorNode["onaudioprocess"],
    connect() {},
    disconnect() {
      released.processor = true;
    },
  };
  const source = {
    connect() {},
    disconnect() {
      released.source = true;
    },
  };
  const stream = {
    getTracks: () => [
      {
        stop() {
          released.track = true;
        },
      },
    ],
  };
  class FakeAudioContext {
    sampleRate = sampleRate;
    state = "running";
    destination = {};
    createMediaStreamSource() {
      return source;
    }
    createScriptProcessor() {
      return processor;
    }
    async close() {
      released.context = true;
    }
  }
  const NativeBlob = globalThis.Blob;
  class CheckedBlob extends NativeBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      assert.ok(
        Object.values(released).every(Boolean),
        "cleanup precedes encoding outcome",
      );
      super(parts, options);
      blobs += 1;
    }
  }
  for (const [key, value] of Object.entries({
    window: { AudioContext: FakeAudioContext },
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    Blob: CheckedBlob,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return {
    released,
    get blobs() {
      return blobs;
    },
    feed(...channels: Float32Array[]) {
      const event = {
        inputBuffer: {
          numberOfChannels: channels.length,
          length: channels[0].length,
          getChannelData: (channel: number) => channels[channel],
        },
        outputBuffer: {
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(channels[0].length),
        },
      } as unknown as AudioProcessingEvent;
      processor.onaudioprocess?.call(
        processor as unknown as ScriptProcessorNode,
        event,
      );
    },
  };
}

function samples(ms: number, amplitude = 0, rate = 16_000) {
  return new Float32Array(Math.round((ms * rate) / 1000)).fill(amplitude);
}

async function wavView(blob: Blob) {
  return new DataView(await blob.arrayBuffer());
}

test("accepted WAV is trimmed mono PCM16 at 16k, with sample-derived duration", async (t) => {
  const browser = browserCapture(t, 8_000);
  const recorder = new PcmWavRecorder();
  await recorder.start();
  browser.feed(samples(600, 0, 8_000));
  // Capture stereo and check the mono mix survives resampling and PCM conversion.
  browser.feed(samples(300, 0.25, 8_000), samples(300, 0.75, 8_000));
  browser.feed(samples(600, 0, 8_000));
  const result = await recorder.stop();
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  // Linear interpolation activates the preceding 20ms analysis window.
  assert.equal(result.durationMs, 720);
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.blob.type, "audio/wav");
  const view = await wavView(result.blob);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...new Uint8Array(view.buffer, start, length));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(12, 4), "fmt ");
  assert.equal(ascii(36, 4), "data");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(28, true), 32_000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 11_520 * 2);
  assert.equal(view.getUint32(4, true), result.blob.size - 8);
  assert.equal(result.blob.size, 44 + 11_520 * 2);
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(44 + 4_000 * 2, true), 16_384);
  assert.equal(browser.blobs, 1);
  assert.ok(Object.values(browser.released).every(Boolean));
});

test("empty, silent and too-short captures skip without a blob and release resources", async (t) => {
  const browser = browserCapture(t);
  for (const [input, reason] of [
    [undefined, "no-activity"],
    [samples(1000), "no-activity"],
    [samples(280, 0.1), "too-short"],
  ] as const) {
    const recorder = new PcmWavRecorder();
    await recorder.start();
    if (input) browser.feed(input);
    const result = await recorder.stop();
    assert.deepEqual(result, { status: "skipped", reason });
    assert.ok(Object.values(browser.released).every(Boolean));
  }
  assert.equal(browser.blobs, 0);
});

test("eight-minute cap limits actual encoded samples", async (t) => {
  const browser = browserCapture(t);
  const recorder = new PcmWavRecorder();
  await recorder.start();
  browser.feed(samples(480_100, 0.1));
  const result = await recorder.stop({ maxDurationMs: 480_000 });
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.equal(result.durationMs, 480_000);
  assert.equal(result.blob.size, 44 + 480 * 16_000 * 2);
});

test("cap precedes activity detection, so activity beyond the cap cannot qualify", async (t) => {
  const browser = browserCapture(t);
  const recorder = new PcmWavRecorder();
  await recorder.start();
  browser.feed(samples(480_000));
  browser.feed(samples(300, 0.1));
  assert.deepEqual(await recorder.stop({ maxDurationMs: 480_000 }), {
    status: "skipped",
    reason: "no-activity",
  });
  assert.equal(browser.blobs, 0);
});
