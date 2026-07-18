import {
  conversationStream,
  type ConversationSnapshot,
  type ConversationSnapshotResponse,
  type WorkspaceSnapshotResponse,
  WORKSPACE_STREAM,
} from "@nervekit/contracts";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { planReviewPreview } from "../domains/plans/plan-service.js";

export async function getWorkspaceSnapshotResponse(
  state: OrchestratorState,
): Promise<WorkspaceSnapshotResponse> {
  const captured = await state.events.withCursor(WORKSPACE_STREAM, () => ({
    projects: state.registry.listProjects(),
    conversations: state.registry
      .listConversations()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    agents: state.registry.listAgents(),
    tasks: state.registry.listTasks(),
    approvals: state.registry.tools.listApprovals("pending"),
    userQuestions: state.registry.listUserQuestions("pending"),
    planReviews: state.registry
      .listPlanReviews("pending")
      .map(planReviewPreview),
    workers: state.registry.listWorkers(),
  }));
  return {
    snapshot: captured.value,
    cursor: { streams: [captured.cursor] },
    generatedAt: new Date().toISOString(),
  };
}

export async function getConversationSnapshotResponse(
  state: OrchestratorState,
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
