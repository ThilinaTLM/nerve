import type { ApplicationLogRecord } from "@nervekit/contracts/logs";

export type LogDisplayEntry = {
  key: string;
  label: string;
  value: string;
};

const referenceFields = [
  ["requestId", "request"],
  ["projectId", "project"],
  ["conversationId", "conversation"],
  ["agentId", "agent"],
  ["runId", "run"],
  ["toolCallId", "tool call"],
  ["taskId", "task"],
] as const;

const summaryPriority = [
  "operation",
  "repository",
  "repoDir",
  "relativePath",
  "command",
  "toolName",
  "model",
  "provider",
  "method",
  "path",
  "status",
  "outcome",
  "mode",
  "attempt",
] as const;

const SUMMARY_ATTRIBUTE_LIMIT = 3;
const SUMMARY_VALUE_LIMIT = 96;
const DETAIL_VALUE_LIMIT = 4_000;

export function logReferences(log: ApplicationLogRecord): LogDisplayEntry[] {
  return referenceFields.flatMap(([key, label]) => {
    const value = log[key];
    return value ? [{ key, label, value }] : [];
  });
}

export function logContextEntries(
  log: ApplicationLogRecord,
): LogDisplayEntry[] {
  if (!log.context) return [];
  return Object.entries(log.context).map(([key, value]) => ({
    key,
    label: humanizeKey(key),
    value: formatLogValue(value),
  }));
}

export function logSummaryAttributes(
  log: ApplicationLogRecord,
): LogDisplayEntry[] {
  if (!log.context) return [];
  const keys = [
    ...summaryPriority.filter((key) => key in (log.context ?? {})),
    ...Object.keys(log.context).filter(
      (key) =>
        !summaryPriority.includes(key as (typeof summaryPriority)[number]),
    ),
  ];
  const entries: LogDisplayEntry[] = [];
  for (const key of keys) {
    const value = log.context[key];
    if (!isSummaryValue(value)) continue;
    const formatted = formatLogValue(value, SUMMARY_VALUE_LIMIT);
    if (messageContainsValue(log.message, formatted)) continue;
    entries.push({ key, label: humanizeKey(key), value: formatted });
    if (entries.length === SUMMARY_ATTRIBUTE_LIMIT) break;
  }
  return entries;
}

export function logErrorEntries(log: ApplicationLogRecord): LogDisplayEntry[] {
  if (!log.error) return [];
  const nameAndMessage = log.error.name
    ? `${log.error.name}: ${log.error.message}`
    : log.error.message;
  return [
    {
      key: "error",
      label: "error",
      value: truncate(nameAndMessage, DETAIL_VALUE_LIMIT),
    },
    ...(log.error.cause
      ? [
          {
            key: "cause",
            label: "cause",
            value: truncate(log.error.cause, DETAIL_VALUE_LIMIT),
          },
        ]
      : []),
    ...(log.error.stack
      ? [
          {
            key: "stack",
            label: "stack",
            value: truncate(log.error.stack, DETAIL_VALUE_LIMIT),
          },
        ]
      : []),
  ];
}

export function formatApplicationLog(log: ApplicationLogRecord): string {
  const duration = log.durationMs === undefined ? "" : ` ${log.durationMs}ms`;
  const lines = [
    `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}${duration}`,
  ];
  for (const entry of [
    ...logReferences(log),
    ...logContextEntries(log),
    ...logErrorEntries(log),
  ]) {
    lines.push(formatDetailLine(entry.label, entry.value));
  }
  return lines.join("\n");
}

export function hasLogDetail(log: ApplicationLogRecord): boolean {
  return (
    Boolean(log.error) ||
    Boolean(log.context && Object.keys(log.context).length > 0) ||
    logReferences(log).length > 0
  );
}

function formatLogValue(
  value: unknown,
  maxLength = DETAIL_VALUE_LIMIT,
): string {
  let formatted: string;
  if (typeof value === "string") formatted = value;
  else if (value === undefined) formatted = "undefined";
  else {
    try {
      const seen = new WeakSet<object>();
      formatted =
        JSON.stringify(
          value,
          (_key, child: unknown) => {
            if (typeof child === "bigint") return child.toString();
            if (child && typeof child === "object") {
              if (seen.has(child)) return "[Circular]";
              seen.add(child);
            }
            return child;
          },
          2,
        ) ?? String(value);
    } catch {
      formatted = String(value);
    }
  }
  return truncate(formatted, maxLength);
}

function formatDetailLine(label: string, value: string): string {
  const indented = value.replaceAll("\n", "\n    ");
  return `  ${label}: ${indented}`;
}

function humanizeKey(key: string): string {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .toLowerCase();
}

function isSummaryValue(value: unknown): boolean {
  return (
    value === null ||
    ["string", "number", "boolean", "bigint"].includes(typeof value)
  );
}

function messageContainsValue(message: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 1 && message.toLowerCase().includes(normalized);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
