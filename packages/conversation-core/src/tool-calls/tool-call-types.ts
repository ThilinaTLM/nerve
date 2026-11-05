import type {
  ConversationConfig,
  ConversationEvent,
  ToolCall,
  ToolProgress,
} from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { PermissionPort, ToolHostPort } from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { CoreToolHandler } from "./core-tool.js";
import type { AsyncBashAdopter } from "./background-promotion.js";

export type ToolCallChange =
  | { kind: "event_appended"; conversationId: string; event: ConversationEvent }
  | {
      kind: "tool_call_changed";
      conversationId: string;
      toolCall: ToolCall | { id: string; removed: true };
    }
  | {
      kind: "live";
      conversationId: string;
      delta: {
        type: "tool_progress";
        toolCallId: string;
        update: ToolProgress;
      };
    };
export interface ToolCallServiceOptions {
  inputs?: InputQueueService;
  storage: CoreStorage;
  assets: AssetStore;
  permissions: PermissionPort;
  host: ToolHostPort;
  emit(change: ToolCallChange): void;
  // Runs after the response append and row deletion have committed.
  onSettled?(conversationId: string): void;
  coreTools: Map<string, CoreToolHandler>;
  asyncBash: AsyncBashAdopter;
  context(
    conversationId: string,
  ):
    | { projectDir: string; config: ConversationConfig }
    | Promise<{ projectDir: string; config: ConversationConfig }>;
}
