import {
  RUN_STATE_EPOCH,
  type RunInteractionRecord,
} from "@nervekit/contracts";
import type { RunCheckpointReferencePort } from "@nervekit/host-runtime";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

export class WorkbenchRunReferences implements RunCheckpointReferencePort {
  constructor(
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
    private readonly harnessStorage: ConversationHarnessStorage,
    private readonly state: RuntimeState,
  ) {}

  stateEpoch(): number {
    return RUN_STATE_EPOCH;
  }

  loadRun(runId: string) {
    return this.unitOfWork.load(runId);
  }

  async transcript(runId: string) {
    const runState = await this.unitOfWork.load(runId);
    if (!runState) {
      return {
        cursor: 0,
        entryIds: [] as string[],
        harnessLeafId: null,
        harnessSavePointId: "savepoint_root",
      };
    }
    const run = runState.run;
    const conversation = this.state.getConversation(run.conversationId);
    const project = this.state.getProject(run.projectId);
    const storage = await this.harnessStorage.openStorage(
      conversation,
      project.dir,
    );
    const leafId = await storage.getLeafId();
    const entryIds = runState.transitions.flatMap((transition) =>
      transition.entries.map((entry) => entry.id),
    );
    return {
      cursor: entryIds.length,
      entryIds,
      harnessLeafId: leafId,
      harnessSavePointId: `savepoint_${leafId ?? "root"}`,
    };
  }

  async toolCalls(runId: string) {
    const state = await this.unitOfWork.load(runId);
    if (!state) return [];
    const counts = new Map<string, number>();
    const statuses = new Map<string, string>();
    for (const transition of state.transitions) {
      for (const call of transition.toolCalls) {
        counts.set(call.id, (counts.get(call.id) ?? 0) + 1);
        statuses.set(call.id, call.status);
      }
    }
    return [...counts.entries()].map(([toolCallId, lifecycleRevision]) => ({
      toolCallId,
      lifecycleRevision,
      status: statuses.get(toolCallId) ?? "completed",
    }));
  }

  async interaction(
    interactionId: string,
  ): Promise<RunInteractionRecord | undefined> {
    for (const state of await this.unitOfWork.list()) {
      const interaction = state.interactions.find(
        (item) => item.id === interactionId,
      );
      if (interaction) return interaction;
    }
    return undefined;
  }
}
