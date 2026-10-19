import type {
  ComposerDictationHandle,
  ComposerEditorApi,
} from "$lib/presentation/composer/composer-editor-api";
import {
  appendTranscriptText,
  type VoiceInputTarget,
} from "$lib/features/conversations/audio/voice-input-target";

type VoiceInputRegistration = {
  registerTargetHandlers(
    target: VoiceInputTarget,
    handlers: {
      appendTranscript: (text: string) => void;
      onError?: (message: string) => void;
    },
  ): () => void;
};

/** In-editor dictation chip hooks; absent when the editor API is unavailable. */
export type ComposerDictation = {
  /** Replaces the chip with the transcript. False when no chip is live. */
  resolve(text: string): boolean;
  /** Marks the chip failed. False when no chip is live. */
  fail(): boolean;
};

export function bindComposerVoiceInput(
  session: VoiceInputRegistration,
  target: VoiceInputTarget,
  draft: {
    read: () => string;
    update: (text: string) => void;
    focus: () => void;
  },
  dictation?: {
    chip: ComposerDictation;
    /** Reports a failure the chip cannot show (no live chip). */
    notifyError: (message: string) => void;
  },
): () => void {
  return session.registerTargetHandlers(target, {
    appendTranscript: (transcript) => {
      if (dictation?.chip.resolve(transcript)) {
        draft.focus();
        return;
      }
      if (!transcript.trim()) return;
      draft.update(appendTranscriptText(draft.read(), transcript));
      draft.focus();
    },
    onError: dictation
      ? (message) => {
          if (!dictation.chip.fail()) dictation.notifyError(message);
        }
      : undefined,
  });
}

export type DictationSessionState = {
  recording: boolean;
  transcribing: boolean;
  elapsedMs: number;
};

/**
 * Mirrors one voice session onto the editor's dictation placeholder chip: the
 * chip appears at the caret when recording starts, follows recording →
 * transcribing, is replaced by the transcript, and disappears when the session
 * is cancelled or the user deletes the chip. A failed chip stays until the
 * next recording (retry) or `discard()`.
 */
export class ComposerDictationBridge implements ComposerDictation {
  #handle: ComposerDictationHandle | undefined;
  #stopListening: (() => void) | undefined;
  #failed = false;
  #lastElapsedMs = 0;

  constructor(
    private readonly getApi: () => ComposerEditorApi | undefined,
    /** Cancels the voice session when the user deletes the chip. */
    private readonly cancelSession: () => void,
  ) {}

  /** True while a chip exists in the editor (recording, transcribing, failed). */
  get active(): boolean {
    return Boolean(this.#handle?.active);
  }

  get failed(): boolean {
    return this.active && this.#failed;
  }

  sync(state: DictationSessionState): void {
    if (state.recording || state.transcribing) {
      // A failed chip only restarts with a new recording (mic retry); late
      // transcribing updates from the failing operation must not revive it.
      if (this.#failed && !state.recording) return;
      // A late transcript already consumed the chip; never start a new one.
      if (!state.recording && !this.#handle?.active) return;
      const handle = this.#ensureHandle();
      if (!handle) return;
      this.#failed = false;
      if (state.recording) this.#lastElapsedMs = state.elapsedMs;
      handle.update(
        state.transcribing ? "transcribing" : "recording",
        this.#lastElapsedMs,
      );
      return;
    }
    // Session idle: a failed chip is kept for retry; anything else was cancelled.
    if (!this.#failed) this.discard();
  }

  resolve(text: string): boolean {
    const handle = this.#handle;
    if (!handle?.active) return false;
    this.#release();
    const trimmed = text.trim();
    if (trimmed) handle.resolve(trimmed);
    else handle.cancel();
    return true;
  }

  fail(): boolean {
    const handle = this.#handle;
    if (!handle?.active) return false;
    this.#failed = true;
    handle.update("failed", this.#lastElapsedMs);
    return true;
  }

  discard(): void {
    const handle = this.#handle;
    this.#release();
    if (handle?.active) handle.cancel();
  }

  #ensureHandle(): ComposerDictationHandle | undefined {
    if (this.#handle?.active) return this.#handle;
    const api = this.getApi();
    if (!api) return undefined;
    const handle = api.startDictation();
    this.#handle = handle;
    this.#stopListening = handle.onRemoved(() => {
      if (this.#handle !== handle) return;
      const wasFailed = this.#failed;
      this.#release();
      if (!wasFailed) this.cancelSession();
    });
    return handle;
  }

  #release(): void {
    this.#stopListening?.();
    this.#stopListening = undefined;
    this.#handle = undefined;
    this.#failed = false;
    this.#lastElapsedMs = 0;
  }
}
