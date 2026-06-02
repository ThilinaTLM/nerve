import type { AgentMessage } from "../types.js";
import type { AgentHarnessPhase, PendingSessionWrite } from "./events.js";
import type { Session } from "./session/session.js";

export function queueOrWriteMessage(
  phase: AgentHarnessPhase,
  pendingWrites: PendingSessionWrite[],
  session: Session,
  message: AgentMessage,
): Promise<void> | void {
  if (phase === "idle")
    return session.appendMessage(message).then(() => undefined);
  pendingWrites.push({ type: "message", message });
}

export async function flushPendingSessionWrites(
  session: Session,
  pendingWrites: PendingSessionWrite[],
): Promise<void> {
  while (pendingWrites.length > 0) {
    const write = pendingWrites[0];
    if (!write) break;
    if (write.type === "message") {
      await session.appendMessage(write.message);
    } else if (write.type === "model_change") {
      await session.appendModelChange(write.provider, write.modelId);
    } else if (write.type === "thinking_level_change") {
      await session.appendThinkingLevelChange(write.thinkingLevel);
    } else if (write.type === "active_tools_change") {
      await session.appendActiveToolsChange(write.activeToolNames);
    } else if (write.type === "custom") {
      await session.appendCustomEntry(write.customType, write.data);
    } else if (write.type === "custom_message") {
      await session.appendCustomMessageEntry(
        write.customType,
        write.content,
        write.display,
        write.details,
      );
    } else if (write.type === "label") {
      await session.appendLabel(write.targetId, write.label);
    } else if (write.type === "session_info") {
      await session.appendSessionName(write.name ?? "");
    } else if (write.type === "leaf") {
      await session.getStorage().setLeafId(write.targetId);
    }
    pendingWrites.shift();
  }
}
