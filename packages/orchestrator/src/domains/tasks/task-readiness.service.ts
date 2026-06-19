import type { StartTaskRequest, TaskLogEvent, TaskRecord } from "@nerve/shared";

const urlPattern = /https?:\/\/[^\s)'"]+/i;

export class TaskReadinessService {
  buildReadiness(request: StartTaskRequest): TaskRecord["readiness"] {
    const hasReadiness = Boolean(
      request.readyUrl || request.readyOnUrl || request.readyPattern,
    );
    const timeoutMs =
      request.readyTimeoutMs ?? (request.readyUrl ? 30_000 : 3000);
    return {
      readyUrl: request.readyUrl,
      readyOnUrl: request.readyOnUrl,
      readyPattern: request.readyPattern,
      timeoutMs: hasReadiness ? timeoutMs : undefined,
      outcome: hasReadiness ? "pending" : "none",
    };
  }

  compilePattern(pattern: string | undefined): RegExp | undefined {
    return pattern ? new RegExp(pattern, "i") : undefined;
  }

  match(
    record: TaskRecord,
    readinessPattern: RegExp | undefined,
    log: TaskLogEvent,
  ): string | undefined {
    if (record.readiness.outcome !== "pending") return undefined;
    const url = record.readiness.readyOnUrl
      ? log.line.match(urlPattern)?.[0]
      : undefined;
    const pattern = readinessPattern?.exec(log.line)?.[0];
    return url ?? pattern;
  }
}
