import {
  RUN_STATE_EPOCH,
  type RunInteractionRecord,
} from "@nervekit/contracts";
import type { RunCheckpointReferencePort } from "@nervekit/host-runtime";
import type { SandboxRunUnitOfWork } from "../agent/run-transition-store.js";
import type { HarnessFactory } from "../agent/harness-factory.js";

export interface HarnessConversationRef {
  cursor: number;
  entryIds: string[];
  harnessLeafId: string | null;
  harnessSavePointId: string;
}

/**
 * Derives the canonical transcript/tool-call/interaction references used both
 * to build checkpoints (from the execution adapter) and to validate them (via
 * the coordinator). Entry ids and tool-call revisions come from the canonical
 * transition log; harness leaf/save-point come from conversation storage.
 * Both sides share this derivation so a checkpoint validates iff nothing has
 * changed since it was written.
 */
export class SandboxRunReferences implements RunCheckpointReferencePort {
  constructor(
    private readonly unitOfWork: SandboxRunUnitOfWork,
    private readonly harnessFactory: HarnessFactory,
  ) {}

  stateEpoch(): number {
    return RUN_STATE_EPOCH;
  }

  loadRun(runId: string) {
    return this.unitOfWork.load(runId);
  }

  async transcript(runId: string): Promise<HarnessConversationRef> {
    const state = await this.unitOfWork.load(runId);
    const entryIds = state
      ? state.transitions.flatMap((transition) =>
          transition.entries.map((entry) => entry.id),
        )
      : [];
    const conversation = state
      ? await this.harnessFactory.openOrCreateConversation(
          state.run.conversationId,
          state.run.agentId,
        )
      : undefined;
    const leafId = (await conversation?.getLeafId()) ?? null;
    return {
      cursor: entryIds.length,
      entryIds,
      harnessLeafId: leafId,
      harnessSavePointId: `savepoint_${leafId ?? "root"}`,
    };
  }

  async toolCalls(runId: string): Promise<
    readonly {
      toolCallId: string;
      lifecycleRevision: number;
      status: string;
    }[]
  > {
    const state = await this.unitOfWork.load(runId);
    if (!state) return [];
    // The transcript record has no explicit lifecycle sequence, so the stable
    // per-call revision is its occurrence count across the transition log.
    const counts = new Map<string, number>();
    const status = new Map<string, string>();
    for (const transition of state.transitions) {
      for (const call of transition.toolCalls) {
        counts.set(call.id, (counts.get(call.id) ?? 0) + 1);
        status.set(call.id, call.status);
      }
    }
    return [...counts.entries()].map(([toolCallId, lifecycleRevision]) => ({
      toolCallId,
      lifecycleRevision,
      status: status.get(toolCallId) ?? "completed",
    }));
  }

  async interaction(
    interactionId: string,
  ): Promise<RunInteractionRecord | undefined> {
    const state = await this.unitOfWork.findByInteractionId(interactionId);
    return state?.interactions.find((item) => item.id === interactionId);
  }

  /**
   * Finds an interaction by its provider toolCallId (the id a re-running tool
   * knows). Works for every wait kind since the interaction record carries the
   * originating toolCallId regardless of its own id.
   */
  async interactionByToolCall(
    toolCallId: string,
  ): Promise<RunInteractionRecord | undefined> {
    const state = await this.unitOfWork.findByInteractionToolCallId(toolCallId);
    if (!state) return undefined;
    let latest: RunInteractionRecord | undefined;
    for (const item of state.interactions) {
      if (item.toolCallId === toolCallId) latest = item;
    }
    return latest;
  }
}
