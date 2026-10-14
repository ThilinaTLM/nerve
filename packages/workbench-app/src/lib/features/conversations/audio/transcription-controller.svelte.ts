import {
  AUDIO_TRANSCRIPTION_MAX_DURATION_MS,
  AUDIO_TRANSCRIPTION_MAX_RETRIES,
} from "@nervekit/contracts/transcription";
import { ApiRequestError, transcribeAudio } from "$lib/api";
import {
  createTranscriptionState,
  isAbortError,
  TranscriptionOperation,
  type TranscriptionCallbacks,
} from "./transcription-operation";
import { PcmWavRecorder } from "./wav-recorder";

export function isRetryableTranscriptionError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof ApiRequestError) {
    if (!error.status) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

/** Reactive adapter over the shared capture/upload lifecycle. */
export class TranscriptionController {
  readonly #state = $state(createTranscriptionState());
  readonly #operation: TranscriptionOperation;
  readonly maxDurationMs = AUDIO_TRANSCRIPTION_MAX_DURATION_MS;
  readonly maxRetries = AUDIO_TRANSCRIPTION_MAX_RETRIES;

  constructor(options: TranscriptionCallbacks) {
    this.#operation = new TranscriptionOperation(
      this.#state,
      {
        createRecorder: () => new PcmWavRecorder(),
        isSupported: () => TranscriptionController.isSupported(),
        transcribe: (blob, durationMs, signal) =>
          transcribeAudio(blob, durationMs, { signal }),
        isRetryable: isRetryableTranscriptionError,
        maxDurationMs: this.maxDurationMs,
        maxRetries: this.maxRetries,
      },
      options,
    );
  }

  static isSupported(): boolean {
    return PcmWavRecorder.isSupported();
  }
  get recording(): boolean {
    return this.#state.recording;
  }
  get transcribing(): boolean {
    return this.#state.transcribing;
  }
  get error(): string | undefined {
    return this.#state.error;
  }
  get elapsedMs(): number {
    return this.#state.elapsedMs;
  }
  get retryAttempt(): number {
    return this.#state.retryAttempt;
  }
  get pending(): boolean {
    return this.#operation.pending;
  }

  toggle(): void {
    if (this.recording) void this.stop();
    else void this.start();
  }
  start(): Promise<void> {
    return this.#operation.start();
  }
  stop(): Promise<boolean> {
    return this.#operation.stop();
  }
  cancel(): Promise<void> {
    return this.#operation.cancel();
  }
}
