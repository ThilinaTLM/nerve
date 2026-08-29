import {
  conversationStream,
  type ConversationSnapshot,
  type ConversationSnapshotResponse,
  type WorkspaceSnapshotResponse,
  WORKSPACE_STREAM,
} from "@nervekit/contracts";
import type { WorkbenchState } from "../../app/runtime/server-runtime.js";

type SnapshotContext = Pick<WorkbenchState, "events" | "registry">;

export async function getWorkspaceSnapshotResponse(
  state: SnapshotContext,
): Promise<WorkspaceSnapshotResponse> {
  const captured = await state.events.withCursor(WORKSPACE_STREAM, () => ({
    projects: state.registry.listProjects(),
    conversations: state.registry
      .listConversations()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    agents: state.registry.listAgents(),
    tasks: state.registry.listTasks(),
    pendingToolCalls: state.registry.tools.listToolCallPreviews({
      status: "waiting",
      limit: 1_000,
    }),
  }));
  return {
    snapshot: captured.value,
    cursor: { streams: [captured.cursor] },
    generatedAt: new Date().toISOString(),
  };
}

export async function getConversationSnapshotResponse(
  state: SnapshotContext,
  conversationId: string,
): Promise<ConversationSnapshotResponse<ConversationSnapshot>> {
  const stream = conversationStream(conversationId);
  const captured = await state.events.withCursor(stream, () =>
    state.registry.getConversationSnapshot(conversationId),
  );
  return {
    snapshot: { ...captured.value, cursorSeq: captured.cursor.processedSeq },
    cursor: { streams: [captured.cursor] },
    generatedAt: new Date().toISOString(),
  };
}
