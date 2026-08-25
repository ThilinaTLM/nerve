import type { NerveMessage } from "@nervekit/contracts";

export type OutboundPriority = "control" | "replay" | "live";

type PendingSend = {
  readonly message: NerveMessage;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

/** Serializes transport writes while allowing control and replay to precede live data. */
export class PrioritizedMessageSender {
  readonly #queues: Record<OutboundPriority, PendingSend[]> = {
    control: [],
    replay: [],
    live: [],
  };
  #draining = false;

  constructor(
    private readonly sendMessage: (
      message: NerveMessage,
    ) => void | Promise<void>,
  ) {}

  send(message: NerveMessage, priority: OutboundPriority): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#queues[priority].push({ message, resolve, reject });
      void this.#drain();
    });
  }

  close(error = new Error("Protocol sender closed")): void {
    for (const queue of Object.values(this.#queues)) {
      for (const pending of queue.splice(0)) pending.reject(error);
    }
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      let pending = this.#next();
      while (pending) {
        try {
          await this.sendMessage(pending.message);
          pending.resolve();
        } catch (error) {
          pending.reject(error);
        }
        pending = this.#next();
      }
    } finally {
      this.#draining = false;
      if (Object.values(this.#queues).some((queue) => queue.length > 0))
        void this.#drain();
    }
  }

  #next(): PendingSend | undefined {
    return (
      this.#queues.control.shift() ??
      this.#queues.replay.shift() ??
      this.#queues.live.shift()
    );
  }
}
