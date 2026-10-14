export const AUDIO_ACTIVITY_WINDOW_MS = 20;
export const AUDIO_ACTIVITY_THRESHOLD_DBFS = -45;
export const AUDIO_ACTIVITY_MIN_RUN_MS = 60;
export const AUDIO_ACTIVITY_MIN_TOTAL_MS = 300;
export const AUDIO_ACTIVITY_PADDING_MS = 200;

export type SkippedAudioResult = {
  status: "skipped";
  reason: "no-activity" | "too-short";
};

export type AudioTrimmingResult =
  | { status: "accepted"; samples: Float32Array }
  | SkippedAudioResult;

/** Detect activity, not speech; retain the entire range between qualifying runs. */
export function trimAudioActivity(
  samples: Float32Array,
  sampleRate: number,
): AudioTrimmingResult {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Sample rate must be positive and finite.");
  }
  const windowSamples = Math.max(
    1,
    Math.round((sampleRate * AUDIO_ACTIVITY_WINDOW_MS) / 1000),
  );
  const thresholdSquared = 10 ** (AUDIO_ACTIVITY_THRESHOLD_DBFS / 10);
  const minRunSamples = (sampleRate * AUDIO_ACTIVITY_MIN_RUN_MS) / 1000;
  const minTotalSamples = (sampleRate * AUDIO_ACTIVITY_MIN_TOTAL_MS) / 1000;
  let runStart = -1;
  let firstActive = -1;
  let lastActive = 0;
  let activeSamples = 0;

  const retainRun = (end: number) => {
    if (runStart >= 0 && end - runStart >= minRunSamples) {
      if (firstActive < 0) firstActive = runStart;
      lastActive = end;
      activeSamples += end - runStart;
    }
    runStart = -1;
  };

  for (let start = 0; start < samples.length; start += windowSamples) {
    const end = Math.min(start + windowSamples, samples.length);
    let sumSquares = 0;
    for (let i = start; i < end; i += 1) {
      sumSquares += samples[i] * samples[i];
    }
    if (sumSquares / (end - start) >= thresholdSquared) {
      if (runStart < 0) runStart = start;
    } else {
      retainRun(start);
    }
  }
  retainRun(samples.length);

  if (firstActive < 0) return { status: "skipped", reason: "no-activity" };
  if (activeSamples < minTotalSamples) {
    return { status: "skipped", reason: "too-short" };
  }
  const paddingSamples = Math.round(
    (sampleRate * AUDIO_ACTIVITY_PADDING_MS) / 1000,
  );
  return {
    status: "accepted",
    samples: samples.slice(
      Math.max(0, firstActive - paddingSamples),
      Math.min(samples.length, lastActive + paddingSamples),
    ),
  };
}
