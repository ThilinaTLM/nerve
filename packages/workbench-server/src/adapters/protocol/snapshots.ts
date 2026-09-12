import {
  conversationStream,
  WORKSPACE_STREAM,
} from "@nervekit/contracts/events";
import { type ConversationSnapshot } from "@nervekit/contracts/conversations";
import {
  type ConversationSnapshotResponse,
  type WorkspaceSnapshotResponse,
} from "@nervekit/contracts/snapshots";
import type { ServerAdapterContexts } from "../../app/bootstrap/create-server-adapter-contexts.js";

type SnapshotContext = ServerAdapterContexts["snapshot"];

export async function getWorkspaceSnapshotResponse(
  state: SnapshotContext,
): Promise<WorkspaceSnapshotResponse> {
  const captured = await state.events.withCursor(
    WORKSPACE_STREAM,
    async () => ({
      projects: state.projectLifecycle.listProjects(),
      conversations: state.conversationLifecycle
        .listConversations()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      agents: state.agentLifecycle.listAgents(),
      tasks: state.tasks.listTasks(),
      pendingToolCalls: await state.tools.listToolCallPreviews({
        status: "waiting",
        limit: 1_000,
      }),
    }),
  );
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
    state.conversationQuery.getConversationSnapshot(conversationId),
  );
  return {
    snapshot: { ...captured.value, cursorSeq: captured.cursor.processedSeq },
    cursor: { streams: [captured.cursor] },
    generatedAt: new Date().toISOString(),
  };
}
