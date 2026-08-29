import {
  DAEMON_STARTUP_PROGRESS_PREFIX,
  daemonStartupProgressSchema,
  type DaemonStartupProgress,
} from "@nervekit/contracts/storage";

/** Decodes newline-delimited startup progress emitted by the daemon process. */
export class DaemonStartupProgressDecoder {
  private remainder = "";

  constructor(
    private readonly report: (progress: DaemonStartupProgress) => void,
  ) {}

  push(chunk: Buffer | string): void {
    this.remainder += chunk.toString();
    const lines = this.remainder.split(/\r?\n/);
    this.remainder = lines.pop() ?? "";
    for (const line of lines) this.parse(line);
  }

  private parse(line: string): void {
    const marker = line.indexOf(DAEMON_STARTUP_PROGRESS_PREFIX);
    if (marker < 0) return;
    const parsed = daemonStartupProgressSchema.safeParse(
      parseJson(line.slice(marker + DAEMON_STARTUP_PROGRESS_PREFIX.length)),
    );
    if (parsed.success) this.report(parsed.data);
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
