import {
  COMPACTION_PROGRESS_PREVIEW_LINES,
  COMPACTION_PROGRESS_PREVIEW_MAX_CHARS,
  type ConversationCompactionReason,
} from "@nervekit/contracts/conversations";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";

export interface CompactionProgressContext {
  conversationId: string;
  agentId?: string;
  runId?: string;
  reason: ConversationCompactionReason;
}

export interface CompactionProgressPublisherOptions {
  /** Minimum delay between published snapshots. */
  intervalMs?: number;
  now?: () => number;
}

export interface CompactionProgressReport {
  /** 1 = first summarization request, 2 = structural-repair retry. */
  attempt: number;
  /** Accumulated summary text of the current attempt. */
  text: string;
}

const DEFAULT_INTERVAL_MS = 200;

/**
 * Publishes coalesced tail snapshots of the summary while compaction runs.
 * Snapshots are self-contained, so throttling and dropped intermediates stay
 * safe: the newest snapshot always fully describes what the UI must render.
 */
export class CompactionProgressPublisher {
  #sequence = 0;
  #lastPublishedAt = 0;
  #lastAttempt = 0;
  #lastPreview: string | undefined;
  #pending: CompactionProgressReport | undefined;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly events: StreamLogRegistry,
    private readonly context: CompactionProgressContext,
    private readonly options: CompactionProgressPublisherOptions = {},
  ) {}

  /** Records progress and publishes at most one snapshot per interval. */
  report(report: CompactionProgressReport): void {
    this.#pending = report;
    const intervalMs = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const now = (this.options.now ?? Date.now)();
    const attemptChanged =
      this.#lastAttempt !== 0 && report.attempt !== this.#lastAttempt;
    if (!attemptChanged && now - this.#lastPublishedAt < intervalMs) return;
    this.#publishPending(now);
  }

  /** Publishes the last pending snapshot and awaits outstanding publishes. */
  async flush(): Promise<void> {
    this.#publishPending((this.options.now ?? Date.now)());
    await this.#tail;
  }

  #publishPending(now: number): void {
    const pending = this.#pending;
    this.#pending = undefined;
    if (!pending) return;
    const text = pending.text;
    const preview = previewTail(text);
    if (!preview || preview === this.#lastPreview) return;
    this.#lastPreview = preview;
    this.#lastAttempt = pending.attempt;
    this.#lastPublishedAt = now;
    this.#sequence += 1;
    const data = {
      conversationId: this.context.conversationId,
      agentId: this.context.agentId,
      runId: this.context.runId,
      reason: this.context.reason,
      sequence: this.#sequence,
      attempt: pending.attempt,
      preview,
      generatedLines: countLogicalLines(text),
      generatedChars: text.length,
    };
    this.#tail = this.#tail
      .catch(() => undefined)
      .then(() =>
        this.events
          .publish("conversation.compaction.progress", data)
          .then(() => undefined)
          // Progress is best effort: it must never fail the compaction.
          .catch(() => undefined),
      );
  }
}

/**
 * Splits text into logical lines, treating one final LF as a terminator rather
 * than an additional empty line (same semantics as collapsed tool output).
 */
function splitLogicalLines(text: string): string[] {
  if (text.length === 0) return [];
  const content = text.endsWith("\n") ? text.slice(0, -1) : text;
  return content.split("\n");
}

function countLogicalLines(text: string): number {
  return splitLogicalLines(text).length;
}

/** Trailing preview lines, truncated from the front when still too long. */
function previewTail(text: string): string {
  const lines = splitLogicalLines(text.trimEnd());
  const tail = lines.slice(-COMPACTION_PROGRESS_PREVIEW_LINES).join("\n");
  return tail.length > COMPACTION_PROGRESS_PREVIEW_MAX_CHARS
    ? tail.slice(tail.length - COMPACTION_PROGRESS_PREVIEW_MAX_CHARS)
    : tail;
}
