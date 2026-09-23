import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import {
  RUN_STATE_EPOCH,
  type RunInteractionRecord,
  type RunRecord,
} from "@nervekit/contracts/runs";
import type { RunCheckpointReferencePort } from "../runtime/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { ConversationHarnessStorage } from "../../conversations/conversation-harness-storage.js";
import type { WorkbenchRunUnitOfWork } from "../persistence/run-transition.repository.js";

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
    const agent = this.state.getAgent(run.agentId);
    const storage =
      agent.executionKind === "async_developer"
        ? await this.harnessStorage.openAgentStorage(agent)
        : await this.harnessStorage.openStorage(conversation);
    const leafId = await storage.getLeafId();
    const entryIds = checkpointTranscriptEntryIds(runState.transitions);
    return {
      cursor: entryIds.length,
      entryIds,
      harnessLeafId: leafId,
      harnessSavePointId: `savepoint_${leafId ?? "root"}`,
    };
  }

  async authorizeHarnessLeafAdvance(input: {
    runId: string;
    fromLeafId: string | null;
    toLeafId: string | null;
  }): Promise<boolean> {
    if (input.fromLeafId === input.toLeafId || !input.toLeafId) return false;
    const runState = await this.unitOfWork.load(input.runId);
    if (!runState) return false;
    const run = runState.run;
    const conversation = this.state.getConversation(run.conversationId);
    const agent = this.state.getAgent(run.agentId);
    const storage =
      agent.executionKind === "async_developer"
        ? await this.harnessStorage.openAgentStorage(agent)
        : await this.harnessStorage.openStorage(conversation);
    try {
      const path = await storage.getPathToRoot(input.toLeafId);
      const notificationEntryIds = path.flatMap((entry) => {
        if (
          entry.type !== "message" ||
          entry.message.role !== "harness" ||
          !["task_event", "subagent_event"].includes(entry.message.eventType)
        ) {
          return [];
        }
        const id = stringValue(
          asRecord(entry.message.details)?.notificationEntryId,
        );
        return id ? [id] : [];
      });
      const projections = new Map(
        await Promise.all(
          notificationEntryIds.map(
            async (entryId) =>
              [
                entryId,
                await this.harnessStorage.getConversationEntry(
                  run.conversationId,
                  entryId,
                ),
              ] as const,
          ),
        ),
      );
      return isAuthorizedTaskEventAdvance(
        path,
        input.fromLeafId,
        run,
        (entryId) => projections.get(entryId),
      );
    } catch {
      return false;
    }
  }

  async toolCalls(runId: string) {
    const state = await this.unitOfWork.load(runId);
    if (!state) return [];
    const latest = new Map<string, { revision: number; status: string }>();
    for (const transition of state.transitions) {
      for (const call of transition.toolCalls) {
        const current = latest.get(call.id);
        if (!current || call.revision > current.revision) {
          latest.set(call.id, { revision: call.revision, status: call.status });
        }
      }
    }
    return [...latest.entries()].map(([toolCallId, value]) => ({
      toolCallId,
      revision: value.revision,
      status: value.status,
    }));
  }

  async interaction(
    interactionId: string,
  ): Promise<RunInteractionRecord | undefined> {
    const state = await this.unitOfWork.findByInteractionId(interactionId);
    return state?.interactions.find((item) => item.id === interactionId);
  }
}

export function checkpointTranscriptEntryIds(
  transitions: readonly { entries: readonly ConversationEntry[] }[],
): string[] {
  return transitions.flatMap((transition) =>
    transition.entries
      .filter((entry) => entry.kind !== "run_status")
      .map((entry) => entry.id),
  );
}

export function isAuthorizedTaskEventAdvance(
  path: readonly ConversationTreeEntry[],
  fromLeafId: string | null,
  run: RunRecord,
  projectionById: (entryId: string) => ConversationEntry | undefined,
): boolean {
  const ancestorIndex = fromLeafId
    ? path.findIndex((entry) => entry.id === fromLeafId)
    : -1;
  if (fromLeafId && ancestorIndex < 0) return false;
  const advanced = path.slice(ancestorIndex + 1);
  if (advanced.length === 0) return false;
  return advanced.every((entry) => {
    if (
      entry.type !== "message" ||
      entry.message.role !== "harness" ||
      !["task_event", "subagent_event"].includes(entry.message.eventType)
    ) {
      return false;
    }
    const details = asRecord(entry.message.details);
    const notificationEntryId = stringValue(details?.notificationEntryId);
    if (!notificationEntryId) return false;
    const projection = projectionById(notificationEntryId);
    const projectionDetails = asRecord(projection?.details);
    return (
      projection?.conversationId === run.conversationId &&
      projection.agentId === run.agentId &&
      projection.runId === run.runId &&
      projection.role === "system" &&
      (entry.message.eventType === "task_event"
        ? projection.kind === "task_event"
        : projection.kind === "subagent_run_event" ||
          projection.kind === "message") &&
      projectionDetails?.type === entry.message.eventType &&
      projectionDetails.source === "harness" &&
      projectionDetails.notificationEntryId === notificationEntryId
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
