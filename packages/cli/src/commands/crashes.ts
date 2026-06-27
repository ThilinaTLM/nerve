import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DaemonCrashReport,
  daemonCrashReportSchema,
} from "@nervekit/shared";
import { dataDir } from "../daemon/connection.js";
import { delay, readOption } from "../output/prompts.js";

type NerveCrashReportWithPath = DaemonCrashReport & {
  path: string;
  format: "nerve";
};

type NodeDiagnosticReportWithPath = {
  path: string;
  format: "node-diagnostic";
  ts: string;
  event?: string;
  trigger?: string;
  pid?: number;
  commandLine?: string[];
  message: string;
  stack?: string[];
};

type CrashReportWithPath =
  | NerveCrashReportWithPath
  | NodeDiagnosticReportWithPath;

type CrashesCommandOptions = {
  limit: number;
  follow: boolean;
  json: boolean;
};

function parseCrashesOptions(args: string[]): CrashesCommandOptions {
  const limitValue = readOption(args, "--limit");
  return {
    limit: limitValue ? Number(limitValue) : 10,
    follow: args.includes("--follow") || args.includes("-f"),
    json: args.includes("--json"),
  };
}

async function readCrashReports(): Promise<CrashReportWithPath[]> {
  const dir = join(dataDir(), "crashes");
  const files = await readdir(dir).catch(() => []);
  const reports = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file): Promise<CrashReportWithPath | undefined> => {
        const path = join(dir, file);
        try {
          const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
          const parsed = daemonCrashReportSchema.safeParse(raw);
          if (parsed.success) return { ...parsed.data, path, format: "nerve" };
          return parseNodeDiagnosticReport(raw, path);
        } catch {
          return undefined;
        }
      }),
  );
  return reports
    .filter((report): report is CrashReportWithPath => Boolean(report))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function parseNodeDiagnosticReport(
  raw: unknown,
  path: string,
): NodeDiagnosticReportWithPath | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const header = record.header;
  if (!header || typeof header !== "object") return undefined;
  const headerRecord = header as Record<string, unknown>;
  if (headerRecord.reportVersion === undefined) return undefined;
  const stack = record.javascriptStack;
  const stackRecord =
    stack && typeof stack === "object"
      ? (stack as Record<string, unknown>)
      : {};
  const ts =
    typeof headerRecord.dumpEventTime === "string"
      ? headerRecord.dumpEventTime
      : typeof headerRecord.dumpEventTimeStamp === "number"
        ? new Date(headerRecord.dumpEventTimeStamp).toISOString()
        : new Date().toISOString();
  return {
    path,
    format: "node-diagnostic",
    ts,
    event:
      typeof headerRecord.event === "string" ? headerRecord.event : undefined,
    trigger:
      typeof headerRecord.trigger === "string"
        ? headerRecord.trigger
        : undefined,
    pid:
      typeof headerRecord.processId === "number"
        ? headerRecord.processId
        : undefined,
    commandLine: Array.isArray(headerRecord.commandLine)
      ? headerRecord.commandLine.map(String)
      : undefined,
    message:
      typeof stackRecord.message === "string"
        ? stackRecord.message
        : "Node diagnostic report",
    stack: Array.isArray(stackRecord.stack)
      ? stackRecord.stack.map(String)
      : undefined,
  };
}

function printCrashReport(report: CrashReportWithPath, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  if (report.format === "node-diagnostic") {
    const event = [report.event, report.trigger].filter(Boolean).join("/");
    console.log(
      `${report.ts} node-diagnostic${event ? `/${event}` : ""} ${report.message}`,
    );
    console.log(`  report: ${report.path}`);
    if (report.pid) console.log(`  pid: ${report.pid}`);
    if (report.commandLine?.length)
      console.log(`  command: ${report.commandLine.join(" ")}`);
    if (report.stack?.length) {
      console.log("  stack:");
      for (const line of report.stack) console.log(`    ${line}`);
    }
    return;
  }

  const exit = [
    report.exitCode !== undefined
      ? `code=${String(report.exitCode)}`
      : undefined,
    report.signal !== undefined ? `signal=${String(report.signal)}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `${report.ts} ${report.source}/${report.kind} ${report.message}${exit ? ` (${exit})` : ""}`,
  );
  console.log(`  report: ${report.path}`);
  if (report.pid) console.log(`  pid: ${report.pid}`);
  if (report.uptimeMs !== undefined)
    console.log(`  uptime: ${report.uptimeMs}ms`);
  if (report.error?.stack) console.log(report.error.stack);
  else if (report.error?.message)
    console.log(`  error: ${report.error.message}`);
  if (report.outputTail) {
    console.log("  output tail:");
    for (const line of report.outputTail.split(/\r?\n/)) {
      console.log(`    ${line}`);
    }
  }
}

function reportKey(report: CrashReportWithPath): string {
  return report.format === "nerve" ? report.id : report.path;
}

function printCrashReports(
  reports: CrashReportWithPath[],
  options: CrashesCommandOptions,
): void {
  for (const report of reports.slice(-options.limit)) {
    printCrashReport(report, options.json);
  }
}

export async function commandCrashes(args: string[]): Promise<void> {
  const options = parseCrashesOptions(args);
  let reports = await readCrashReports();
  printCrashReports(reports, options);
  if (!options.follow) return;

  const seen = new Set(reports.map(reportKey));
  while (true) {
    await delay(1000);
    reports = await readCrashReports();
    const next = reports.filter((report) => !seen.has(reportKey(report)));
    for (const report of next) seen.add(reportKey(report));
    printCrashReports(next, { ...options, limit: next.length });
  }
}
