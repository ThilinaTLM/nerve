import type {
  AgentRecord,
  ApprovalRecord,
  ConversationRecord,
  PlanReviewRecord,
  ProjectRecord,
  SnapshotCursor,
  TaskRecord,
  UserQuestionRecord,
  WorkerRecord,
} from "@nervekit/shared";
import { protocolRequest } from "../../../core/protocol/http-client";

export type WorkspaceSnapshot = {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  userQuestions: UserQuestionRecord[];
  planReviews: PlanReviewRecord[];
  workers?: WorkerRecord[];
};

export type WorkspaceSnapshotResponse = {
  snapshot: WorkspaceSnapshot;
  cursor: SnapshotCursor;
};

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshotResponse> {
  const { result: response } = await protocolRequest<WorkspaceSnapshotResponse>(
    "snapshot.workspace.get",
    {},
  );
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      conversations: [...response.snapshot.conversations].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    },
  };
}
