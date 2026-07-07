import type {
  SandboxToolCallSummary,
  SandboxWaitSummary,
} from "@nervekit/shared";
import type { SandboxDetailState, SandboxUiEvent } from "./sandbox-ui-types";

const MAX_EVENTS = 500;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  const record = asRecord(value);
  if (typeof record.text === "string") return record.text;
  if (typeof value === "string") return value;
  return "";
}

/**
 * Apply a single sandbox-stream event envelope to a sandbox detail state.
 * Reducers stay tolerant of unknown/future event types and never require
 * the sandbox daemon payload schemas to succeed.
 */
export function applySandboxEvent(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
): void {
  recordEvent(detail, event);
  const data = asRecord(event.data);
  switch (event.type) {
    case "sandbox.config.loaded":
      pushSetup(detail, event, "config", "completed", "Config loaded");
      return;
    case "sandbox.setup.git.started":
      pushSetup(detail, event, "git", "started");
      return;
    case "sandbox.setup.git.completed":
      pushSetup(detail, event, "git", "completed");
      return;
    case "sandbox.setup.github.started":
      pushSetup(detail, event, "github", "started");
      return;
    case "sandbox.setup.github.completed":
      pushSetup(detail, event, "github", "completed");
      return;
    case "sandbox.boot.started":
      pushSetup(detail, event, "boot", "started");
      return;
    case "sandbox.boot.completed":
      pushSetup(detail, event, "boot", "completed");
      return;
    case "sandbox.skills.loaded":
      pushSetup(detail, event, "skills", "completed", "Skills loaded");
      return;
    case "sandbox.ready":
      pushSetup(detail, event, "ready", "completed", "Sandbox ready");
      detail.controllerConnected = true;
      return;
    case "sandbox.controller.disconnected":
      detail.controllerConnected = false;
      detail.disconnectExitAt =
        typeof data.exitAt === "string" ? data.exitAt : detail.disconnectExitAt;
      return;
    case "sandbox.controller.reconnected":
      detail.controllerConnected = true;
      detail.disconnectExitAt = undefined;
      return;
    case "sandbox.shutdown.scheduled":
    case "sandbox.shutdown.started":
      detail.disconnectExitAt =
        typeof data.exitAt === "string" ? data.exitAt : detail.disconnectExitAt;
      return;
    case "run.started":
      applyRunStarted(detail, data);
      return;
    case "run.delta":
      applyRunDelta(detail, data);
      return;
    case "run.transcript.appended":
      applyTranscriptAppended(detail, data);
      return;
    case "run.waiting_for_input":
      applyWaitingForInput(detail, event, data);
      return;
    case "run.waiting_for_approval":
      applyWaitingForApproval(detail, event, data);
      return;
    case "run.completed":
      applyRunTerminal(detail, data, "completed");
      return;
    case "run.failed":
      applyRunTerminal(detail, data, "failed");
      return;
    case "run.cancelled":
      applyRunTerminal(detail, data, "cancelled");
      return;
    case "tool.call.requested":
    case "tool.call.started":
    case "tool.call.completed":
    case "tool.call.failed":
    case "tool.call.cancelled":
      applyToolCall(detail, data);
      return;
    default:
      return;
  }
}

function recordEvent(detail: SandboxDetailState, event: SandboxUiEvent): void {
  const isDuplicate = detail.events.some(
    (existing) =>
      existing.stream === event.stream &&
      existing.seq === event.seq &&
      (event.id ? existing.id === event.id : true),
  );
  if (isDuplicate) return;
  detail.events.push(event);
  if (detail.events.length > MAX_EVENTS)
    detail.events.splice(0, detail.events.length - MAX_EVENTS);
}

function pushSetup(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
  phase: string,
  status: "started" | "completed" | "failed" | "skipped" | "degraded",
  detailText?: string,
): void {
  detail.setupTimeline.push({
    key: `${phase}:${status}:${event.seq}`,
    phase,
    status,
    ts: event.ts,
    detail: detailText,
  });
}

function applyRunStarted(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
): void {
  const runId = String(data.runId ?? "");
  if (!runId) return;
  // A run only starts when the controller session is live.
  detail.controllerConnected = true;
  detail.liveRuns[runId] = {
    runId,
    conversationId: String(data.conversationId ?? ""),
    agentId: String(data.agentId ?? ""),
    status: String(data.status ?? "running"),
    deltaText: detail.liveRuns[runId]?.deltaText ?? "",
    updatedAt: typeof data.startedAt === "string" ? data.startedAt : undefined,
  };
  detail.selectedConversationId ??=
    String(data.conversationId ?? "") || undefined;
  detail.selectedAgentId ??= String(data.agentId ?? "") || undefined;
  detail.selectedRunId = runId;
}

function applyRunDelta(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
): void {
  const runId = String(data.runId ?? "");
  if (!runId) return;
  const run = detail.liveRuns[runId] ?? {
    runId,
    conversationId: String(data.conversationId ?? ""),
    agentId: String(data.agentId ?? ""),
    status: "running",
    deltaText: "",
  };
  if (data.role === undefined || data.role === "assistant")
    run.deltaText += typeof data.text === "string" ? data.text : "";
  detail.liveRuns[runId] = run;
}

function applyTranscriptAppended(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
): void {
  const entryId = String(data.entryId ?? "");
  if (!entryId) return;
  if (detail.appendedTranscript.some((entry) => entry.entryId === entryId))
    return;
  detail.appendedTranscript.push({
    entryId,
    runId: String(data.runId ?? ""),
    role:
      (data.role as "user" | "assistant" | "system" | "tool") ?? "assistant",
    text: textOf(data.content),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
  });
  // Durable transcript supersedes transient streaming text for the run.
  const runId = String(data.runId ?? "");
  if (runId && data.role === "assistant" && detail.liveRuns[runId])
    detail.liveRuns[runId].deltaText = "";
}

function applyWaitingForInput(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
  data: Record<string, unknown>,
): void {
  const waitId = String(data.requestId ?? "");
  if (!waitId) return;
  // The ask-user tool suspends on its own tool-call id, and the daemon uses that
  // same id as the input `requestId`, so `waitId` doubles as the tool-call id.
  const toolCallId =
    typeof data.toolCallId === "string" ? data.toolCallId : waitId;
  const wait: SandboxWaitSummary = {
    waitId,
    kind: "input",
    status: "waiting",
    question: { text: textOf(data.question) },
    toolCallId,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : event.ts,
  };
  detail.waitsById[waitId] = wait;
}

function applyWaitingForApproval(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
  data: Record<string, unknown>,
): void {
  const waitId = String(data.approvalId ?? "");
  if (!waitId) return;
  detail.waitsById[waitId] = {
    waitId,
    kind: "approval",
    status: "waiting",
    toolCallId:
      typeof data.toolCallId === "string" ? data.toolCallId : undefined,
    risks: Array.isArray(data.risk) ? (data.risk as string[]) : undefined,
    reason: typeof data.reason === "string" ? data.reason : undefined,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : event.ts,
  };
}

function applyRunTerminal(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
  status: "completed" | "failed" | "cancelled",
): void {
  const runId = String(data.runId ?? "");
  if (!runId) return;
  const run = detail.liveRuns[runId];
  if (run) {
    run.status = status;
    run.deltaText = "";
  }
  // Resolve any waits attached to this run's tool calls on terminal.
  for (const wait of Object.values(detail.waitsById))
    if (wait.status === "waiting" && status !== "completed")
      wait.status = "cancelled";
}

function applyToolCall(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
): void {
  const toolCallId = String(data.toolCallId ?? "");
  if (!toolCallId) return;
  const existing = detail.toolCallsById[toolCallId];
  const summary: SandboxToolCallSummary = {
    toolCallId,
    toolName: String(data.toolName ?? existing?.toolName ?? "tool"),
    status:
      (data.status as SandboxToolCallSummary["status"]) ??
      existing?.status ??
      "requested",
    displayArgs: data.displayArgs ?? existing?.displayArgs,
    artifactRefs:
      (data.artifactRefs as SandboxToolCallSummary["artifactRefs"]) ??
      existing?.artifactRefs,
    error: (data.error as SandboxToolCallSummary["error"]) ?? existing?.error,
    requestedAt:
      typeof data.requestedAt === "string"
        ? data.requestedAt
        : existing?.requestedAt,
    startedAt:
      typeof data.startedAt === "string" ? data.startedAt : existing?.startedAt,
    completedAt:
      typeof data.completedAt === "string"
        ? data.completedAt
        : existing?.completedAt,
  };
  detail.toolCallsById[toolCallId] = summary;
  // Clear a resolved approval wait for this tool call.
  if (summary.status !== "waiting_for_approval")
    for (const wait of Object.values(detail.waitsById))
      if (
        wait.kind === "approval" &&
        wait.toolCallId === toolCallId &&
        wait.status === "waiting"
      )
        wait.status = "granted";
}
