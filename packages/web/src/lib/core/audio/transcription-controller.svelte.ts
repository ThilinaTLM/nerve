import {
  AUDIO_TRANSCRIPTION_MAX_DURATION_MS,
  AUDIO_TRANSCRIPTION_MAX_RETRIES,
} from "@nervekit/shared";
import { ApiRequestError, transcribeAudio } from "$lib/api";
import { PcmWavRecorder, type WavRecordingResult } from "./wav-recorder";

type TranscriptionControllerOptions = {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
};

const RETRY_BACKOFF_MS = [500, 1000, 2000] as const;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function retryDelayMs(retryAttempt: number): number {
  return RETRY_BACKOFF_MS[retryAttempt - 1] ?? RETRY_BACKOFF_MS.at(-1) ?? 2000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Transcription was cancelled.", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Transcription was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export function isRetryableTranscriptionError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof ApiRequestError) {
    if (!error.status) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reactive controller that captures microphone audio and transcribes it.
 * Shared by the prompt composer and the ask_user reply input.
 */
export class TranscriptionController {
  recording = $state(false);
  transcribing = $state(false);
  error = $state<string | undefined>(undefined);
  elapsedMs = $state(0);
  retryAttempt = $state(0);

  readonly maxDurationMs = AUDIO_TRANSCRIPTION_MAX_DURATION_MS;
  readonly maxRetries = AUDIO_TRANSCRIPTION_MAX_RETRIES;

  #stoppingRecording = $state(false);
  #recorder: PcmWavRecorder | undefined;
  #recordingStartedAt = 0;
  #elapsedTimer: number | undefined;
  #autoStopTimer: number | undefined;
  #transcriptionAbort: AbortController | undefined;
  readonly #onTranscript: (text: string) => void;
  readonly #onError: ((message: string) => void) | undefined;

  constructor(options: TranscriptionControllerOptions) {
    this.#onTranscript = options.onTranscript;
    this.#onError = options.onError;
  }

  static isSupported(): boolean {
    return PcmWavRecorder.isSupported();
  }

  /** True while finishing a recording or transcribing (button should stay busy). */
  get pending(): boolean {
    return this.transcribing || this.#stoppingRecording;
  }

  #setError(message: string): void {
    this.error = message;
    this.#onError?.(message);
  }

  toggle(): void {
    if (this.recording) {
      void this.stop();
    } else {
      void this.start();
    }
  }

  async start(): Promise<void> {
    if (this.recording || this.pending) return;
    if (!TranscriptionController.isSupported()) {
      this.#setError("Audio recording is not supported in this browser.");
      return;
    }
    this.error = undefined;
    this.retryAttempt = 0;
    this.elapsedMs = 0;
    try {
      const recorder = new PcmWavRecorder();
      await recorder.start();
      this.#recorder = recorder;
      this.recording = true;
      this.#startRecordingTimers();
    } catch (err) {
      await this.#recorder?.cancel();
      this.#recorder = undefined;
      this.#clearRecordingTimers();
      this.recording = false;
      this.#setError(errorMessage(err));
    }
  }

  async stop(): Promise<boolean> {
    if (!this.#recorder || this.#stoppingRecording) return false;
    const recorder = this.#recorder;
    this.#stoppingRecording = true;
    this.#recorder = undefined;
    this.#clearRecordingTimers();
    try {
      const result = await recorder.stop({ maxDurationMs: this.maxDurationMs });
      this.recording = false;
      this.elapsedMs = result.durationMs;
      return await this.#transcribe(result);
    } catch (err) {
      this.recording = false;
      this.#setError(errorMessage(err));
      return false;
    } finally {
      this.#stoppingRecording = false;
    }
  }

  async cancel(): Promise<void> {
    this.#transcriptionAbort?.abort();
    const recorder = this.#recorder;
    this.#recorder = undefined;
    this.#clearRecordingTimers();
    this.recording = false;
    this.transcribing = false;
    this.retryAttempt = 0;
    this.elapsedMs = 0;
    await recorder?.cancel();
  }

  #startRecordingTimers(): void {
    this.#clearRecordingTimers();
    this.#recordingStartedAt = Date.now();
    this.#updateElapsed();
    this.#elapsedTimer = window.setInterval(() => this.#updateElapsed(), 250);
    this.#autoStopTimer = window.setTimeout(() => {
      if (this.recording) void this.stop();
    }, this.maxDurationMs);
  }

  #clearRecordingTimers(): void {
    if (this.#elapsedTimer) window.clearInterval(this.#elapsedTimer);
    if (this.#autoStopTimer) window.clearTimeout(this.#autoStopTimer);
    this.#elapsedTimer = undefined;
    this.#autoStopTimer = undefined;
  }

  #updateElapsed(): void {
    if (!this.#recordingStartedAt) return;
    this.elapsedMs = Math.min(
      Math.max(0, Date.now() - this.#recordingStartedAt),
      this.maxDurationMs,
    );
  }

  async #transcribe(result: WavRecordingResult): Promise<boolean> {
    const abort = new AbortController();
    this.#transcriptionAbort = abort;
    this.transcribing = true;
    this.error = undefined;
    this.retryAttempt = 0;
    let retriesExhausted = false;

    try {
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        if (attempt > 0) {
          this.retryAttempt = attempt;
          await sleep(retryDelayMs(attempt), abort.signal);
        }

        try {
          const transcript = await transcribeAudio(
            result.blob,
            result.durationMs,
            {
              signal: abort.signal,
            },
          );
          if (abort.signal.aborted) return false;
          if (!transcript.trim()) return false;
          this.#onTranscript(transcript);
          return true;
        } catch (err) {
          if (abort.signal.aborted || isAbortError(err)) return false;
          if (
            attempt >= this.maxRetries ||
            !isRetryableTranscriptionError(err)
          ) {
            retriesExhausted = attempt >= this.maxRetries;
            throw err;
          }
        }
      }
    } catch (err) {
      if (abort.signal.aborted || isAbortError(err)) return false;
      const message = errorMessage(err);
      this.#setError(
        retriesExhausted
          ? `Transcription failed after ${this.maxRetries} retries: ${message}`
          : message,
      );
    } finally {
      if (this.#transcriptionAbort === abort)
        this.#transcriptionAbort = undefined;
      this.transcribing = false;
      this.retryAttempt = 0;
    }
    return false;
  }
}
