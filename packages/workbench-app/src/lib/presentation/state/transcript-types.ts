import type {
  ToolCall,
  ToolCallResponsePayload,
  ToolCallOutcome,
  ToolCallState,
} from "@nervekit/contracts/core";
/** Presentation coordinates no longer carry agent IDs or run IDs. */
export interface CoreToolCard {
  id?: string;
  providerCallId?: string;
  conversationId: string;
  turnId?: string;
  contentIndex?: number;
  toolName: string;
  argsPreview: unknown;
  resultPreview?: ToolCallResponsePayload["result"];
  state: ToolCallState | ToolCallOutcome | "drafting";
  statusLabel: string;
  interaction?: ToolCall["interaction"];
  supervision?: ToolCall["supervision"];
  createdAt?: string;
  updatedAt?: string;
  liveOutput?: string;
  partialArgsText?: string;
  cwd?: string;
}

export type CoreTimelineRow =
  | {
      kind: "message";
      key: string;
      item: {
        id: string;
        role: "user" | "assistant";
        text: string;
        preparedText?: string;
        previousEventId?: string | null;
        displayKind?: "thinking";
        redacted?: boolean;
        live?: boolean;
        createdAt?: string;
        turnId?: string;
        contentIndex?: number;
      };
    }
  | { kind: "tool"; key: string; toolCall: CoreToolCard }
  | {
      kind: "run_status";
      key: string;
      notice: {
        entryId: string;
        conversationId: string;
        state: "retrying" | "retry_exhausted" | "failed" | "interrupted";
        canContinue: boolean;
        attempt?: number;
        maxRetries?: number;
        delayMs?: number;
        retryAt?: string;
        errorMessage?: string;
        createdAt: string;
      };
    }
  | {
      kind: "compaction";
      key: string;
      notice: {
        id: string;
        state: "completed";
        summary: string;
        tokensBefore: number;
        firstKeptEntryId?: string;
        createdAt: string;
      };
    }
  | {
      kind: "task_event";
      key: string;
      notice: {
        entryId: string;
        conversationId: string;
        bashId: string;
        event: string;
        status: string;
        exitCode?: number;
        output: string;
        createdAt: string;
      };
    }
  | {
      kind: "system_event";
      key: string;
      notice: {
        entryId: string;
        kind: string;
        text: string;
        childConversationId?: string;
        createdAt: string;
      };
    };
