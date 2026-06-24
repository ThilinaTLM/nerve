import type {
  ApplicationLogLevel,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
} from "@nervekit/shared";
import { apiGet } from "../daemon/http-client.js";
import { delay, readOption } from "../output/prompts.js";

type LogsCommandOptions = {
  level?: ApplicationLogLevel;
  source?: ApplicationLogSource;
  component?: string;
  contains?: string;
  limit?: number;
  follow?: boolean;
};

function parseLogsOptions(args: string[]): LogsCommandOptions {
  const limitValue = readOption(args, "--limit");
  const level = readOption(args, "--level") as ApplicationLogLevel | undefined;
  const source = readOption(args, "--source") as
    | ApplicationLogSource
    | undefined;
  return {
    level,
    source,
    component: readOption(args, "--component"),
    contains: readOption(args, "--contains"),
    limit: limitValue ? Number(limitValue) : undefined,
    follow: args.includes("--follow") || args.includes("-f"),
  };
}

async function fetchLogs(
  options: LogsCommandOptions,
  sinceSeq?: number,
): Promise<ApplicationLogQueryResponse> {
  const params = new URLSearchParams();
  if (options.level) params.set("level", options.level);
  if (options.source) params.set("source", options.source);
  if (options.component) params.set("component", options.component);
  if (options.contains) params.set("contains", options.contains);
  if (options.limit) params.set("limit", String(options.limit));
  if (sinceSeq !== undefined) params.set("sinceSeq", String(sinceSeq));
  return apiGet<ApplicationLogQueryResponse>(
    `/api/logs${params.size ? `?${params.toString()}` : ""}`,
  );
}

function printLogRecords(response: ApplicationLogQueryResponse): void {
  for (const log of response.logs) {
    const refs = [
      log.requestId,
      log.projectId,
      log.conversationId,
      log.agentId,
      log.runId,
      log.toolCallId,
      log.taskId,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `${log.ts} ${log.level.toUpperCase().padEnd(5)} ${log.source}/${log.component} ${log.message}${refs ? ` [${refs}]` : ""}`,
    );
    if (log.error?.stack) console.log(log.error.stack);
  }
}

export async function commandLogs(args: string[]): Promise<void> {
  const options = parseLogsOptions(args);
  let response = await fetchLogs(options);
  printLogRecords(response);
  if (!options.follow) return;
  let cursor = response.nextCursor;
  while (true) {
    await delay(1000);
    response = await fetchLogs(options, cursor);
    printLogRecords(response);
    cursor = response.nextCursor;
  }
}
