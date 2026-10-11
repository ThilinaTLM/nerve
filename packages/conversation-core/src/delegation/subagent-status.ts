import type {
  AsyncBash,
  ConversationEvent,
  ToolCall,
} from "@nervekit/contracts/core";
import { SUBAGENT_STATUS_ACTIVITY_ITEMS } from "@nervekit/contracts/subagents";

const LINE_LIMIT = 120;

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h${minutes % 60}m` : `${hours}h`;
}

export function backgroundLabel(count: number): string {
  return `${count} background command${count === 1 ? "" : "s"}`;
}

export function backgroundLines(commands: AsyncBash[], now: number): string[] {
  return commands.map(
    (command) =>
      `"${oneLine(command.command, 60)}" running ${formatDuration(now - Date.parse(command.startedAt))}`,
  );
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export type ChildState =
  | "running"
  | "waiting"
  | "idle"
  | "stopped"
  | "failed"
  | "interrupted";

export interface ChildStatus {
  name: string;
  profile: string | null;
  model: string;
  state: ChildState;
  background: AsyncBash[];
  context: { tokens: number; window: number; percent: number | null };
  /** ISO time of the child's latest event. */
  lastActivityAt: string | null;
  /** ISO start of the open execution, when one is running. */
  runningSince: string | null;
}

function stateLabel(child: ChildStatus): string {
  if (child.state === "idle" && child.background.length)
    return `waiting: ${backgroundLabel(child.background.length)}`;
  return child.state;
}

function age(child: ChildStatus, now: number): string {
  if (!child.lastActivityAt) return "no activity";
  const text = formatDuration(now - Date.parse(child.lastActivityAt));
  return child.state === "running" ? `active ${text} ago` : `${text} ago`;
}

function compactTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : String(tokens);
}

/** One line per sub-agent, newest activity first. */
export function formatStatusList(children: ChildStatus[], now: number): string {
  if (!children.length) return "No sub-agents.";
  return [...children]
    .sort((a, b) =>
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
    )
    .map((child) =>
      [
        child.name,
        child.profile ?? "unknown",
        stateLabel(child),
        child.context.percent === null
          ? "ctx n/a"
          : `ctx ${child.context.percent}%`,
        age(child, now),
      ].join(" · "),
    )
    .join("\n");
}

export function formatStatusHeader(child: ChildStatus, now: number): string {
  const parts = [
    child.name,
    child.profile ?? "unknown",
    child.model,
    stateLabel(child),
    child.context.window
      ? `ctx ${compactTokens(child.context.tokens)}/${compactTokens(child.context.window)}`
      : `ctx ${compactTokens(child.context.tokens)}`,
  ];
  if (child.runningSince)
    parts.push(`run ${formatDuration(now - Date.parse(child.runningSince))}`);
  return parts.join(" · ");
}

export interface NamedStatusInput {
  child: ChildStatus;
  /** Inline-capped final response of the last execution, if any. */
  finalResponse: string;
  /** Message of the last failed execution, when the child is failed. */
  failure: string | null;
  activity: string[];
}

export function formatNamedStatus(input: NamedStatusInput, now: number) {
  const { child, finalResponse } = input;
  const lines = [formatStatusHeader(child, now)];
  if (child.state === "running" || child.state === "waiting") {
    lines.push(
      "Recent activity:",
      ...(input.activity.length ? input.activity : ["(none yet)"]),
    );
  } else if (child.state === "failed")
    lines.push(`Outcome: failed: ${input.failure ?? "unknown error"}`);
  else if (child.state === "interrupted") lines.push("Outcome: interrupted");
  else if (child.state === "stopped") {
    lines.push("Outcome: stopped");
    if (finalResponse) lines.push("Last response:", finalResponse);
  } else {
    lines.push(
      finalResponse ? "Final response:" : "No response yet.",
      ...(finalResponse ? [finalResponse] : []),
    );
    if (child.background.length)
      lines.push(...backgroundLines(child.background, now));
  }
  return lines.join("\n");
}

const argKeys = [
  "path",
  "file",
  "filePath",
  "command",
  "pattern",
  "query",
  "url",
  "name",
] as const;

function argSummary(args: Record<string, unknown>): string {
  for (const key of argKeys) {
    const value = args[key];
    if (typeof value === "string" && value)
      return key === "command" ? `"${oneLine(value, 60)}"` : oneLine(value, 60);
  }
  return "";
}

function clip(line: string): string {
  return line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT - 1)}…` : line;
}

/** The last activity items, oldest first: finished calls, assistant text, then calls still running. */
export function recentActivity(
  events: ConversationEvent[],
  openCalls: ToolCall[],
  now: number,
): string[] {
  const items: string[] = [];
  for (const event of events) {
    if (event.type === "tool_call_response") {
      const mark = event.payload.outcome === "completed" ? "✓" : "✗";
      items.push(
        clip(
          `${mark} ${event.payload.toolName} ${argSummary(event.payload.arguments)}`.trim(),
        ),
      );
    } else if (event.type === "assistant_message") {
      const text = event.payload.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
      if (text.trim()) items.push(clip(`text: "${oneLine(text, 80)}"`));
    }
  }
  for (const call of openCalls)
    items.push(
      clip(
        `… ${call.toolName} ${argSummary(call.arguments)} (${formatDuration(now - Date.parse(call.updatedAt))})`.replace(
          /\s+\(/,
          " (",
        ),
      ),
    );
  return items.slice(-SUBAGENT_STATUS_ACTIVITY_ITEMS);
}
