import { conversationTitleToPlainText } from "@nervekit/contracts/core";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { AttentionEvent } from "$lib/application/notifications/attention-delivery.svelte";
import {
  mostUrgent,
  type AttentionKind,
  type AttentionPresence,
} from "$lib/application/notifications/attention-policy";
import {
  clearSuppressedCompletion,
  consumeSuppressedCompletion,
} from "./user-stop";
import { pendingInputTitle } from "$lib/presentation/conversations/conversation-activity";

export type AttentionEdge = Pick<AttentionEvent, "kind" | "inputKind">;

const isBusy = (row: ConversationSummary): boolean =>
  row.status === "running" || row.status === "waiting" || row.pendingWork;

/** Edges between two summaries of the same root conversation. */
export function detectAttentionEdges(
  previous: ConversationSummary,
  next: ConversationSummary,
): AttentionEdge[] {
  const edges: AttentionEdge[] = [];
  if (
    next.pendingInput &&
    previous.pendingInput?.toolCallId !== next.pendingInput.toolCallId
  ) {
    edges.push({ kind: "input", inputKind: next.pendingInput.kind });
  }
  if (
    isBusy(previous) &&
    next.status === "idle" &&
    !next.pendingWork &&
    !next.pendingInput
  ) {
    edges.push({ kind: "finished" });
  }
  if (next.status === "failed" && previous.status !== "failed") {
    edges.push({ kind: "failed" });
  }
  if (next.status === "interrupted" && previous.status !== "interrupted") {
    edges.push({ kind: "interrupted" });
  }
  return edges;
}

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
  private readonly previous = new Map<string, ConversationSummary>();
  private readonly now: () => number;

  constructor(private readonly deps: ConversationAttentionDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Replaces the baseline without notifying. */
  seed(rows: readonly ConversationSummary[]): void {
    this.reset();
    for (const row of rows) {
      if (row.parentConversationId === null) this.previous.set(row.id, row);
    }
  }

  /** Forgets all baselines; the next summary per conversation is quiet. */
  reset(): void {
    this.previous.clear();
  }

  observe(summary: ConversationSummary): void {
    // Sub-agents surface through their root's pendingInput, never directly.
    if (summary.parentConversationId !== null) return;
    const previous = this.previous.get(summary.id);
    this.previous.set(summary.id, summary);
    if (!previous) return;
    const edge = mostUrgent(detectAttentionEdges(previous, summary));
    if (!edge) return;
    if (
      (edge.kind === "finished" || edge.kind === "interrupted") &&
      consumeSuppressedCompletion(summary.id, this.now())
    ) {
      return;
    }
    if (
      edge.kind !== "input" &&
      this.deps.presence(summary.id) !== "watching"
    ) {
      this.deps.unseen.add(summary.id);
    }
    this.deps.deliver(this.event(summary, edge));
  }

  forget(conversationId: string): void {
    this.previous.delete(conversationId);
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
