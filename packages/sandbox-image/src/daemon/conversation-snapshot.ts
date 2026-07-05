import type {
  ConversationEntry,
  ConversationSnapshot,
  ConversationTree,
  SandboxConfigV1,
  SandboxToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";
import { conversationSnapshotSchema, toolNameSchema } from "@nervekit/shared";
import type { HarnessEventBridge } from "../agent/harness-event-bridge.js";
import type { RunManager } from "../agent/run-manager.js";
import type { RunState } from "../agent/run-state-store.js";
import { sandboxSha256Digest } from "../state/hash.js";

export async function buildConversationSnapshot(input: {
  config: SandboxConfigV1;
  instanceId: string;
  runs?: RunManager;
  bridge?: HarnessEventBridge;
  cursorSeq?: number;
  conversationId?: string;
  agentId?: string;
  runId?: string;
}): Promise<ConversationSnapshot | undefined> {
  const allRuns = ((await input.runs?.list()) ?? []).filter((run) => {
    if (input.conversationId && run.conversationId !== input.conversationId)
      return false;
    if (input.agentId && run.agentId !== input.agentId) return false;
    if (input.runId && run.runId !== input.runId) return false;
    return true;
  });
  const selected = latestRun(allRuns);
  if (!selected) return undefined;
  const conversationRuns = allRuns.filter(
    (run) => run.conversationId === selected.conversationId,
  );
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
      projectId: projectId(input.config, input.instanceId),
      title: titleFor(entries, selected),
      mode: input.config.agent.mode === "planning" ? "planning" : "coding",
      permissionLevel: input.config.agent.permissionLevel ?? "autonomous",
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
    role,
    kind: "message",
    text: typeof content?.text === "string" ? content.text : "",
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt : run.updatedAt,
  };
}

async function readToolCalls(
  runs: RunManager | undefined,
  conversationRuns: RunState[],
  input: { config: SandboxConfigV1; instanceId: string },
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
  input: { config: SandboxConfigV1; instanceId: string },
): ToolCallTranscriptRecord | undefined {
  const name = toolNameSchema.safeParse(record.toolName);
  if (!name.success) return undefined;
  const createdAt = record.requestedAt;
  const updatedAt =
    record.completedAt ?? record.startedAt ?? record.requestedAt;
  return {
    id: normalizeToolCallId(record.toolCallId),
    sourceToolCallId: record.toolCallId,
    providerToolCallId: record.toolCallId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    projectId: projectId(input.config, input.instanceId),
    runId: record.runId,
    toolName: name.data,
    risk: defaultToolRisk(name.data),
    argsPreview: record.displayArgs,
    resultPreview: record.result,
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
    ? firstUser.slice(0, 80)
    : `Sandbox conversation ${run.conversationId}`;
}

function projectId(config: SandboxConfigV1, instanceId: string): string {
  const source = config.identity?.sandboxId ?? instanceId;
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
  if (toolName === "ask_user") return "interaction";
  if (toolName === "explore") return "agent_spawn";
  if (toolName.startsWith("task_")) return "command";
  return "read";
}
