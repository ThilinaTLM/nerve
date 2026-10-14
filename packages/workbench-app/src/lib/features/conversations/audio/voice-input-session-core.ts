import type { TranscriptionCallbacks } from "./transcription-operation";
import {
  type VoiceInputTarget,
  voiceInputTargetKey,
  voiceInputTargetsEqual,
} from "./voice-input-target";

export type { VoiceInputTarget } from "./voice-input-target";

export type VoiceInputTargetHandlers = {
  appendTranscript?: (text: string) => void;
  onError?: (message: string) => void;
};

export type VoiceInputSessionState = {
  activeTarget: VoiceInputTarget | undefined;
  starting: boolean;
};

type Controller = {
  recording: boolean;
  transcribing: boolean;
  pending: boolean;
  elapsedMs: number;
  retryAttempt: number;
  maxDurationMs: number;
  maxRetries: number;
  start(): Promise<void>;
  stop(): Promise<boolean>;
  cancel(): Promise<void>;
};

type Dependencies = {
  createController: (callbacks: TranscriptionCallbacks) => Controller;
  isSupported: () => boolean;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
};

/** Target ownership is independent of target equality: same-target restarts are new operations. */
export class VoiceInputSessionCore {
  #operation: object | undefined;
  #handlers = new Map<string, VoiceInputTargetHandlers>();
  readonly #controller: Controller;

  constructor(
    readonly state: VoiceInputSessionState,
    readonly dependencies: Dependencies,
  ) {
    this.#controller = dependencies.createController({
      onTranscript: (text) => this.#appendTranscript(text),
      onError: (message) => this.#handleError(message),
      // The controller emits settlement only while it still owns the operation.
      // This also covers timer-driven stops that do not call session.stop().
      onSettled: () => {
        this.state.activeTarget = undefined;
      },
      onSkipped: (reason) => {
        if (this.state.activeTarget)
          dependencies.notifyInfo(
            reason === "no-activity"
              ? "No speech detected"
              : "Recording too short",
          );
      },
    });
  }

  get activeTarget(): VoiceInputTarget | undefined {
    return this.state.activeTarget;
  }

  get recording(): boolean {
    return this.#controller.recording;
  }

  get transcribing(): boolean {
    return this.#controller.transcribing;
  }

  get pending(): boolean {
    return this.state.starting || this.#controller.pending;
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
    return this.dependencies.isSupported();
  }

  isTargetActive(target: VoiceInputTarget | undefined): boolean {
    return voiceInputTargetsEqual(this.state.activeTarget, target);
  }

  isBusyForOtherTarget(target: VoiceInputTarget | undefined): boolean {
    return Boolean(
      this.state.activeTarget &&
      !voiceInputTargetsEqual(this.state.activeTarget, target),
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
    if (this.state.activeTarget) return false;
    if (!this.isSupported()) {
      this.#handleError(
        "Audio recording is not supported in this browser.",
        target,
      );
      return false;
    }

    const operation = {};
    this.#operation = operation;
    this.state.activeTarget = target;
    this.state.starting = true;
    try {
      await this.#controller.start();
    } finally {
      if (this.#operation === operation) this.state.starting = false;
    }

    if (this.#operation !== operation) return false;
    if (!this.#controller.recording && !this.#controller.pending) {
      if (voiceInputTargetsEqual(this.state.activeTarget, target))
        this.state.activeTarget = undefined;
      return false;
    }

    return true;
  }

  async stop(target?: VoiceInputTarget): Promise<boolean> {
    const active = this.state.activeTarget;
    if (!active || (target && !voiceInputTargetsEqual(active, target)))
      return false;
    // A duplicate stop must not release a target while its upload is still active.
    if (!this.#controller.recording || this.#controller.pending) return false;
    const operation = this.#operation;
    try {
      const transcribed = await this.#controller.stop();
      return this.#operation === operation && transcribed;
    } finally {
      if (this.#operation === operation) this.state.activeTarget = undefined;
    }
  }

  async cancel(target?: VoiceInputTarget): Promise<void> {
    const active = this.state.activeTarget;
    if (target && !voiceInputTargetsEqual(active, target)) return;
    this.#operation = undefined;
    this.state.activeTarget = undefined;
    this.state.starting = false;
    await this.#controller.cancel();
  }

  async cancelIfTarget(target: VoiceInputTarget): Promise<void> {
    if (this.isTargetActive(target)) await this.cancel(target);
  }

  async cancelIfTargets(targets: VoiceInputTarget[]): Promise<void> {
    const active = this.state.activeTarget;
    if (!active) return;
    if (targets.some((target) => voiceInputTargetsEqual(active, target))) {
      await this.cancel(active);
    }
  }

  #handlersFor(
    target = this.state.activeTarget,
  ): VoiceInputTargetHandlers | undefined {
    return target ? this.#handlers.get(voiceInputTargetKey(target)) : undefined;
  }

  #handleError(message: string, target = this.state.activeTarget): void {
    const handled = this.#handlersFor(target)?.onError;
    if (handled) handled(message);
    else this.dependencies.notifyError(message);
  }

  #appendTranscript(text: string): void {
    const target = this.state.activeTarget;
    if (!target) return;

    const handlers = this.#handlersFor(target);
    if (handlers?.appendTranscript) {
      handlers.appendTranscript(text);
      return;
    }
  }
}
