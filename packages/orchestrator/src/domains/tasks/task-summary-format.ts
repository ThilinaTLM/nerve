import type {
  TaskCancelResultPayload,
  TaskLogEvent,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/shared";
import { formatListeningPort } from "./task-port-inspector.js";
import { isActiveTaskStatus } from "./task-status.js";

const MAX_COMMAND_PREVIEW = 120;
const MAX_ERROR_PREVIEW = 120;
const MAX_LOG_LINE = 220;

export function truncateTaskText(
  value: string,
  max = MAX_COMMAND_PREVIEW,
): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function taskLabel(task: TaskRecord): string {
  return task.name ? `${task.name} (${task.id})` : task.id;
}

export function taskCommandPreview(task: TaskRecord): string {
  return truncateTaskText(task.command, MAX_COMMAND_PREVIEW);
}

export function formatTaskPorts(task: TaskRecord): string | undefined {
  const ports = task.runtime?.listeningPorts;
  if (!ports || ports.length === 0) return undefined;
  return (
    ports.slice(0, 6).map(formatListeningPort).join(", ") +
    (ports.length > 6 ? ` (+${ports.length - 6} more)` : "")
  );
}

export function formatReadiness(task: TaskRecord): string | undefined {
  if (task.readiness.outcome === "none") return undefined;
  if (task.readiness.outcome === "timeout") {
    const duration = task.readiness.timeoutMs
      ? ` after ${task.readiness.timeoutMs}ms`
      : "";
    return isActiveTaskStatus(task.status)
      ? `readiness=timeout${duration} (task still running)`
      : `readiness=timeout${duration}`;
  }
  const matched = task.readiness.matched ?? task.readiness.readyUrl;
  return matched
    ? `readiness=${task.readiness.outcome} ${truncateTaskText(matched, 80)}`
    : `readiness=${task.readiness.outcome}`;
}

export function oneLineTaskSummary(
  task: TaskRecord,
  options: { nextCursor?: number; includeCommandForUnnamed?: boolean } = {},
): string {
  const parts = [`${taskLabel(task)}: ${task.status}`];
  const readiness = formatReadiness(task);
  if (readiness) parts.push(readiness);
  if (task.exitCode !== undefined) parts.push(`exit=${task.exitCode}`);
  if (task.signal) parts.push(`signal=${task.signal}`);
  if (options.nextCursor !== undefined)
    parts.push(`cursor=${options.nextCursor}`);
  const ports = formatTaskPorts(task);
  if (ports) parts.push(`ports=${ports}`);
  if (task.error)
    parts.push(`error=${truncateTaskText(task.error, MAX_ERROR_PREVIEW)}`);
  if (!task.name && options.includeCommandForUnnamed !== false) {
    parts.push(`cmd=${taskCommandPreview(task)}`);
  }
  return parts.join("; ");
}

export function formatLogEvent(event: TaskLogEvent): string {
  return `[${event.seq} ${event.stream} ${event.level}] ${truncateTaskText(event.line, MAX_LOG_LINE)}`;
}

export function formatTaskStartSummary(input: {
  tasks: TaskRecord[];
  groupId?: string;
  groupName?: string;
}): string {
  if (input.tasks.length === 0) return "No tasks started.";
  const lines = [
    `Started ${input.tasks.length} background ${input.tasks.length === 1 ? "task" : "tasks"}${input.groupId ? ` (group ${input.groupId})` : ""}.`,
  ];
  for (const task of input.tasks) {
    const readiness = formatReadiness(task);
    const bits = [
      `- ${task.name ?? taskCommandPreview(task)}: ${task.id} — ${task.status}`,
    ];
    if (readiness) bits.push(readiness);
    if (task.readiness.readyUrl)
      bits.push(`readyUrl=${task.readiness.readyUrl}`);
    const ports = formatTaskPorts(task);
    if (ports) bits.push(`ports=${ports}`);
    lines.push(bits.join("; "));
  }
  lines.push(
    "Task updates may arrive asynchronously. Use task_status/task_logs only if you need to inspect or debug.",
  );
  return lines.join("\n");
}

export function formatTaskStatusSummary(
  rows: Array<{ task: TaskRecord; logs?: TaskLogEvent[]; nextCursor?: number }>,
): string {
  if (rows.length === 0) return "No tasks found.";
  const lines = [`${rows.length} ${rows.length === 1 ? "task" : "tasks"}`];
  for (const row of rows) {
    lines.push(
      `- ${oneLineTaskSummary(row.task, { nextCursor: row.nextCursor })}`,
    );
    if (row.logs && row.logs.length > 0) {
      for (const event of row.logs) lines.push(`  ${formatLogEvent(event)}`);
    }
  }
  return lines.join("\n");
}

export function formatTaskCancelSummary(
  results: TaskCancelResultPayload[],
): string {
  if (results.length === 0) return "No active matching tasks to cancel.";
  return results.map((result) => `- ${result.message}`).join("\n");
}

export function formatTaskListSummary(tasks: TaskRecord[]): string {
  if (tasks.length === 0) return "No tasks found.";
  return tasks.map((task) => oneLineTaskSummary(task)).join("\n");
}

export function formatTaskLogsSummary(input: {
  task: TaskRecord;
  events: TaskLogEvent[];
  nextCursor: number;
  mode: string;
  autoSelected?: boolean;
}): string {
  const lines = [
    `${input.autoSelected ? "Auto-selected logs for" : "Logs for"} ${taskLabel(input.task)} (${input.task.status}); mode=${input.mode}; cursor=${input.nextCursor}`,
  ];
  if (input.events.length === 0) {
    lines.push("No matching log events.");
  } else {
    lines.push(...input.events.map(formatLogEvent));
  }
  lines.push(
    `Use task_logs({ taskId: "${input.task.name ?? input.task.id}", mode: "since_cursor", sinceSeq: ${input.nextCursor} }) later for more output if needed.`,
  );
  return lines.join("\n");
}

export function isTerminalTaskStatus(status: TaskRecord["status"]): boolean {
  return !isActiveTaskStatus(status);
}

export function taskEventTitle(task: TaskRecord, event: string): string {
  const label = task.name ? `${task.name} (${task.id})` : task.id;
  return `Background task ${label} ${event.replace("_", " ")}.`;
}

export function formatTaskEventSummary(input: {
  task: TaskRecord;
  event: string;
  logs?: TaskLogEvent[];
  nextCursor?: number;
}): string {
  const lines = [taskEventTitle(input.task, input.event)];
  lines.push(oneLineTaskSummary(input.task, { nextCursor: input.nextCursor }));
  lines.push(`Command: ${taskCommandPreview(input.task)}`);
  if (input.task.groupId) lines.push(`Group: ${input.task.groupId}`);
  if (input.logs && input.logs.length > 0) {
    lines.push("Relevant output:");
    lines.push(...input.logs.map(formatLogEvent));
  }
  if (input.nextCursor !== undefined) {
    lines.push(
      `Use task_logs({ taskId: "${input.task.name ?? input.task.id}", mode: "since_cursor", sinceSeq: ${input.nextCursor} }) later for more output if needed.`,
    );
  }
  return lines.join("\n");
}

export function relevantFailureLogs(
  responses: Array<TaskLogQueryResponse | undefined>,
  limit: number,
): { events: TaskLogEvent[]; nextCursor?: number } {
  const seen = new Set<number>();
  const events: TaskLogEvent[] = [];
  let nextCursor: number | undefined;
  for (const response of responses) {
    if (!response) continue;
    nextCursor = Math.max(nextCursor ?? 0, response.nextCursor);
    for (const event of response.events) {
      if (seen.has(event.seq)) continue;
      seen.add(event.seq);
      events.push(event);
      if (events.length >= limit) return { events, nextCursor };
    }
  }
  return { events, nextCursor };
}
