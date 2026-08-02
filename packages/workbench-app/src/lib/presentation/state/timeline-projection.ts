import type {
  ConversationEntry,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { TranscriptItem } from "./transcript-types.js";
import { buildCommittedTimeline, type CommittedTimeline } from "./timeline.js";
import { entriesToTranscript } from "./transcript.js";

export type CommittedTimelineProjectionInput = {
  entries: ConversationEntry[];
  optimisticMessages: TranscriptItem[];
  toolCalls: ToolCallTranscriptRecord[];
  includeUnanchoredTerminalToolCalls: boolean;
};

/**
 * Identity-keyed durable timeline projection.
 *
 * Live active-run snapshots change on every visual commit. The durable source
 * arrays do not, so retaining this memo outside a Svelte derived prevents a
 * growing conversation history from being rebuilt for each streamed token.
 */
export class CommittedTimelineProjection {
  private entries?: ConversationEntry[];
  private optimisticMessages?: TranscriptItem[];
  private toolCalls?: ToolCallTranscriptRecord[];
  private includeUnanchoredTerminalToolCalls?: boolean;
  private committed?: CommittedTimeline;

  project(input: CommittedTimelineProjectionInput): CommittedTimeline {
    if (
      this.committed &&
      this.entries === input.entries &&
      this.optimisticMessages === input.optimisticMessages &&
      this.toolCalls === input.toolCalls &&
      this.includeUnanchoredTerminalToolCalls ===
        input.includeUnanchoredTerminalToolCalls
    ) {
      return this.committed;
    }

    this.entries = input.entries;
    this.optimisticMessages = input.optimisticMessages;
    this.toolCalls = input.toolCalls;
    this.includeUnanchoredTerminalToolCalls =
      input.includeUnanchoredTerminalToolCalls;
    this.committed = buildCommittedTimeline(
      [...entriesToTranscript(input.entries), ...input.optimisticMessages],
      input.toolCalls,
      {
        includeUnanchoredTerminalToolCalls:
          input.includeUnanchoredTerminalToolCalls,
      },
    );
    return this.committed;
  }
}
