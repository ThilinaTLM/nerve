import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  deriveConversationTitle,
  type SandboxAgentRelationshipRecord,
  type SandboxToolCallSummary,
  type SandboxTranscriptSummaryEntry,
  type SandboxRunStatus,
} from "@nervekit/contracts";

import { Redactor } from "../security/redaction.js";

export type RunLike = {
  conversationId: string;
  agentId: string;
  runId?: string;
  status?: string;
  updatedAt: string;
  createdAt?: string;
  terminalAt?: string;
  mode?: unknown;
  behavior?: unknown;
  prompt?: unknown;
  error?: unknown;
  lastCheckpointId?: unknown;
  transcript?: SandboxTranscriptSummaryEntry[];
  toolCalls?: SandboxToolCallSummary[];
  checkpoints?: Array<{
    checkpointId: string;
    status: SandboxRunStatus;
    createdAt: string;
    summary?: unknown;
  }>;
  executions?: Array<{
    executionId: string;
    attempt: number;
    status: string;
    startedAt: string;
    completedAt?: string;
    recoverability?: string;
    error?: { code: string; message: string; retryable?: boolean };
    lastCheckpointId?: string;
  }>;
};

export function summarizeConversations(runs: RunLike[]) {
  const summaries = new Map<
    string,
    {
      conversationId: string;
      agentIds: string[];
      title?: string;
      mode?: "coding" | "planning";
      createdAt?: string;
      updatedAt: string;
      activeRunIds: string[];
    }
  >();
  for (const run of runs) {
    const current = summaries.get(run.conversationId) ?? {
      conversationId: run.conversationId,
      agentIds: [],
      mode: modeOf(run),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      activeRunIds: [],
    };
    if (!current.agentIds.includes(run.agentId))
      current.agentIds.push(run.agentId);
    if (!current.title && typeof run.prompt === "string" && run.prompt.trim())
      current.title = deriveConversationTitle(run.prompt);
    const mode = modeOf(run);
    if (mode && (!current.mode || run.updatedAt >= current.updatedAt))
      current.mode = mode;
    if (
      !current.createdAt ||
      (run.createdAt && run.createdAt < current.createdAt)
    )
      current.createdAt = run.createdAt;
    if (
      run.runId &&
      run.status &&
      !["completed", "failed", "cancelled"].includes(run.status)
    )
      current.activeRunIds.push(run.runId);
    if (run.updatedAt > current.updatedAt) current.updatedAt = run.updatedAt;
    summaries.set(run.conversationId, current);
  }
  return Array.from(summaries.values());
}

function modeOf(run: RunLike): "coding" | "planning" | undefined {
  return run.mode === "coding" || run.mode === "planning"
    ? run.mode
    : undefined;
}

export function summarizeAgents(runs: RunLike[], model?: unknown) {
  const agents = new Map<
    string,
    {
      conversationId: string;
      agentId: string;
      model?: unknown;
      updatedAt?: string;
    }
  >();
  for (const run of runs) {
    const key = `${run.conversationId}/${run.agentId}`;
    const current = agents.get(key) ?? {
      conversationId: run.conversationId,
      agentId: run.agentId,
      model,
      updatedAt: run.updatedAt,
    };
    if (!current.updatedAt || run.updatedAt > current.updatedAt)
      current.updatedAt = run.updatedAt;
    agents.set(key, current);
  }
  return Array.from(agents.values());
}

export async function summarizeRuns(
  runs: RunLike[],
  waits: unknown[] = [],
  stateDir?: string,
) {
  return Promise.all(
    runs.map(async (run) => {
      const scope = run.runId
        ? {
            conversationId: run.conversationId,
            agentId: run.agentId,
            runId: run.runId,
          }
        : undefined;
      const transcript = scope ? run.transcript?.slice(-20) : undefined;
      const toolCalls = scope ? run.toolCalls?.slice(-50) : undefined;
      const checkpoints = scope ? run.checkpoints?.slice(-20) : undefined;
      const projectionExecutions = run.executions;
      const latestExecution = projectionExecutions?.at(-1);
      const childAgents = scope
        ? await readChildAgents(stateDir, scope).then((entries) =>
            entries.slice(-20),
          )
        : [];
      const tasks = scope
        ? await readTasks(stateDir, scope).then((entries) => entries.slice(-20))
        : [];
      return {
        conversationId: run.conversationId,
        agentId: run.agentId,
        runId: run.runId ?? "run_unknown",
        status: normalizeRunStatus(run.status),
        behavior:
          run.behavior === "follow_up" || run.behavior === "steer"
            ? run.behavior
            : "start",
        promptSummary:
          typeof run.prompt === "string" && run.prompt
            ? run.prompt.slice(0, 120)
            : undefined,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        terminalAt: run.terminalAt,
        error: isRedactedError(run.error) ? run.error : undefined,
        transcriptRefs: run.runId
          ? [`transcript://${run.conversationId}/${run.agentId}/${run.runId}`]
          : undefined,
        toolCallRefs: run.runId
          ? [`tools://${run.conversationId}/${run.agentId}/${run.runId}`]
          : undefined,
        checkpointRefs: checkpoints?.map(
          (checkpoint) => checkpoint.checkpointId,
        ),
        lastCheckpointId:
          typeof run.lastCheckpointId === "string"
            ? run.lastCheckpointId
            : checkpoints?.at(-1)?.checkpointId,
        recoverability:
          latestExecution?.recoverability ??
          (run.status === "recoverable_failed" ? "retryable" : undefined),
        waits: run.runId ? summarizeWaitsForRun(waits, run.runId) : undefined,
        transcript,
        toolCalls,
        checkpoints: checkpoints?.map((checkpoint) => ({
          checkpointId: checkpoint.checkpointId,
          status: checkpoint.status,
          createdAt: checkpoint.createdAt,
          summary: checkpoint.summary,
        })),
        executions: projectionExecutions?.map((execution) => ({
          executionId: execution.executionId,
          attempt: execution.attempt,
          status: execution.status,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          recoverability: execution.recoverability,
          error: execution.error,
          lastCheckpointId: execution.lastCheckpointId,
        })),
        childAgents: childAgents.length ? childAgents : undefined,
        tasks: tasks.length ? tasks : undefined,
        continueEligible:
          run.status === "waiting_for_input" ||
          run.status === "waiting_for_approval" ||
          (run.status === "recoverable_failed" &&
            (latestExecution?.error?.retryable === true ||
              latestExecution?.recoverability === "retryable")),
      };
    }),
  );
}

async function readChildAgents(
  stateDir: string | undefined,
  scope: { conversationId: string; agentId: string; runId: string },
) {
  if (!stateDir) return [];
  const dir = path.join(
    stateDir,
    "conversations",
    safe(scope.conversationId),
    "agents",
    safe(scope.agentId),
    "relationships",
  );
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const records: SandboxAgentRelationshipRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const record = JSON.parse(
        await readFile(path.join(dir, entry), "utf8"),
      ) as SandboxAgentRelationshipRecord;
      if (record.parentRunId === scope.runId) records.push(record);
    } catch {
      // Ignore corrupt relationship summaries.
    }
  }
  return records
    .sort((a, b) =>
      String(a.updatedAt ?? a.createdAt).localeCompare(
        String(b.updatedAt ?? b.createdAt),
      ),
    )
    .map((record) => ({
      conversationId: record.conversationId,
      parentAgentId: record.parentAgentId,
      childAgentId: record.childAgentId,
      parentRunId: record.parentRunId,
      childRunId: record.childRunId,
      relationship: record.relationship,
      depth: record.depth,
      label: record.label,
      status: record.status,
      summary: record.summary,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
}

async function readTasks(
  stateDir: string | undefined,
  scope: { conversationId: string; agentId: string; runId: string },
) {
  if (!stateDir) return [];
  const root = path.join(stateDir, "tasks");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const redactor = new Redactor();
  const tasks: Array<{
    taskId: string;
    name?: string;
    commandSummary?: string;
    status:
      | "queued"
      | "running"
      | "completed"
      | "failed"
      | "cancelled"
      | "orphaned";
    startedAt?: string;
    completedAt?: string;
    exitCode?: number;
    logRef?: string;
    logBytes?: number;
    truncated?: boolean;
  }> = [];
  for (const entry of entries) {
    try {
      const file = path.join(root, entry, "state.json");
      const stored = JSON.parse(await readFile(file, "utf8")) as Record<
        string,
        unknown
      >;
      const task = (stored.task ?? stored) as Record<string, unknown>;
      const origin = task.origin as Record<string, unknown> | undefined;
      if (
        task.conversationId !== scope.conversationId ||
        task.agentId !== scope.agentId ||
        origin?.runId !== scope.runId
      )
        continue;
      const logPath = path.join(root, entry, "logs.txt");
      const logBytes = await stat(logPath)
        .then((value) => value.size)
        .catch(() => undefined);
      tasks.push({
        taskId: String(task.id ?? entry),
        name: typeof task.name === "string" ? task.name : undefined,
        commandSummary:
          typeof task.command === "string"
            ? redactor.redactText(task.command).slice(0, 200)
            : undefined,
        status: normalizeTaskStatus(task.status),
        startedAt:
          typeof task.startedAt === "string" ? task.startedAt : undefined,
        completedAt:
          typeof task.finishedAt === "string" ? task.finishedAt : undefined,
        exitCode: typeof task.exitCode === "number" ? task.exitCode : undefined,
        logRef: typeof stored.logRef === "string" ? stored.logRef : undefined,
        logBytes,
        truncated: stored.truncated === true ? true : undefined,
      });
    } catch {
      // Ignore corrupt task summaries.
    }
  }
  return tasks.sort((a, b) =>
    String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")),
  );
}

function summarizeWaitsForRun(waits: unknown[], runId: string) {
  const summaries = waits
    .filter((wait) => (wait as { runId?: unknown }).runId === runId)
    .map((wait) => {
      const value = wait as Record<string, unknown>;
      if (typeof value.requestId === "string") {
        return {
          waitId: value.requestId,
          kind: "input" as const,
          status: normalizeWaitStatus(value.status),
          question: value.question,
          toolCallId: value.requestId,
          createdAt: String(value.createdAt ?? new Date().toISOString()),
          resolvedAt:
            typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
        };
      }
      const review = value.review as Record<string, unknown> | undefined;
      if (review && typeof review.id === "string") {
        return {
          waitId: review.id,
          kind: "plan_review" as const,
          status:
            value.status === "pending"
              ? ("waiting" as const)
              : ("submitted" as const),
          toolCallId:
            typeof value.providerToolCallId === "string"
              ? value.providerToolCallId
              : undefined,
          planReview: review,
          createdAt: String(value.createdAt ?? new Date().toISOString()),
          resolvedAt:
            typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
        };
      }
      return {
        waitId: String(value.approvalId ?? value.id ?? "approval_unknown"),
        kind: "approval" as const,
        status: normalizeWaitStatus(value.status),
        toolCallId:
          typeof value.toolCallId === "string" ? value.toolCallId : undefined,
        approvalScope:
          value.selectedScope === "single_call" ||
          value.selectedScope === "same_tool_same_args" ||
          value.selectedScope === "run"
            ? value.selectedScope
            : undefined,
        risks: Array.isArray(value.risk) ? (value.risk as string[]) : undefined,
        reason: typeof value.reason === "string" ? value.reason : undefined,
        createdAt: String(value.createdAt ?? new Date().toISOString()),
        resolvedAt:
          typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
      };
    });
  return summaries.length ? summaries : undefined;
}

function normalizeWaitStatus(status: unknown) {
  if (
    status === "waiting" ||
    status === "submitted" ||
    status === "granted" ||
    status === "denied" ||
    status === "cancelled" ||
    status === "expired"
  )
    return status;
  return "waiting" as const;
}

function normalizeTaskStatus(status: unknown) {
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "orphaned"
  )
    return status;
  return "failed" as const;
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function normalizeRunStatus(status: string | undefined): SandboxRunStatus {
  if (
    status === "queued" ||
    status === "running" ||
    status === "waiting_for_input" ||
    status === "waiting_for_approval" ||
    status === "completed" ||
    status === "failed" ||
    status === "recoverable_failed" ||
    status === "cancelled"
  )
    return status;
  return "failed";
}

function isRedactedError(
  value: unknown,
): value is { code: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
