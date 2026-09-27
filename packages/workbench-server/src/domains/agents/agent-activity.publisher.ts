import type {
  AgentActivitySnapshot,
  ConversationActivitySnapshot,
} from "@nervekit/contracts/agents";
import type { EventEnvelope } from "@nervekit/contracts/events";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { AgentActivityService } from "./agent-activity.service.js";

export interface AgentActivityPublisherPorts {
  activity: AgentActivityService;
  events: Pick<StreamLogRegistry, "publish" | "subscribe">;
  warn?(error: unknown): void;
}

/** Publishes complete replacement snapshots after canonical domain events commit. */
export class AgentActivityPublisher {
  private unsubscribe?: () => void;
  private tail = Promise.resolve();
  private readonly agents = new Map<string, string>();
  private readonly conversations = new Map<string, string>();

  constructor(private readonly ports: AgentActivityPublisherPorts) {}

  async start(): Promise<void> {
    const initial = await this.ports.activity.workspaceActivity();
    this.remember(initial.agentActivities, initial.conversationActivities);
    this.unsubscribe ??= this.ports.events.subscribe((event) => {
      if (!affectsActivity(event)) return;
      void this.refresh();
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.tail;
  }

  refresh(): Promise<void> {
    const next = this.tail.then(() => this.publishChanges());
    this.tail = next.catch((error) => this.ports.warn?.(error));
    return next;
  }

  private async publishChanges(): Promise<void> {
    const snapshot = await this.ports.activity.workspaceActivity();
    for (const activity of snapshot.agentActivities) {
      const encoded = JSON.stringify(activity);
      if (this.agents.get(activity.agentId) === encoded) continue;
      this.agents.set(activity.agentId, encoded);
      await this.ports.events.publish("agent.activity_changed", { activity });
    }
    for (const activity of snapshot.conversationActivities) {
      const encoded = JSON.stringify(activity);
      if (this.conversations.get(activity.conversationId) === encoded) continue;
      this.conversations.set(activity.conversationId, encoded);
      await this.ports.events.publish("conversation.activity_changed", {
        activity,
      });
    }
  }

  private remember(
    agents: readonly AgentActivitySnapshot[],
    conversations: readonly ConversationActivitySnapshot[],
  ): void {
    for (const activity of agents)
      this.agents.set(activity.agentId, JSON.stringify(activity));
    for (const activity of conversations)
      this.conversations.set(activity.conversationId, JSON.stringify(activity));
  }
}

function affectsActivity(event: EventEnvelope): boolean {
  if (
    event.type === "agent.activity_changed" ||
    event.type === "conversation.activity_changed"
  )
    return false;
  return (
    event.type.startsWith("run.") ||
    event.type.startsWith("interaction.") ||
    event.type === "conversation.updated" ||
    event.type === "conversation.entry.appended" ||
    event.type === "agent.created" ||
    event.type === "agent.configured"
  );
}
