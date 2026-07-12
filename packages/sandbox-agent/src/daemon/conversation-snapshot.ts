import type {
  ConversationEntry,
  ConversationSnapshot,
  ConversationTree,
  SandboxConfigV1,
  SandboxToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import {
  conversationSnapshotSchema,
  deriveConversationTitle,
  toolNameSchema,
} from "@nervekit/contracts";
import type { RunHydratedState } from "@nervekit/host-runtime";
import type { HarnessEventBridge } from "../agent/harness-event-bridge.js";
import type { RunManager } from "../agent/run-manager.js";
import type { RunState } from "../agent/run-state-store.js";
import { toolResultPreview } from "../agent/tool-result-preview.js";
import { sandboxSha256Digest } from "../state/hash.js";

export async function buildConversationSnapshot(input: {
  config: SandboxConfigV1;
  sandboxId?: string;
  instanceId: string;
  runs?: RunManager;
  bridge?: HarnessEventBridge;
  states?: readonly RunHydratedState[];
  cursorSeq?: number;
  conversationId?: string;
  agentId?: string;
  runId?: string;
}): Promise<ConversationSnapshot | undefined> {
  if (input.states) return buildProjectionSnapshot(input, input.states);
  const runs = (await input.runs?.list()) ?? [];
  const selectionRuns = runs.filter((run) => {
    if (input.conversationId && run.conversationId !== input.conversationId)
      return false;
    if (input.agentId && run.agentId !== input.agentId) return false;
    if (input.runId && run.runId !== input.runId) return false;
    return true;
  });
  const selected = latestRun(selectionRuns);
  if (!selected) return undefined;
  const conversationRuns = runs.filter((run) => {
    if (run.conversationId !== selected.conversationId) return false;
    if (input.agentId && run.agentId !== input.agentId) return false;
    return true;
  });
  const entries = await readConversationEntries(input.runs, conversationRuns);
  const toolCalls = await readToolCalls(input.runs, conversationRuns, input);
  const activeEntryId = entries.at(-1)?.id;
  const createdAt =
    conversationRuns
      .map((run) => run.createdAt)
      .filter(Boolean)
      .sort()[0] ??
    selected.createdAt ??
    selected.updatedAt;
  const updatedAt =
    conversationRuns
      .map((run) => run.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? selected.updatedAt;
  return conversationSnapshotSchema.parse({
    conversation: {
      id: selected.conversationId,
      projectId: projectId(input.sandboxId ?? input.instanceId),
      title: titleFor(entries, selected),
      mode: modeFor(selected, input.config),
      permissionLevel:
        input.config.agent.defaultPermissionLevel ?? "autonomous",
      approvalPolicy: { autoApproveReadOnly: true },
      activeAgentId: selected.agentId,
      activeEntryId,
      createdAt,
      updatedAt,
      lastUserMessageAt: entries.filter((entry) => entry.role === "user").at(-1)
        ?.createdAt,
    },
    entries,
    activeEntryIds: activeEntryId ? [activeEntryId] : [],
    tree: linearTree(selected.conversationId, entries, activeEntryId),
    toolCalls,
    activeRun: input.bridge?.activeRunSnapshot(selected.conversationId),
    contextUsage: undefined,
    cursorSeq: input.cursorSeq ?? 0,
    generatedAt: new Date().toISOString(),
  });
}

function buildProjectionSnapshot(
  input: {
    config: SandboxConfigV1;
    sandboxId?: string;
    instanceId: string;
    cursorSeq?: number;
    conversationId?: string;
    agentId?: string;
    runId?: string;
  },
  states: readonly RunHydratedState[],
): ConversationSnapshot | undefined {
  const selectedStates = states.filter((state) => {
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
  const conversationStates = states.filter(
    (state) =>
      state.run.conversationId === selected.run.conversationId &&
      (!input.agentId || state.run.agentId === input.agentId),
  );
  const entries = conversationStates
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
      title: firstUser ? deriveConversationTitle(firstUser) : "New conversation",
      mode:
        input.config.agent.defaultMode === "planning" ? "planning" : "coding",
      permissionLevel:
        input.config.agent.defaultPermissionLevel ?? "autonomous",
      approvalPolicy: { autoApproveReadOnly: true },
      activeAgentId: selected.run.agentId,
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
    activeRun: undefined,
    contextUsage: undefined,
    cursorSeq: input.cursorSeq ?? 0,
    generatedAt: new Date().toISOString(),
  });
}

function latestRun(runs: RunState[]): RunState | undefined {
  return [...runs]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
}

async function readConversationEntries(
  runs: RunManager | undefined,
  conversationRuns: RunState[],
): Promise<ConversationEntry[]> {
  const out: ConversationEntry[] = [];
  for (const run of conversationRuns) {
    const rows = await runs?.transcriptStore().read(run);
    for (const row of rows ?? []) {
      const entry = toConversationEntry(row, run);
      if (entry) out.push(entry);
    }
  }
  return out
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-200)
    .map((entry, index, entries) => ({
      ...entry,
      parentEntryId: index > 0 ? entries[index - 1]?.id : undefined,
    }));
}

function toConversationEntry(
  row: unknown,
  run: RunState,
): ConversationEntry | undefined {
  const record =
    row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const role = record.role;
  if (role !== "user" && role !== "assistant" && role !== "system")
    return undefined;
  const entryId =
    typeof record.entryId === "string" ? record.entryId : undefined;
  const content = record.content as { text?: unknown } | undefined;
  return {
    id: entryId?.startsWith("entry_")
      ? entryId
      : `entry_${entryId ?? Date.now()}`,
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
    turnId: typeof record.turnId === "string" ? record.turnId : undefined,
    liveMessageId:
      typeof record.liveMessageId === "string"
        ? record.liveMessageId
        : undefined,
    role,
    kind: "message",
    text: typeof content?.text === "string" ? content.text : "",
    details: record.details,
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt : run.updatedAt,
  };
}

async function readToolCalls(
  runs: RunManager | undefined,
  conversationRuns: RunState[],
  input: {
    config: SandboxConfigV1;
    sandboxId?: string;
    instanceId: string;
    bridge?: HarnessEventBridge;
  },
): Promise<ToolCallTranscriptRecord[]> {
  const out: ToolCallTranscriptRecord[] = [];
  for (const run of conversationRuns) {
    const records = await runs?.toolCallStore().latestByToolCallId(run);
    for (const record of records?.values() ?? []) {
      const converted = toToolCallTranscriptRecord(record, input);
      if (converted) out.push(converted);
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-100);
}

function toToolCallTranscriptRecord(
  record: SandboxToolCallRecord,
  input: {
    config: SandboxConfigV1;
    sandboxId?: string;
    instanceId: string;
    bridge?: HarnessEventBridge;
  },
): ToolCallTranscriptRecord | undefined {
  const name = toolNameSchema.safeParse(record.toolName);
  if (!name.success) return undefined;
  const createdAt = record.requestedAt;
  const updatedAt =
    record.completedAt ?? record.startedAt ?? record.requestedAt;
  const anchor = input.bridge?.resolveToolAnchor(
    record.runId,
    record.toolCallId,
  );
  return {
    id: normalizeToolCallId(record.toolCallId),
    sourceToolCallId: record.toolCallId,
    providerToolCallId: record.toolCallId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    projectId: projectId(input.sandboxId ?? input.instanceId),
    runId: record.runId,
    turnId: record.turnId ?? anchor?.turnId,
    liveMessageId: record.liveMessageId ?? anchor?.liveMessageId,
    contentIndex: record.contentIndex ?? anchor?.contentIndex,
    toolName: name.data,
    risk: defaultToolRisk(name.data),
    argsPreview: record.displayArgs,
    resultPreview: toolResultPreview(record.result),
    cwd: input.config.agent.workspaceRoot ?? process.cwd(),
    status: mapToolStatus(record.status),
    error: record.error?.message,
    errorDetails: record.error,
    createdAt,
    updatedAt,
  };
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

function titleFor(entries: ConversationEntry[], run: RunState): string {
  const firstUser = entries.find((entry) => entry.role === "user")?.text.trim();
  return firstUser
    ? deriveConversationTitle(firstUser)
    : `Sandbox conversation ${run.conversationId}`;
}

function modeFor(
  run: RunState,
  config: SandboxConfigV1,
): "coding" | "planning" {
  if (run.mode === "coding" || run.mode === "planning") return run.mode;
  return config.agent.defaultMode === "planning" ? "planning" : "coding";
}

function projectId(source: string): string {
  return `proj_sandbox_${sandboxSha256Digest(source).slice(7, 23)}`;
}

function normalizeToolCallId(toolCallId: string): string {
  if (toolCallId.startsWith("tool_")) return toolCallId;
  return `tool_${sandboxSha256Digest(toolCallId).slice(7, 23)}`;
}

function mapToolStatus(
  status: SandboxToolCallRecord["status"],
): ToolCallTranscriptRecord["status"] {
  if (status === "started") return "running";
  if (status === "failed") return "error";
  if (status === "waiting_for_input") return "waiting_for_user";
  if (status === "waiting_for_approval") return "pending_approval";
  if (status === "cancelled") return "denied";
  return status;
}

function defaultToolRisk(toolName: string): ToolCallTranscriptRecord["risk"] {
  if (toolName === "bash" || toolName === "python") return "command";
  if (toolName === "edit" || toolName === "write") return "workspace_write";
  if (
    toolName.startsWith("web_") ||
    toolName.includes("jira") ||
    toolName.includes("confluence")
  )
    return "network";
  if (toolName === "ask_user" || toolName === "plan_mode_present")
    return "interaction";
  if (toolName === "explore") return "agent_spawn";
  if (toolName.startsWith("task_")) return "command";
  return "read";
}
