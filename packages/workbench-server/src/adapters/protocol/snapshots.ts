import {
  conversationStream,
  WORKSPACE_STREAM,
} from "@nervekit/contracts/events";
import { type ConversationSnapshot } from "@nervekit/contracts/conversations";
import {
  type ConversationSnapshotResponse,
  type WorkspaceSnapshotResponse,
} from "@nervekit/contracts/snapshots";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeServices } from "../../app/bootstrap/create-runtime-services.js";

type SnapshotContext = {
  events: StreamLogRegistry;
  services: RuntimeServices;
};

export async function getWorkspaceSnapshotResponse(
  state: SnapshotContext,
): Promise<WorkspaceSnapshotResponse> {
  const captured = await state.events.withCursor(WORKSPACE_STREAM, () => ({
    projects: state.services.projectLifecycle.listProjects(),
    conversations: state.services.conversationLifecycle
      .listConversations()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    agents: state.services.agentLifecycle.listAgents(),
    tasks: state.services.tasks.listTasks(),
    pendingToolCalls: state.services.tools.listToolCallPreviews({
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
    state.services.conversationQuery.getConversationSnapshot(conversationId),
  );
  return {
    snapshot: { ...captured.value, cursorSeq: captured.cursor.processedSeq },
    cursor: { streams: [captured.cursor] },
    generatedAt: new Date().toISOString(),
  };
}
