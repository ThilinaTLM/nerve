import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DaemonCrashReport,
  daemonCrashReportSchema,
} from "@nervekit/shared";
import { dataDir } from "../daemon/connection.js";
import { delay, readOption } from "../output/prompts.js";

type CrashReportWithPath = DaemonCrashReport & { path: string };

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
          const parsed = daemonCrashReportSchema.safeParse(
            JSON.parse(await readFile(path, "utf8")),
          );
          return parsed.success ? { ...parsed.data, path } : undefined;
        } catch {
          return undefined;
        }
      }),
  );
  return reports
    .filter((report): report is CrashReportWithPath => Boolean(report))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function printCrashReport(report: CrashReportWithPath, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report));
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

  const seen = new Set(reports.map((report) => report.id));
  while (true) {
    await delay(1000);
    reports = await readCrashReports();
    const next = reports.filter((report) => !seen.has(report.id));
    for (const report of next) seen.add(report.id);
    printCrashReports(next, { ...options, limit: next.length });
  }
}
