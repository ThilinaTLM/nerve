import { textHead } from "../measure.js";
import type {
  CandidateContext,
  ProjectionCandidate,
  SemanticItem,
} from "../types.js";
import { textCandidate } from "./text.js";
import { mutationCandidate } from "./mutation.js";
import { artifacts } from "../candidate-artifacts.js";
import { continuations } from "../candidate-continuation.js";
import {
  count,
  textOf,
  record,
  array,
  string,
  number,
} from "../candidate-values.js";

export function lifecycleCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const todos = array(result.todos) ?? array(details.todos);
  if (todos) {
    const items: SemanticItem[] = todos.map((value, index) => ({
      id: String(index),
      countsAs: "item",
      blocks: [
        {
          type: "text",
          text: `${index + 1}. ${record(value).done === true ? "[x]" : "[ ]"} ${string(record(value).todo)}`,
        },
      ],
    }));
    const title = `Todos: ${items.length}`;
    return {
      blocks: [
        {
          type: "text",
          text: [title, ...items.map((item) => textOf(item.blocks))].join("\n"),
        },
      ],
      status: [{ type: "text", text: title }],
      items,
      overflow: { noun: "todo" },
      counts: [count("item", items.length, items.length)],
      artifacts: artifacts(context),
    };
  }

  const values =
    array(result.tasks) ??
    array(details.tasks) ??
    (result.task && typeof result.task === "object"
      ? [result.task, ...(array(result.otherActiveTasks) ?? [])]
      : undefined);
  if (!values) return mutationCandidate(context);
  const control = record(result.result);
  const title =
    result.action === "stop"
      ? `Task control: stop — ${string(control.outcome) || "completed"}${string(control.message) ? ` — ${string(control.message)}` : ""}`
      : result.action === "restart"
        ? `Task control: restart — ${string(result.restartedFromTaskId)} → ${string(result.newTaskId)}`
        : `${values.length} task${values.length === 1 ? "" : "s"}`;
  const items: SemanticItem[] = values.map((value, index) => ({
    id: string(record(value).id) || String(index),
    countsAs: "task",
    blocks: [{ type: "text", text: taskSummary(value, index + 1) }],
  }));
  return {
    blocks: [
      {
        type: "text",
        text: [title, ...items.map((item) => textOf(item.blocks))].join("\n"),
      },
    ],
    status: [{ type: "text", text: title }],
    items,
    overflow: { noun: "task" },
    counts: [count("task", values.length, values.length)],
    artifacts: artifacts(context),
  };
}

export function taskLogsCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const response = { ...result, ...details };
  const events =
    array(result.events) ?? array(details.events) ?? array(response.events);
  if (!events) return textCandidate(context);
  const validated = artifacts(context);
  const streamPaths = new Map<string, string>();
  for (const stream of ["stdout", "stderr"] as const) {
    const artifact = validated.find(
      (item) =>
        item.id === `task_${stream}` &&
        item.availability === "available" &&
        item.access.kind === "agent_file",
    );
    if (artifact?.access.kind === "agent_file") {
      streamPaths.set(stream, artifact.access.path);
    }
  }
  const shortenedStreams = new Set<string>();
  const items: SemanticItem[] = events.map((event, index) => {
    const value = record(event);
    const seq = number(value.seq) ?? index;
    const stream = string(value.stream) || "log";
    const raw = record(value.raw);
    const path = streamPaths.get(stream);
    const start = number(raw.start);
    const end = number(raw.end);
    const prefix = `${seq} [${stream}] `;
    const recoverySuffix =
      path && start !== undefined && end !== undefined
        ? ` [${stream} bytes ${String(start)}-${String(end)}]`
        : "";
    const originalLine = string(value.line);
    const maxPlainBytes = Math.max(0, 512 - Buffer.byteLength(prefix, "utf8"));
    const needsShortening =
      recoverySuffix.length > 0 &&
      Buffer.byteLength(originalLine, "utf8") > maxPlainBytes;
    const maxPayloadBytes = Math.max(
      0,
      512 - Buffer.byteLength(prefix + recoverySuffix, "utf8"),
    );
    const displayedLine = needsShortening
      ? maxPayloadBytes >= 3
        ? `${textHead(originalLine, maxPayloadBytes - 3, 1)}…`
        : ""
      : originalLine;
    if (needsShortening) shortenedStreams.add(stream);
    return {
      id: String(seq),
      countsAs: "event",
      blocks: [
        {
          type: "text",
          text: `${prefix}${displayedLine}${needsShortening ? recoverySuffix : ""}`,
        },
      ],
    };
  });
  const originalEventCount =
    number(response.originalEventCount) ??
    number(response.total) ??
    events.length;
  const task = record(response.task);
  const mode = string(response.mode) || "recent";
  const statusText = [
    `Task logs: ${mode}`,
    Object.keys(task).length > 0
      ? taskSummary(task, 1).replace(/^1\. /, "")
      : undefined,
    ...[...shortenedStreams].map((stream) =>
      streamPaths.has(stream)
        ? `${stream} recovery: ${streamPaths.get(stream)}`
        : undefined,
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const eventText = items.map((item) => textOf(item.blocks)).join("\n");
  const firstSeq = number(response.firstSeq) ?? number(record(events[0]).seq);
  const lastSeq =
    number(response.lastSeq) ?? number(record(events.at(-1)).seq) ?? firstSeq;
  const canonicalNotice = [
    firstSeq !== undefined && lastSeq !== undefined
      ? `Showing ${events.length} of ${originalEventCount} events (seq ${firstSeq}-${lastSeq}); ${Math.max(0, originalEventCount - events.length)} omitted.`
      : `Showing ${events.length} of ${originalEventCount} events.`,
    response.hasMoreBefore === true && firstSeq !== undefined
      ? `For older events, call task_logs in ${mode} mode with cursor=${firstSeq}.`
      : undefined,
    lastSeq !== undefined
      ? `For future events, use mode=since_cursor with cursor=${lastSeq}.`
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const failure = events.find((event) => record(event).level === "error");
  const failureSeq = failure ? number(record(failure).seq) : undefined;
  return {
    blocks: [
      {
        type: "text",
        text: [statusText, eventText, canonicalNotice]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    status: [{ type: "text", text: statusText }],
    items,
    overflow: { noun: "event" },
    continuation: continuations(response),
    taskLog: {
      mode,
      ...(failureSeq !== undefined ? { failureSeq } : {}),
      originalEventCount,
      hasMoreBefore: response.hasMoreBefore === true,
      hasMoreAfter: response.hasMoreAfter === true,
      eventsArtifactId: "task_events",
    },
    counts: [count("event", originalEventCount, events.length)],
    artifacts: validated,
  };
}

function taskSummary(value: unknown, index: number): string {
  const task = record(value);
  const readiness = record(task.readiness);
  const parts = [
    `${index}. name: ${string(task.name) || "task"}`,
    `id: ${string(task.id) || "unknown"}`,
    `status: ${string(task.status) || "unknown"}`,
    typeof readiness.outcome === "string"
      ? `readiness: ${readiness.outcome}`
      : undefined,
    number(task.exitCode) !== undefined
      ? `exit: ${String(task.exitCode)}`
      : undefined,
    typeof task.signal === "string" ? `signal: ${task.signal}` : undefined,
    typeof task.finishedAt === "string"
      ? `finished: ${task.finishedAt}`
      : undefined,
    typeof task.error === "string" ? `error: ${task.error}` : undefined,
    typeof task.restartedFromTaskId === "string"
      ? `restarted from: ${task.restartedFromTaskId}`
      : undefined,
    typeof task.restartRootTaskId === "string" &&
    task.restartRootTaskId !== task.id
      ? `restart root: ${task.restartRootTaskId}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}
