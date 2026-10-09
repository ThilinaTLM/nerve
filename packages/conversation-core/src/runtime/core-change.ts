import type {
  AsyncBash,
  ConversationConfig,
  ConversationEvent,
  ConversationSummary,
  LiveDelta,
  QueuedInput,
  ToolCall,
} from "@nervekit/contracts/core";

export type CoreChange =
  | { kind: "event_appended"; conversationId: string; event: ConversationEvent }
  | { kind: "head_changed"; conversationId: string; headEventId: string | null }
  | { kind: "conversation_changed"; summary: ConversationSummary }
  | {
      kind: "config_changed";
      conversationId: string;
      config: ConversationConfig;
    }
  | {
      kind: "tool_call_changed";
      conversationId: string;
      toolCall: ToolCall | { id: string; removed: true };
    }
  | { kind: "queue_changed"; conversationId: string; queue: QueuedInput[] }
  | {
      kind: "async_bash_changed";
      conversationId: string;
      asyncBash: AsyncBash[];
    }
  | { kind: "conversation_deleted"; conversationId: string }
  | { kind: "live"; conversationId: string; delta: LiveDelta };
export type CoreEmitter = (change: CoreChange) => void;
