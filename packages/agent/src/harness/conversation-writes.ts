import type { AgentMessage } from "../types.js";
import type { Conversation } from "./conversation/conversation.js";
import type { AgentHarnessPhase, PendingConversationWrite } from "./events.js";

export function queueOrWriteMessage(
  phase: AgentHarnessPhase,
  pendingWrites: PendingConversationWrite[],
  conversation: Conversation,
  message: AgentMessage,
): Promise<void> | void {
  if (phase === "idle")
    return conversation.appendMessage(message).then(() => undefined);
  pendingWrites.push({ type: "message", message });
}

export async function flushPendingConversationWrites(
  conversation: Conversation,
  pendingWrites: PendingConversationWrite[],
): Promise<void> {
  while (pendingWrites.length > 0) {
    const write = pendingWrites[0];
    if (!write) break;
    if (write.type === "message") {
      await conversation.appendMessage(write.message);
    } else if (write.type === "model_change") {
      await conversation.appendModelChange(write.provider, write.modelId);
    } else if (write.type === "thinking_level_change") {
      await conversation.appendThinkingLevelChange(write.thinkingLevel);
    } else if (write.type === "active_tools_change") {
      await conversation.appendActiveToolsChange(write.activeToolNames);
    } else if (write.type === "custom") {
      await conversation.appendCustomEntry(write.customType, write.data);
    } else if (write.type === "custom_message") {
      await conversation.appendCustomMessageEntry(
        write.customType,
        write.content,
        write.display,
        write.details,
      );
    } else if (write.type === "label") {
      await conversation.appendLabel(write.targetId, write.label);
    } else if (write.type === "conversation_info") {
      await conversation.appendConversationName(write.name ?? "");
    } else if (write.type === "leaf") {
      await conversation.getStorage().setLeafId(write.targetId);
    }
    pendingWrites.shift();
  }
}
