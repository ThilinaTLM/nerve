import type { ConversationEvent, LiveDelta } from "@nervekit/contracts/core";
import { LatestSnapshotDelivery } from "@nervekit/protocol/server";

type ArgumentDelta = Extract<LiveDelta, { type: "tool_call_arguments" }>;
type Preview = { conversationId: string; delta: ArgumentDelta };
const keyPrefix = (id: string) => JSON.stringify(id) + ":";

/** Conversation semantics stay here; the protocol worker owns bounded delivery. */
export class ToolArgumentDelivery {
  readonly #turns = new Map<string, { id: string; closed: boolean }>();
  readonly #delivery: LatestSnapshotDelivery<Preview>;
  #disposed = false;

  constructor(
    private readonly options: {
      active: (conversationId: string) => boolean;
      notify: (preview: Preview) => Promise<void>;
      flush: () => Promise<void>;
      onError: (error: unknown) => void;
      onOverflow?: () => void;
      clock?: ConstructorParameters<
        typeof LatestSnapshotDelivery<Preview>
      >[0]["clock"];
      timers?: ConstructorParameters<
        typeof LatestSnapshotDelivery<Preview>
      >[0]["timers"];
    },
  ) {
    this.#delivery = new LatestSnapshotDelivery({
      intervalMs: 50,
      maxItems: 256,
      maxBytes: 16 * 1024 * 1024,
      clock: options.clock,
      timers: options.timers,
      onError: options.onError,
      onOverflow: options.onOverflow,
      send: async (preview) => {
        if (!options.active(preview.conversationId)) return;
        await options.notify(preview);
        // notify merely enqueues; the barrier must complete before publishing
        // authoritative facts (the session otherwise drains durable first).
        await options.flush();
      },
    });
  }

  snapshot(conversationId: string, delta: ArgumentDelta): void {
    if (this.#disposed || !this.options.active(conversationId)) return;
    for (const id of this.#turns.keys()) {
      if (!this.options.active(id)) this.#turns.delete(id);
    }
    const turn = this.#turns.get(conversationId);
    if (turn?.closed && (turn.id === "" || turn.id === delta.turnId)) return;
    if (turn?.id !== delta.turnId) {
      this.#delivery.drop((key) => key.startsWith(keyPrefix(conversationId)));
      if (!turn && this.#turns.size >= 256) {
        this.#overflow();
        return;
      }
      this.#turns.set(conversationId, { id: delta.turnId, closed: false });
    }
    const key =
      keyPrefix(conversationId) +
      JSON.stringify([delta.turnId, delta.contentIndex, delta.providerCallId]);
    const bytes =
      512 +
      2 *
        (key.length +
          conversationId.length +
          delta.turnId.length +
          delta.providerCallId.length +
          delta.name.length +
          delta.partialArgsText.length);
    this.#delivery.snapshot(key, { conversationId, delta }, bytes);
  }

  enqueue(run: () => Promise<void>, bytes: number): void {
    this.#delivery.enqueue(run, bytes);
  }

  publish(
    conversationId: string,
    event: ConversationEvent,
    run: () => Promise<void>,
  ): void {
    if (this.#disposed) return;
    const bytes = JSON.stringify(event).length * 2;
    if (event.type === "assistant_message") {
      const turn = this.#turns.get(conversationId);
      if (turn?.id === event.turnId) turn.closed = true;
      else if (
        event.turnId &&
        this.options.active(conversationId) &&
        this.#turns.size < 256
      )
        this.#turns.set(conversationId, { id: event.turnId, closed: true });
      this.#delivery.fence(
        (key) => key.startsWith(keyPrefix(conversationId)),
        run,
        bytes,
      );
      return;
    }
    if (
      event.type === "system_event" &&
      event.payload.subtype === "execution_state"
    ) {
      const transition = event.payload.transition;
      if (transition === "retrying" || transition === "started")
        this.invalidate(conversationId, false);
      else if (
        ["completed", "cancelled", "failed", "interrupted"].includes(transition)
      )
        this.invalidate(conversationId);
    }
    this.enqueue(run, bytes);
  }

  invalidate(conversationId: string, close = true): void {
    if (this.#disposed) return;
    this.#delivery.drop((key) => key.startsWith(keyPrefix(conversationId)));
    if (!this.options.active(conversationId)) {
      this.#turns.delete(conversationId);
      return;
    }
    const turn = this.#turns.get(conversationId);
    if (turn) {
      turn.closed = close;
      // Teardown blocks every turn until an explicit start/retry reopens it.
      if (close) turn.id = "";
    } else if (close) {
      if (this.#turns.size >= 256) this.#overflow();
      else this.#turns.set(conversationId, { id: "", closed: true });
    }
  }

  #overflow(): void {
    this.dispose();
    if (this.options.onOverflow) this.options.onOverflow();
    else
      this.options.onError(new Error("Outgoing argument ownership overflow"));
  }

  dispose(): void {
    this.#disposed = true;
    this.#delivery.dispose();
    this.#turns.clear();
  }
}
