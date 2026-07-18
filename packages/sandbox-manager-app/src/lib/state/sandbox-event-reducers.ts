import {
  applySandboxStartupEvent as applySharedStartupEvent,
  type BoundedText,
  type SandboxToolCallSummary,
  type SandboxWaitSummary,
} from "@nervekit/contracts";
import type {
  SandboxDetailState,
  SandboxSetupTimelineItem,
  SandboxUiEvent,
} from "./sandbox-ui-types";

const MAX_EVENTS = 500;
const MAX_TIMELINE_TEXT = 8_000;

/**
 * Derive the agent's self-exit deadline when the disconnect event does not
 * carry `exitAt`, using the disconnect policy from `sandbox.config.loaded`.
 */
function fallbackDisconnectExitAt(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
): string | undefined {
  if (typeof detail.disconnectExitAfterMs !== "number") return undefined;
  const disconnectedAt = Date.parse(event.ts ?? "");
  if (!Number.isFinite(disconnectedAt)) return undefined;
  return new Date(disconnectedAt + detail.disconnectExitAfterMs).toISOString();
}

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

function bootPhaseDetail(data: Record<string, unknown>): string | undefined {
  const phase = typeof data.phase === "string" ? data.phase.trim() : "";
  return phase ? `Boot phase: ${phase}` : undefined;
}

function setupStatusFromEvent(
  data: Record<string, unknown>,
): SandboxSetupTimelineItem["status"] {
  if (
    data.status === "failed" ||
    data.status === "timeout" ||
    data.status === "skipped" ||
    data.status === "degraded"
  )
    return data.status;
  return "completed";
}

function bootCompletedDetail(
  data: Record<string, unknown>,
): string | undefined {
  const detail = bootPhaseDetail(data);
  if (data.status !== "failed" && data.status !== "timeout") return detail;
  const exitCode =
    typeof data.exitCode === "number" ? `exit ${data.exitCode}` : undefined;
  return [detail, exitCode].filter(Boolean).join(" · ") || undefined;
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
  if (!recordEvent(detail, event)) return;
  const data = asRecord(event.data);
  switch (event.type) {
    case "sandbox.startup.stage.started":
    case "sandbox.startup.stage.completed":
      applySharedStartupEvent(detail.setupTimeline, event);
      return;
    case "sandbox.config.loaded": {
      pushSetup(
        detail,
        event,
        "config",
        data.status === "degraded" ? "degraded" : "completed",
        "Config loaded",
        detailsFromData(data),
      );
      const disconnectPolicy = asRecord(
        asRecord(data.effectiveDefaults).disconnectPolicy,
      );
      if (typeof disconnectPolicy.exitAfterMs === "number")
        detail.disconnectExitAfterMs = disconnectPolicy.exitAfterMs;
      return;
    }
    case "sandbox.setup.git.started":
      pushSetup(
        detail,
        event,
        "git",
        "started",
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.git.completed":
      pushSetup(
        detail,
        event,
        "git",
        setupStatusFromEvent(data),
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.github.started":
      pushSetup(
        detail,
        event,
        "github",
        "started",
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.github.completed":
      pushSetup(
        detail,
        event,
        "github",
        setupStatusFromEvent(data),
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.boot.started":
      pushSetup(
        detail,
        event,
        "boot",
        "started",
        bootPhaseDetail(data),
        bootDetailsFromData(data),
      );
      return;
    case "sandbox.boot.completed":
      pushSetup(
        detail,
        event,
        "boot",
        setupStatusFromEvent(data),
        bootCompletedDetail(data),
        bootDetailsFromData(data),
      );
      return;
    case "sandbox.skills.loaded":
      pushSetup(
        detail,
        event,
        "skills",
        data.status === "failed"
          ? "failed"
          : data.status === "degraded"
            ? "degraded"
            : "completed",
        "Skills loaded",
        detailsFromData(data),
      );
      return;
    case "sandbox.ready":
      pushSetup(
        detail,
        event,
        "ready",
        "completed",
        "Sandbox ready",
        detailsFromData(data),
      );
      detail.controllerConnected = true;
      return;
    case "sandbox.controller.disconnected":
      detail.controllerConnected = false;
      detail.disconnectExitAt =
        typeof data.exitAt === "string"
          ? data.exitAt
          : (fallbackDisconnectExitAt(detail, event) ??
            detail.disconnectExitAt);
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
    case "run.waiting":
      if (data.waitKind === "approval")
        applyWaitingForApproval(detail, event, data);
      else if (data.waitKind === "plan_review")
        applyWaitingForPlanReview(detail, event, data);
      else applyWaitingForInput(detail, event, data);
      return;
    case "planReview.updated":
      applyPlanReviewResolved(detail, data);
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
    case "toolCall.updated":
      applyToolCall(detail, data);
      return;
    default:
      return;
  }
}

function recordEvent(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
): boolean {
  const isDuplicate = detail.events.some(
    (existing) =>
      existing.stream === event.stream &&
      existing.seq === event.seq &&
      (event.id ? existing.id === event.id : true),
  );
  if (isDuplicate) return false;
  detail.events.push(event);
  if (detail.events.length > MAX_EVENTS)
    detail.events.splice(0, detail.events.length - MAX_EVENTS);
  return true;
}

function pushSetup(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
  phase: string,
  status: SandboxSetupTimelineItem["status"],
  detailText?: string,
  extra: Partial<SandboxSetupTimelineItem> = {},
): void {
  const key = extra.key ?? setupTimelineKey(phase, event, extra);
  const existing = detail.setupTimeline.find((item) => item.key === key);
  const definedExtra = definedTimelineFields(extra);
  const next: SandboxSetupTimelineItem = {
    ...existing,
    ...definedExtra,
    key,
    phase,
    status,
    ts: event.ts,
    detail: detailText ?? extra.detail ?? existing?.detail,
  };
  if (next.startedAt && next.completedAt) {
    const durationMs =
      Date.parse(next.completedAt) - Date.parse(next.startedAt);
    if (Number.isFinite(durationMs) && durationMs >= 0)
      next.durationMs = durationMs;
  }
  if (existing) Object.assign(existing, next);
  else detail.setupTimeline.push(next);
}

function definedTimelineFields(
  extra: Partial<SandboxSetupTimelineItem>,
): Partial<SandboxSetupTimelineItem> {
  return Object.fromEntries(
    Object.entries(extra).filter(([, value]) => value !== undefined),
  ) as Partial<SandboxSetupTimelineItem>;
}

function setupTimelineKey(
  phase: string,
  event: SandboxUiEvent,
  extra: Partial<SandboxSetupTimelineItem>,
): string {
  if (phase === "boot") {
    const phaseKey =
      extra.index !== undefined ? String(extra.index) : extra.name;
    return `boot:${phaseKey ?? event.seq ?? event.id ?? event.ts}`;
  }
  return phase;
}

function detailsFromData(
  data: Record<string, unknown>,
): Partial<SandboxSetupTimelineItem> {
  return {
    startedAt: stringValue(data.startedAt),
    completedAt: stringValue(data.completedAt),
    error: errorText(data.error),
    limitations: stringArray(data.limitations),
  };
}

function bootDetailsFromData(
  data: Record<string, unknown>,
): Partial<SandboxSetupTimelineItem> {
  return {
    ...detailsFromData(data),
    name: stringValue(data.phase),
    index: numberValue(data.index),
    runAs:
      data.runAs === "root" || data.runAs === "sandbox"
        ? data.runAs
        : undefined,
    network:
      data.network === "inherit" ||
      data.network === "deny" ||
      data.network === "package_registries_only"
        ? data.network
        : undefined,
    timeoutMs: numberValue(data.timeoutMs),
    exitCode: numberValue(data.exitCode),
    stdout: boundedText(data.stdout),
    stderr: boundedText(data.stderr),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function errorText(value: unknown): string | undefined {
  const record = asRecord(value);
  const message = stringValue(record.message);
  if (!message) return undefined;
  const code = stringValue(record.code);
  return code ? `${code}: ${message}` : message;
}

function boundedText(value: unknown): BoundedText | undefined {
  const record = asRecord(value);
  const text = stringValue(record.text);
  if (!text) return undefined;
  if (text.length <= MAX_TIMELINE_TEXT) {
    return {
      text,
      truncated: Boolean(record.truncated),
      bytes: numberValue(record.bytes),
    };
  }
  return {
    text: text.slice(0, MAX_TIMELINE_TEXT),
    truncated: true,
    bytes: numberValue(record.bytes),
  };
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
  if (!detail.selectedConversationId && !detail.selectedPendingConversationId) {
    detail.selectedConversationId =
      String(data.conversationId ?? "") || undefined;
    detail.selectedAgentId = String(data.agentId ?? "") || undefined;
    detail.selectedRunId = runId;
  } else if (
    detail.selectedConversationId === String(data.conversationId ?? "")
  ) {
    detail.selectedAgentId = String(data.agentId ?? "") || undefined;
    detail.selectedRunId = runId;
  }
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
    conversationId:
      typeof data.conversationId === "string" ? data.conversationId : undefined,
    agentId: typeof data.agentId === "string" ? data.agentId : undefined,
    runId: String(data.runId ?? ""),
    role:
      (data.role as "user" | "assistant" | "system" | "tool") ?? "assistant",
    text: textOf(data.content),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
  });
  // Sequenced transcript supersedes best-effort notify text for the run.
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
  const toolCall = detail.toolCallsById[toolCallId];
  if (toolCall) toolCall.status = "waiting_for_input";
  const run = detail.liveRuns[String(data.runId ?? "")];
  if (run) run.status = "waiting_for_input";
}

function applyWaitingForPlanReview(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
  data: Record<string, unknown>,
): void {
  const waitId = String(data.reviewId ?? "");
  const toolCallId = String(data.toolCallId ?? "");
  if (!waitId || !toolCallId) return;
  detail.waitsById[waitId] = {
    waitId,
    kind: "plan_review",
    status: "waiting",
    toolCallId,
    planReview: data.planReview as SandboxWaitSummary["planReview"],
    createdAt: typeof data.createdAt === "string" ? data.createdAt : event.ts,
  };
  const toolCall = detail.toolCallsById[toolCallId];
  if (toolCall) toolCall.status = "waiting_for_input";
  const run = detail.liveRuns[String(data.runId ?? "")];
  if (run) run.status = "waiting_for_input";
}

function applyPlanReviewResolved(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
): void {
  const wait = detail.waitsById[String(data.reviewId ?? "")];
  if (!wait) return;
  wait.status = "submitted";
  wait.resolvedAt =
    typeof data.resolvedAt === "string" ? data.resolvedAt : wait.resolvedAt;
  if (data.planReview && typeof data.planReview === "object")
    wait.planReview = data.planReview as SandboxWaitSummary["planReview"];
}

function applyWaitingForApproval(
  detail: SandboxDetailState,
  event: SandboxUiEvent,
  data: Record<string, unknown>,
): void {
  const waitId = String(data.approvalId ?? "");
  if (!waitId) return;
  const toolCallId =
    typeof data.toolCallId === "string" ? data.toolCallId : undefined;
  detail.waitsById[waitId] = {
    waitId,
    kind: "approval",
    status: "waiting",
    toolCallId,
    risks: Array.isArray(data.risk) ? (data.risk as string[]) : undefined,
    reason: typeof data.reason === "string" ? data.reason : undefined,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : event.ts,
  };
  const toolCall = toolCallId ? detail.toolCallsById[toolCallId] : undefined;
  if (toolCall) toolCall.status = "waiting_for_approval";
  const run = detail.liveRuns[String(data.runId ?? "")];
  if (run) run.status = "waiting_for_approval";
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
  if (detail.stoppingRunId === runId) detail.stoppingRunId = undefined;
  // Resolve any waits attached to this run's tool calls on terminal.
  for (const wait of Object.values(detail.waitsById))
    if (wait.status === "waiting" && status !== "completed")
      wait.status = "cancelled";
}

function applyToolCall(
  detail: SandboxDetailState,
  data: Record<string, unknown>,
): void {
  const toolCall =
    data.toolCall && typeof data.toolCall === "object"
      ? (data.toolCall as Record<string, unknown>)
      : data;
  const toolCallId = String(toolCall.id ?? toolCall.toolCallId ?? "");
  if (!toolCallId) return;
  const existing = detail.toolCallsById[toolCallId];
  const summary: SandboxToolCallSummary = {
    toolCallId,
    toolName: String(toolCall.toolName ?? existing?.toolName ?? "tool"),
    status:
      (toolCall.status as SandboxToolCallSummary["status"]) ??
      existing?.status ??
      "requested",
    displayArgs: toolCall.argsPreview ?? existing?.displayArgs,
    artifactRefs:
      (toolCall.artifactRefs as SandboxToolCallSummary["artifactRefs"]) ??
      existing?.artifactRefs,
    turnId:
      typeof toolCall.turnId === "string" ? toolCall.turnId : existing?.turnId,
    liveMessageId:
      typeof toolCall.liveMessageId === "string"
        ? toolCall.liveMessageId
        : existing?.liveMessageId,
    contentIndex:
      typeof toolCall.contentIndex === "number"
        ? toolCall.contentIndex
        : existing?.contentIndex,
    error:
      (toolCall.error as SandboxToolCallSummary["error"]) ?? existing?.error,
    requestedAt:
      typeof toolCall.createdAt === "string"
        ? toolCall.createdAt
        : existing?.requestedAt,
    startedAt: existing?.startedAt,
    completedAt:
      typeof toolCall.updatedAt === "string" &&
      (toolCall.status === "completed" || toolCall.status === "error")
        ? toolCall.updatedAt
        : existing?.completedAt,
  };
  detail.toolCallsById[toolCallId] = summary;
  // Clear a resolved interaction/approval wait for this tool call.
  if (
    summary.status !== "waiting_for_approval" &&
    summary.status !== "waiting_for_input"
  )
    for (const wait of Object.values(detail.waitsById))
      if (wait.toolCallId === toolCallId && wait.status === "waiting")
        wait.status = wait.kind === "approval" ? "granted" : "submitted";
}
