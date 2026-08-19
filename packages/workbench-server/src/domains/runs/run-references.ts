import {
  RUN_STATE_EPOCH,
  type RunInteractionRecord,
} from "@nervekit/contracts";
import type { RunCheckpointReferencePort } from "./runtime/index.js";
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
    const latest = new Map<
      string,
      { revision: number; status: string; workerExecutionId?: string }
    >();
    for (const transition of state.transitions) {
      for (const call of transition.toolCalls) {
        const current = latest.get(call.id);
        if (!current || call.revision > current.revision) {
          latest.set(call.id, {
            revision: call.revision,
            status: call.status,
            workerExecutionId: call.workerExecutionId,
          });
        }
      }
    }
    return [...latest.entries()].map(([toolCallId, value]) => ({
      toolCallId,
      revision: value.revision,
      status: value.status,
      workerExecutionId: value.workerExecutionId,
    }));
  }

  async interaction(
    interactionId: string,
  ): Promise<RunInteractionRecord | undefined> {
    const state = await this.unitOfWork.findByInteractionId(interactionId);
    return state?.interactions.find((item) => item.id === interactionId);
  }
}
