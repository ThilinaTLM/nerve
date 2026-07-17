import type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationSnapshot,
  ConversationTree,
  SandboxConfigV1,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import {
  conversationSnapshotSchema,
  deriveConversationTitle,
} from "@nervekit/contracts";
import { ACTIVE_STATUSES, type RunHydratedState } from "@nervekit/host-runtime";

export async function buildConversationSnapshot(input: {
  config: SandboxConfigV1;
  instanceId: string;
  states: readonly RunHydratedState[];
  cursorSeq?: number;
  conversationId?: string;
  agentId?: string;
  runId?: string;
}): Promise<ConversationSnapshot | undefined> {
  const selectedStates = input.states.filter((state) => {
    const run = state.run;
    if (input.conversationId && run.conversationId !== input.conversationId)
      return false;
    if (input.agentId && run.agentId !== input.agentId) return false;
    if (input.runId && run.runId !== input.runId) return false;
    return true;
  });
  const selected = [...selectedStates]
    .sort((left, right) =>
      left.run.updatedAt.localeCompare(right.run.updatedAt),
    )
    .at(-1);
  if (!selected) return undefined;
  const conversationStates = input.states.filter(
    (state) =>
      state.run.conversationId === selected.run.conversationId &&
      (!input.agentId || state.run.agentId === input.agentId),
  );
  const entries: ConversationEntry[] = conversationStates
    .flatMap((state) =>
      state.transitions.flatMap((transition) => transition.entries),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-200)
    .map((entry, index, all) => ({
      ...entry,
      parentEntryId: index > 0 ? all[index - 1]?.id : undefined,
    }));
  const tools = new Map<string, ToolCallTranscriptRecord>();
  for (const state of conversationStates) {
    for (const transition of state.transitions) {
      for (const toolCall of transition.toolCalls) {
        tools.set(toolCall.id, toolCall);
      }
    }
  }
  const activeEntryId = entries.at(-1)?.id;
  const activeState = [...conversationStates]
    .filter((state) => ACTIVE_STATUSES.has(state.run.status))
    .sort((left, right) =>
      left.run.updatedAt.localeCompare(right.run.updatedAt),
    )
    .at(-1);
  const createdAt = conversationStates
    .map((state) => state.run.createdAt)
    .sort()[0]!;
  const updatedAt = conversationStates
    .map((state) => state.run.updatedAt)
    .sort()
    .at(-1)!;
  const firstUser = entries.find((entry) => entry.role === "user")?.text;
  return conversationSnapshotSchema.parse({
    conversation: {
      id: selected.run.conversationId,
      projectId: selected.run.projectId,
      title: firstUser
        ? deriveConversationTitle(firstUser)
        : "New conversation",
      mode:
        input.config.agent.defaultMode === "planning" ? "planning" : "coding",
      permissionLevel:
        input.config.agent.defaultPermissionLevel ?? "autonomous",
      approvalPolicy: { autoApproveReadOnly: true },
      activeAgentId: activeState?.run.agentId ?? selected.run.agentId,
      activeEntryId,
      createdAt,
      updatedAt,
      lastUserMessageAt: entries.filter((entry) => entry.role === "user").at(-1)
        ?.createdAt,
    },
    entries,
    activeEntryIds: activeEntryId ? [activeEntryId] : [],
    tree: linearTree(selected.run.conversationId, entries, activeEntryId),
    toolCalls: [...tools.values()],
    activeRun: activeState ? projectActiveRun(activeState) : undefined,
    contextUsage: undefined,
    cursorSeq: input.cursorSeq ?? 0,
    generatedAt: new Date().toISOString(),
  });
}

function projectActiveRun(
  state: RunHydratedState,
): ConversationActiveRunSnapshot {
  const run = state.run;
  return {
    runId: run.runId,
    agentId: run.agentId,
    projectId: run.projectId,
    conversationId: run.conversationId,
    status: conversationRunStatus(run.status),
    startedAt: run.startedAt ?? run.createdAt,
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: state.prompts.filter((prompt) =>
      ["queued", "accepted"].includes(prompt.status),
    ),
    recovery:
      run.status === "interrupted"
        ? {
            errorMessage: run.failure?.message,
            continuable: ["checkpoint", "retryable", "manual"].includes(
              run.recoverability,
            ),
          }
        : undefined,
  };
}

function conversationRunStatus(
  status: RunHydratedState["run"]["status"],
): ConversationActiveRunSnapshot["status"] {
  if (status === "retrying") return "retrying";
  if (status === "cancellation_requested" || status === "cancellation_failed")
    return "aborting";
  if (status === "interrupted") return "interrupted";
  return "running";
}

function linearTree(
  conversationId: string,
  entries: ConversationEntry[],
  activeEntryId?: string,
): ConversationTree {
  return {
    conversationId,
    activeEntryId,
    rootEntryIds: entries[0] ? [entries[0].id] : [],
    nodes: entries.map((entry, index) => ({
      entry,
      childEntryIds: entries[index + 1] ? [entries[index + 1].id] : [],
    })),
  };
}
