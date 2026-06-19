import type { StartTaskRequest, TaskLogEvent, TaskRecord } from "@nerve/shared";

const urlPattern = /https?:\/\/[^\s)'"]+/i;

export class TaskReadinessService {
  buildReadiness(request: StartTaskRequest): TaskRecord["readiness"] {
    return {
      readyOnUrl: request.readyOnUrl,
      readyPattern: request.readyPattern,
      timeoutMs: request.readyTimeoutMs ?? 3000,
      outcome:
        request.readyOnUrl || request.readyPattern
          ? ("pending" as const)
          : ("none" as const),
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
