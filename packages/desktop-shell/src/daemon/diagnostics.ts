import { join } from "node:path";
import type { ChildExit } from "./types.js";

const MAX_OUTPUT_LINES = 200;

/** Bounded rolling buffer of owned-child stdout/stderr lines. */
export class OutputBuffer {
  private readonly lines: string[] = [];

  append(stream: "stdout" | "stderr", chunk: unknown): void {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.lines.push(`[${stream}] ${line}`);
    }
    if (this.lines.length > MAX_OUTPUT_LINES) {
      this.lines.splice(0, this.lines.length - MAX_OUTPUT_LINES);
    }
  }

  tail(): string {
    return this.lines.length > 0 ? this.lines.join("\n") : "(no output)";
  }
}

export function formatExit(exit: ChildExit): string {
  if (exit.signal) return ` after signal ${exit.signal}`;
  if (exit.code !== null) return ` with code ${exit.code}`;
  return "";
}

export function daemonStartupError(
  message: string,
  output: OutputBuffer,
  context?: {
    dataDir?: string;
    readinessTimeoutMs?: number;
    crashReportPath?: string;
  },
): Error {
  const diagnostics = [
    context?.readinessTimeoutMs
      ? `Startup timeout: ${context.readinessTimeoutMs}ms`
      : undefined,
    context?.dataDir ? `Data dir: ${context.dataDir}` : undefined,
    context?.dataDir
      ? `Application log: ${join(
          context.dataDir,
          "logs",
          `application-${new Date().toISOString().slice(0, 10)}.jsonl`,
        )}`
      : undefined,
    context?.crashReportPath
      ? `Crash report: ${context.crashReportPath}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return new Error(
    `${message}\n\nDaemon output:\n${output.tail()}${
      diagnostics.length > 0
        ? `\n\nDiagnostics:\n${diagnostics.map((line) => `- ${line}`).join("\n")}`
        : ""
    }`,
  );
}
