import { notify } from "$lib/notifications/notify.svelte";
import { ensureConversationView } from "$lib/stores/conversation-flow/state";
import { workbenchState } from "$lib/stores/workbench/state.svelte";
import { TranscriptionController } from "./transcription-controller.svelte";
import {
  appendTranscriptText,
  type VoiceInputTarget,
  voiceInputTargetKey,
  voiceInputTargetsEqual,
} from "./voice-input-target";

export type { VoiceInputTarget } from "./voice-input-target";

type VoiceInputTargetHandlers = {
  appendTranscript?: (text: string) => void;
  onError?: (message: string) => void;
};

function defaultNotifyError(message: string): void {
  notify.error("Voice input failed", { description: message });
}

class VoiceInputSession {
  #activeTarget = $state<VoiceInputTarget | undefined>(undefined);
  #starting = $state(false);
  #handlers = new Map<string, VoiceInputTargetHandlers>();

  readonly #controller = new TranscriptionController({
    onTranscript: (text) => this.#appendTranscript(text),
    onError: (message) => this.#handleError(message),
  });

  get activeTarget(): VoiceInputTarget | undefined {
    return this.#activeTarget;
  }

  get recording(): boolean {
    return this.#controller.recording;
  }

  get transcribing(): boolean {
    return this.#controller.transcribing;
  }

  get pending(): boolean {
    return this.#starting || this.#controller.pending;
  }

  get elapsedMs(): number {
    return this.#controller.elapsedMs;
  }

  get retryAttempt(): number {
    return this.#controller.retryAttempt;
  }

  get maxDurationMs(): number {
    return this.#controller.maxDurationMs;
  }

  get maxRetries(): number {
    return this.#controller.maxRetries;
  }

  isSupported(): boolean {
    return TranscriptionController.isSupported();
  }

  isTargetActive(target: VoiceInputTarget | undefined): boolean {
    return voiceInputTargetsEqual(this.#activeTarget, target);
  }

  isBusyForOtherTarget(target: VoiceInputTarget | undefined): boolean {
    return Boolean(
      this.#activeTarget && !voiceInputTargetsEqual(this.#activeTarget, target),
    );
  }

  registerTargetHandlers(
    target: VoiceInputTarget,
    handlers: VoiceInputTargetHandlers,
  ): () => void {
    const key = voiceInputTargetKey(target);
    this.#handlers.set(key, handlers);
    return () => {
      const current = this.#handlers.get(key);
      if (current === handlers) this.#handlers.delete(key);
    };
  }

  async toggle(target: VoiceInputTarget): Promise<void> {
    if (this.isTargetActive(target) && this.recording) {
      await this.stop(target);
      return;
    }
    await this.start(target);
  }

  async start(target: VoiceInputTarget): Promise<boolean> {
    if (this.#activeTarget) return false;
    if (!this.isSupported()) {
      this.#handleError(
        "Audio recording is not supported in this browser.",
        target,
      );
      return false;
    }

    this.#activeTarget = target;
    this.#starting = true;
    try {
      await this.#controller.start();
    } finally {
      this.#starting = false;
    }

    if (!this.#controller.recording && !this.#controller.pending) {
      if (voiceInputTargetsEqual(this.#activeTarget, target))
        this.#activeTarget = undefined;
      return false;
    }

    return true;
  }

  async stop(target?: VoiceInputTarget): Promise<void> {
    const active = this.#activeTarget;
    if (!active || (target && !voiceInputTargetsEqual(active, target))) return;
    await this.#controller.stop();
    if (voiceInputTargetsEqual(this.#activeTarget, active))
      this.#activeTarget = undefined;
  }

  async cancel(target?: VoiceInputTarget): Promise<void> {
    const active = this.#activeTarget;
    if (target && !voiceInputTargetsEqual(active, target)) return;
    this.#activeTarget = undefined;
    this.#starting = false;
    await this.#controller.cancel();
  }

  async cancelIfTarget(target: VoiceInputTarget): Promise<void> {
    if (this.isTargetActive(target)) await this.cancel(target);
  }

  async cancelIfTargets(targets: VoiceInputTarget[]): Promise<void> {
    const active = this.#activeTarget;
    if (!active) return;
    if (targets.some((target) => voiceInputTargetsEqual(active, target))) {
      await this.cancel(active);
    }
  }

  #handlersFor(
    target = this.#activeTarget,
  ): VoiceInputTargetHandlers | undefined {
    return target ? this.#handlers.get(voiceInputTargetKey(target)) : undefined;
  }

  #handleError(message: string, target = this.#activeTarget): void {
    const handled = this.#handlersFor(target)?.onError;
    if (handled) handled(message);
    else defaultNotifyError(message);
  }

  #appendTranscript(text: string): void {
    const target = this.#activeTarget;
    if (!target) return;

    const handlers = this.#handlersFor(target);
    if (handlers?.appendTranscript) {
      handlers.appendTranscript(text);
      return;
    }

    if (target.kind === "conversation") {
      const view = ensureConversationView(target.id);
      view.composerText = appendTranscriptText(view.composerText, text);
      return;
    }

    if (target.kind === "pending-conversation") {
      const pending = workbenchState.pendingConversations[target.id];
      if (pending)
        pending.composerText = appendTranscriptText(pending.composerText, text);
    }
  }
}

export const voiceInputSession = new VoiceInputSession();
