import type {
  ConversationSnapshot,
  ConversationSnapshotResponse,
  WorkspaceSnapshotResponse,
} from "@nervekit/contracts";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { planReviewPreview } from "../domains/plans/plan-service.js";
import { GLOBAL_STREAM } from "./constants.js";

export function protocolSnapshotCursor(state: OrchestratorState) {
  return {
    streams: [
      { stream: GLOBAL_STREAM, processedSeq: state.events.latestDurableSeq },
    ],
  };
}

export function getWorkspaceSnapshotResponse(
  state: OrchestratorState,
): WorkspaceSnapshotResponse {
  const snapshot = {
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
  };
  return {
    snapshot,
    cursor: protocolSnapshotCursor(state),
    generatedAt: new Date().toISOString(),
  };
}

export async function getConversationSnapshotResponse(
  state: OrchestratorState,
  conversationId: string,
): Promise<ConversationSnapshotResponse<ConversationSnapshot>> {
  const snapshot = await state.registry.getConversationSnapshot(conversationId);
  return {
    snapshot,
    cursor: protocolSnapshotCursor(state),
    generatedAt: new Date().toISOString(),
  };
}
