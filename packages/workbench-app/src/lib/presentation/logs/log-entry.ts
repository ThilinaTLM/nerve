import type { ApplicationLogRecord } from "@nervekit/contracts";

export function logReferences(log: ApplicationLogRecord): string[] {
  return [
    log.requestId,
    log.projectId,
    log.conversationId,
    log.agentId,
    log.runId,
    log.toolCallId,
    log.taskId,
  ].filter((value): value is string => Boolean(value));
}

export function logContextEntries(
  log: ApplicationLogRecord,
): Array<[string, string]> {
  if (!log.context) return [];
  return Object.entries(log.context).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
}

export function hasLogDetail(log: ApplicationLogRecord): boolean {
  return (
    Boolean(log.error) ||
    Boolean(log.context && Object.keys(log.context).length > 0) ||
    Boolean(
      log.requestId ||
      log.projectId ||
      log.conversationId ||
      log.agentId ||
      log.runId ||
      log.toolCallId ||
      log.taskId,
    )
  );
}
