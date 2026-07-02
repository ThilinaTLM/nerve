import type { EventOutbox } from "../state/event-outbox.js";
import type { RunState } from "./run-state-store.js";

export class HarnessEventBridge {
  constructor(private readonly events?: EventOutbox) {}

  async delta(run: RunState, text: string): Promise<void> {
    await this.events?.append({
      type: "run.delta",
      durability: "durable",
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      data: {
        delta: text.length > 16_000 ? `${text.slice(0, 16_000)}…` : text,
      },
    });
  }

  async terminal(
    run: RunState,
    status: "completed" | "failed" | "cancelled",
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events?.append({
      type:
        status === "completed"
          ? "run.completed"
          : status === "cancelled"
            ? "run.cancelled"
            : "run.failed",
      durability: "durable",
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      data: { status, ...data },
    });
  }
}
