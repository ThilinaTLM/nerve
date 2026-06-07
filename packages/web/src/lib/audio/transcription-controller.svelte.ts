import { transcribeAudio } from "../api";
import { PcmWavRecorder, type WavRecordingResult } from "./wav-recorder";

type TranscriptionControllerOptions = {
  onTranscript: (text: string) => void;
};

/**
 * Reactive controller that captures microphone audio and transcribes it.
 * Shared by the prompt composer and the ask_user reply input.
 */
export class TranscriptionController {
  recording = $state(false);
  transcribing = $state(false);
  error = $state<string | undefined>(undefined);

  #stoppingRecording = $state(false);
  #recorder: PcmWavRecorder | undefined;
  readonly #onTranscript: (text: string) => void;

  constructor(options: TranscriptionControllerOptions) {
    this.#onTranscript = options.onTranscript;
  }

  static isSupported(): boolean {
    return PcmWavRecorder.isSupported();
  }

  /** True while finishing a recording or transcribing (button should stay busy). */
  get pending(): boolean {
    return this.transcribing || this.#stoppingRecording;
  }

  toggle(): void {
    if (this.recording) {
      void this.stop();
    } else {
      void this.start();
    }
  }

  async start(): Promise<void> {
    if (!TranscriptionController.isSupported()) {
      this.error = "Audio recording is not supported in this browser.";
      return;
    }
    this.error = undefined;
    try {
      const recorder = new PcmWavRecorder();
      await recorder.start();
      this.#recorder = recorder;
      this.recording = true;
    } catch (err) {
      await this.#recorder?.cancel();
      this.#recorder = undefined;
      this.recording = false;
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async stop(): Promise<void> {
    if (!this.#recorder || this.#stoppingRecording) return;
    const recorder = this.#recorder;
    this.#stoppingRecording = true;
    this.#recorder = undefined;
    try {
      const result = await recorder.stop();
      this.recording = false;
      await this.#transcribe(result);
    } catch (err) {
      this.recording = false;
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.#stoppingRecording = false;
    }
  }

  async cancel(): Promise<void> {
    const recorder = this.#recorder;
    this.#recorder = undefined;
    this.recording = false;
    await recorder?.cancel();
  }

  async #transcribe(result: WavRecordingResult): Promise<void> {
    this.transcribing = true;
    this.error = undefined;
    try {
      this.#onTranscript(await transcribeAudio(result.blob, result.durationMs));
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.transcribing = false;
    }
  }
}
