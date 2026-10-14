import type { WavRecordingResult } from "./wav-recorder";

export type TranscriptionState = {
  recording: boolean;
  transcribing: boolean;
  error: string | undefined;
  elapsedMs: number;
  retryAttempt: number;
  starting: boolean;
  stopping: boolean;
};

export function createTranscriptionState(): TranscriptionState {
  return {
    recording: false,
    transcribing: false,
    error: undefined,
    elapsedMs: 0,
    retryAttempt: 0,
    starting: false,
    stopping: false,
  };
}

export type TranscriptionRecorder = {
  start(): Promise<void>;
  stop(options: { maxDurationMs: number }): Promise<WavRecordingResult>;
  cancel(): Promise<void>;
};

export type TranscriptionCallbacks = {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onSkipped?: (reason: "no-activity" | "too-short") => void;
  /** Delivered only by the still-owned stop, including automatic stops. */
  onSettled?: () => void;
};

type Dependencies = {
  createRecorder: () => TranscriptionRecorder;
  isSupported: () => boolean;
  transcribe: (
    blob: Blob,
    durationMs: number,
    signal: AbortSignal,
  ) => Promise<string>;
  isRetryable: (error: unknown) => boolean;
  maxDurationMs: number;
  maxRetries: number;
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Transcription was cancelled.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Transcription was cancelled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const RETRY_BACKOFF_MS = [500, 1000, 2000] as const;

/** Owns the actual capture/upload lifecycle; state may be a Svelte reactive proxy. */
export class TranscriptionOperation {
  #operation: AbortController | undefined;
  #recorder: TranscriptionRecorder | undefined;
  #elapsedTimer: ReturnType<typeof setInterval> | undefined;
  #autoStopTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly state: TranscriptionState,
    readonly dependencies: Dependencies,
    readonly callbacks: TranscriptionCallbacks,
  ) {}

  get pending(): boolean {
    return (
      this.state.starting || this.state.stopping || this.state.transcribing
    );
  }
  #owns(operation: AbortController): boolean {
    return this.#operation === operation && !operation.signal.aborted;
  }
  #error(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state.error = message;
    this.callbacks.onError?.(message);
  }
  #clearTimers(): void {
    clearInterval(this.#elapsedTimer);
    clearTimeout(this.#autoStopTimer);
    this.#elapsedTimer = undefined;
    this.#autoStopTimer = undefined;
  }

  async start(): Promise<void> {
    if (this.state.recording || this.pending) return;
    if (!this.dependencies.isSupported()) {
      this.#error("Audio recording is not supported in this browser.");
      return;
    }
    const operation = new AbortController();
    this.#operation = operation;
    Object.assign(this.state, createTranscriptionState(), { starting: true });
    let recorder: TranscriptionRecorder | undefined;
    try {
      recorder = this.dependencies.createRecorder();
      await recorder.start();
      if (!this.#owns(operation)) {
        await recorder.cancel();
        return;
      }
      this.#recorder = recorder;
      this.state.recording = true;
      const startedAt = Date.now();
      this.#elapsedTimer = setInterval(() => {
        if (this.#owns(operation))
          this.state.elapsedMs = Math.min(
            Date.now() - startedAt,
            this.dependencies.maxDurationMs,
          );
      }, 250);
      this.#autoStopTimer = setTimeout(() => {
        if (this.#owns(operation) && this.state.recording) void this.stop();
      }, this.dependencies.maxDurationMs);
    } catch (error) {
      // A partially initialized or late recorder still owns resources, not shared state.
      try {
        await recorder?.cancel();
      } catch {
        /* Preserve the original start error. */
      }
      if (this.#owns(operation)) {
        this.#recorder = undefined;
        this.state.recording = false;
        this.#error(error);
      }
    } finally {
      if (this.#owns(operation)) this.state.starting = false;
    }
  }

  async stop(): Promise<boolean> {
    const operation = this.#operation;
    const recorder = this.#recorder;
    if (!operation || !recorder || this.state.stopping) return false;
    this.#recorder = undefined;
    this.state.stopping = true;
    this.#clearTimers();
    try {
      const result = await recorder.stop({
        maxDurationMs: this.dependencies.maxDurationMs,
      });
      if (!this.#owns(operation)) return false;
      this.state.recording = false;
      if (result.status === "skipped") {
        this.callbacks.onSkipped?.(result.reason);
        return false;
      }
      this.state.elapsedMs = result.durationMs;
      return await this.#transcribe(operation, result);
    } catch (error) {
      if (this.#owns(operation) && !isAbortError(error)) {
        this.state.recording = false;
        this.#error(error);
      }
      return false;
    } finally {
      if (this.#owns(operation)) {
        this.state.stopping = false;
        this.callbacks.onSettled?.();
      }
    }
  }

  async cancel(): Promise<void> {
    const operation = this.#operation;
    this.#operation = undefined;
    const recorder = this.#recorder;
    this.#recorder = undefined;
    this.#clearTimers();
    Object.assign(this.state, createTranscriptionState());
    operation?.abort();
    await recorder?.cancel();
  }

  async #transcribe(
    operation: AbortController,
    result: Extract<WavRecordingResult, { status: "accepted" }>,
  ): Promise<boolean> {
    this.state.transcribing = true;
    this.state.error = undefined;
    this.state.retryAttempt = 0;
    try {
      for (
        let attempt = 0;
        attempt <= this.dependencies.maxRetries;
        attempt += 1
      ) {
        if (!this.#owns(operation)) return false;
        if (attempt > 0) {
          this.state.retryAttempt = attempt;
          await (this.dependencies.delay ?? abortableDelay)(
            RETRY_BACKOFF_MS[attempt - 1] ?? 2000,
            operation.signal,
          );
          if (!this.#owns(operation)) return false;
        }
        try {
          const text = await this.dependencies.transcribe(
            result.blob,
            result.durationMs,
            operation.signal,
          );
          if (!this.#owns(operation) || !text.trim()) return false;
          this.callbacks.onTranscript(text);
          return true;
        } catch (error) {
          if (!this.#owns(operation) || isAbortError(error)) return false;
          if (
            attempt >= this.dependencies.maxRetries ||
            !this.dependencies.isRetryable(error)
          ) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.#error(
              attempt >= this.dependencies.maxRetries
                ? `Transcription failed after ${this.dependencies.maxRetries} retries: ${message}`
                : message,
            );
            return false;
          }
        }
      }
    } catch (error) {
      if (this.#owns(operation) && !isAbortError(error)) this.#error(error);
    } finally {
      if (this.#owns(operation)) {
        this.state.transcribing = false;
        this.state.retryAttempt = 0;
      }
    }
    return false;
  }
}
