export const WAV_TARGET_SAMPLE_RATE = 16_000;
export const WAV_CHANNELS = 1;
export const WAV_BITS_PER_SAMPLE = 16;
export const WAV_MIME_TYPE = "audio/wav" as const;

const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContext;

declare global {
  interface Window {
    webkitAudioContext?: AudioContextConstructor;
  }
}

export type WavRecordingResult = {
  blob: Blob;
  durationMs: number;
  mimeType: typeof WAV_MIME_TYPE;
};

type WavRecordingStopOptions = {
  maxDurationMs?: number;
};

export function mergeFloat32Chunks(
  chunks: readonly Float32Array[],
): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function resampleLinear(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = WAV_TARGET_SAMPLE_RATE,
): Float32Array {
  if (samples.length === 0) return new Float32Array();
  if (sourceSampleRate === targetSampleRate) return new Float32Array(samples);
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error("Sample rates must be positive.");
  }

  const outputLength = Math.max(
    1,
    Math.round((samples.length * targetSampleRate) / sourceSampleRate),
  );
  const output = new Float32Array(outputLength);
  const scale = sourceSampleRate / targetSampleRate;

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * scale;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const weight = sourceIndex - leftIndex;
    output[i] =
      samples[leftIndex] * (1 - weight) + samples[rightIndex] * weight;
  }

  return output;
}

export function floatSampleToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0
    ? Math.round(clamped * 0x8000)
    : Math.round(clamped * 0x7fff);
}

export function truncateSamplesForDuration(
  samples: Float32Array,
  sampleRate: number,
  maxDurationMs?: number,
): Float32Array {
  if (!maxDurationMs) return samples;
  const maxLength = Math.max(
    1,
    Math.round((sampleRate * maxDurationMs) / 1000),
  );
  if (samples.length <= maxLength) return samples;
  return samples.slice(0, maxLength);
}

export function encodePcm16Wav(
  samples: Float32Array,
  sampleRate = WAV_TARGET_SAMPLE_RATE,
): Uint8Array {
  const bytesPerSample = WAV_BITS_PER_SAMPLE / 8;
  const blockAlign = WAV_CHANNELS * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, WAV_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const sample of samples) {
    view.setInt16(offset, floatSampleToInt16(sample), true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function inputBufferToMono(inputBuffer: AudioBuffer): Float32Array {
  const channelCount = inputBuffer.numberOfChannels;
  const frameCount = inputBuffer.length;
  if (channelCount === 1)
    return new Float32Array(inputBuffer.getChannelData(0));

  const mono = new Float32Array(frameCount);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = inputBuffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i += 1) {
      mono[i] += data[i] / channelCount;
    }
  }
  return mono;
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? window.webkitAudioContext;
}

function createAudioContext(
  AudioContextCtor: AudioContextConstructor,
): AudioContext {
  try {
    return new AudioContextCtor({ sampleRate: WAV_TARGET_SAMPLE_RATE });
  } catch {
    return new AudioContextCtor();
  }
}

export class PcmWavRecorder {
  private audioContext: AudioContext | undefined;
  private processor: ScriptProcessorNode | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private stream: MediaStream | undefined;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private stopped = true;

  static isSupported(): boolean {
    return Boolean(
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      getAudioContextConstructor(),
    );
  }

  async start(): Promise<void> {
    if (!PcmWavRecorder.isSupported()) {
      throw new Error("Audio recording is not supported in this browser.");
    }
    if (!this.stopped) {
      throw new Error("Recording is already in progress.");
    }

    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error("Web Audio is not supported in this browser.");
    }

    this.chunks = [];
    this.stopped = false;
    this.startedAt = Date.now();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: WAV_CHANNELS },
          sampleRate: { ideal: WAV_TARGET_SAMPLE_RATE },
          sampleSize: { ideal: WAV_BITS_PER_SAMPLE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.audioContext = createAudioContext(AudioContextCtor);
      if (this.audioContext.state === "suspended")
        await this.audioContext.resume();

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(
        SCRIPT_PROCESSOR_BUFFER_SIZE,
        1,
        1,
      );
      this.processor.onaudioprocess = (event) => {
        if (this.stopped) return;
        this.chunks.push(inputBufferToMono(event.inputBuffer));
        for (
          let channel = 0;
          channel < event.outputBuffer.numberOfChannels;
          channel += 1
        ) {
          event.outputBuffer.getChannelData(channel).fill(0);
        }
      };

      this.source.connect(this.processor);
      // ScriptProcessorNode only pulls audio while connected. Output is silenced above.
      this.processor.connect(this.audioContext.destination);
    } catch (err) {
      await this.cleanup();
      throw err;
    }
  }

  async stop(
    options: WavRecordingStopOptions = {},
  ): Promise<WavRecordingResult> {
    if (this.stopped) {
      throw new Error("No recording is in progress.");
    }

    this.stopped = true;
    const elapsedMs = Math.max(1, Date.now() - this.startedAt);
    const durationMs = options.maxDurationMs
      ? Math.min(elapsedMs, options.maxDurationMs)
      : elapsedMs;
    const sampleRate = this.audioContext?.sampleRate ?? WAV_TARGET_SAMPLE_RATE;
    const chunks = this.chunks;
    this.chunks = [];
    await this.cleanup();

    const mono = mergeFloat32Chunks(chunks);
    if (mono.length === 0) {
      throw new Error("No audio was captured.");
    }

    const resampled = resampleLinear(mono, sampleRate, WAV_TARGET_SAMPLE_RATE);
    const capped = truncateSamplesForDuration(
      resampled,
      WAV_TARGET_SAMPLE_RATE,
      options.maxDurationMs,
    );
    const wavBytes = encodePcm16Wav(capped, WAV_TARGET_SAMPLE_RATE);
    const audioBuffer = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(audioBuffer).set(wavBytes);
    return {
      blob: new Blob([audioBuffer], { type: WAV_MIME_TYPE }),
      durationMs,
      mimeType: WAV_MIME_TYPE,
    };
  }

  async cancel(): Promise<void> {
    this.stopped = true;
    this.chunks = [];
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.processor?.disconnect();
    this.processor = undefined;
    this.source?.disconnect();
    this.source = undefined;
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = undefined;
    const context = this.audioContext;
    this.audioContext = undefined;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }
}
