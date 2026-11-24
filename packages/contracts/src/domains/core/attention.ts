import type { ConversationSummary } from "./conversation.js";

/*
 * Attention edges: which summary transitions of a root conversation deserve
 * the user's attention. One implementation for every surface (the bell,
 * desktop notifications, the mobile inbox and Web Push), so they cannot
 * disagree. See docs/architecture/conversation-state-and-attention.md.
 */

export type AttentionKind = "input" | "finished" | "failed" | "interrupted";
export type AttentionInputKind = NonNullable<
  ConversationSummary["pendingInput"]
>["kind"];
export type AttentionEdge = {
  kind: AttentionKind;
  inputKind?: AttentionInputKind;
};

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
  // Finished only once nothing is left: a turn that ends while sub-agents
  // still work is not finished.
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

/** Higher is more urgent: input > failure > finished. */
export function attentionUrgency(kind: AttentionKind): number {
  if (kind === "input") return 2;
  return kind === "finished" ? 0 : 1;
}

/** The most urgent event among coinciding ones (first wins ties). */
export function mostUrgent<T extends { kind: AttentionKind }>(
  events: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const event of events) {
    if (!best || attentionUrgency(event.kind) > attentionUrgency(best.kind)) {
      best = event;
    }
  }
  return best;
}

/**
 * Root-conversation baselines and edge selection. Baselines (list loads,
 * reconnects, daemon start) only record state, so old state is never replayed.
 * `suppressed` lets the caller drop the finished/interrupted edge that follows
 * the user's own Stop.
 */
export class AttentionEdgeTracker {
  readonly #previous = new Map<string, ConversationSummary>();

  constructor(
    private readonly suppressed: (
      conversationId: string,
      edge: AttentionEdge,
    ) => boolean = () => false,
  ) {}

  /** Replaces the baseline without reporting edges. */
  seed(rows: readonly ConversationSummary[]): void {
    this.reset();
    for (const row of rows)
      if (row.parentConversationId === null) this.#previous.set(row.id, row);
  }

  /** Forgets all baselines; the next summary per conversation is quiet. */
  reset(): void {
    this.#previous.clear();
  }

  forget(conversationId: string): void {
    this.#previous.delete(conversationId);
  }

  /** The edge this summary crosses, if any. */
  observe(summary: ConversationSummary): AttentionEdge | undefined {
    // Sub-agents surface through their root's pendingInput, never directly.
    if (summary.parentConversationId !== null) return undefined;
    const previous = this.#previous.get(summary.id);
    this.#previous.set(summary.id, summary);
    if (!previous) return undefined;
    const edge = mostUrgent(detectAttentionEdges(previous, summary));
    if (!edge) return undefined;
    if (
      (edge.kind === "finished" || edge.kind === "interrupted") &&
      this.suppressed(summary.id, edge)
    )
      return undefined;
    return edge;
  }
}
