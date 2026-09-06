import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { ConversationRemovalOptions } from "../conversations/conversation-deletion-progress.js";
import type { MaintenanceExecution } from "../maintenance/maintenance-execution.js";
import type { ProjectLifecycleService } from "./project.service.js";
export class ProjectRemovalExecutor {
  constructor(
    private readonly deps: {
      projects: ProjectLifecycleService;
      listConversations(): ConversationRecord[];
      removeConversation(
        id: string,
        options?: ConversationRemovalOptions,
      ): Promise<void>;
    },
  ) {}
  async execute(
    projectId: string,
    execution: MaintenanceExecution,
  ): Promise<void> {
    const conversations = this.deps
      .listConversations()
      .filter((conversation) => conversation.projectId === projectId);
    await execution.report({
      phase: "removing_conversations",
      totalItems: conversations.length,
      message: "Removing project conversations…",
    });
    let completedItems = 0;
    for (const conversation of conversations) {
      await this.deps.removeConversation(conversation.id, {
        operationId: execution.operationId,
        onProgress: (currentItem) => execution.report({ currentItem }),
      });
      await execution.report({
        completedItems: ++completedItems,
        removedConversationCount: completedItems,
        currentItem: undefined,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await execution.report({
      phase: "finalizing",
      currentItem: undefined,
      message: "Removing project metadata…",
    });
    await this.deps.projects.finalizeProjectRemoval(projectId);
    await execution.report({
      result: {
        kind: "delete_project",
        projectId,
        removedConversationCount: completedItems,
      },
    });
  }
}
