import {
  AttentionEdgeTracker,
  conversationTitleToPlainText,
  type AttentionEdge,
  type AttentionKind,
  type ConversationSummary,
} from "@nervekit/contracts/core";
import type { AttentionEvent } from "$lib/application/notifications/attention-delivery.svelte";
import type { AttentionPresence } from "$lib/application/notifications/attention-policy";
import {
  clearSuppressedCompletion,
  consumeSuppressedCompletion,
} from "./user-stop";
import { pendingInputTitle } from "$lib/presentation/conversations/conversation-activity";

export type ConversationAttentionDeps = {
  deliver(event: AttentionEvent): void;
  presence(conversationId: string): AttentionPresence;
  projectName(projectId: string): string | undefined;
  open(conversationId: string): void;
  /** Session-local unseen results; pass a reactive set to observe it. */
  unseen: Set<string>;
  now?: () => number;
};

const titles = {
  finished: "Agent finished",
  failed: "Agent failed",
  interrupted: "Agent interrupted",
} as const;

/**
 * Turns live root-conversation summary edges into attention events. Baselines
 * (list loads, reconnects) only record state and never notify.
 */
export class ConversationAttention {
  private readonly edges: AttentionEdgeTracker;

  constructor(private readonly deps: ConversationAttentionDeps) {
    const now = deps.now ?? Date.now;
    this.edges = new AttentionEdgeTracker((conversationId) =>
      consumeSuppressedCompletion(conversationId, now()),
    );
  }

  /** Replaces the baseline without notifying. */
  seed(rows: readonly ConversationSummary[]): void {
    this.edges.seed(rows);
  }

  /** Forgets all baselines; the next summary per conversation is quiet. */
  reset(): void {
    this.edges.reset();
  }

  observe(summary: ConversationSummary): void {
    const edge = this.edges.observe(summary);
    if (!edge) return;
    if (
      edge.kind !== "input" &&
      this.deps.presence(summary.id) !== "watching"
    ) {
      this.deps.unseen.add(summary.id);
    }
    this.deps.deliver(this.event(summary, edge));
  }

  forget(conversationId: string): void {
    this.edges.forget(conversationId);
    clearSuppressedCompletion(conversationId);
    this.deps.unseen.delete(conversationId);
  }

  private event(
    summary: ConversationSummary,
    edge: AttentionEdge,
  ): AttentionEvent {
    const input = edge.kind === "input" ? summary.pendingInput : null;
    const target = input?.conversationId ?? summary.id;
    return {
      ...edge,
      conversationId: summary.id,
      title: input
        ? pendingInputTitle(summary.id, input)
        : titles[edge.kind as AttentionKind & keyof typeof titles],
      body: [
        this.deps.projectName(summary.projectId),
        conversationTitleToPlainText(summary.title),
      ]
        .filter(Boolean)
        .join(" · "),
      subAgentName:
        input && input.conversationId !== summary.id
          ? conversationTitleToPlainText(input.conversationTitle)
          : undefined,
      open: () => this.deps.open(target),
    };
  }
}
