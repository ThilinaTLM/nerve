import type {
  ProcessLogEvent,
  ProcessRecord,
  StartProcessRequest,
} from "@nerve/shared";

const urlPattern = /https?:\/\/[^\s)'"]+/i;

export class ProcessReadinessService {
  buildReadiness(request: StartProcessRequest): ProcessRecord["readiness"] {
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
    record: ProcessRecord,
    readinessPattern: RegExp | undefined,
    log: ProcessLogEvent,
  ): string | undefined {
    if (record.readiness.outcome !== "pending") return undefined;
    const url = record.readiness.readyOnUrl
      ? log.line.match(urlPattern)?.[0]
      : undefined;
    const pattern = readinessPattern?.exec(log.line)?.[0];
    return url ?? pattern;
  }
}
