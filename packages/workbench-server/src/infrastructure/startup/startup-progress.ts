import {
  DAEMON_STARTUP_PROGRESS_PREFIX,
  type DaemonStartupProgress,
} from "@nervekit/contracts";

export interface StartupProgressReporterOptions {
  intervalMs?: number;
  write?: (event: DaemonStartupProgress) => void;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

type StartupPhase = DaemonStartupProgress["phase"];

/** Owns daemon startup liveness until the HTTP discovery boundary is ready. */
export class StartupProgressReporter {
  private readonly intervalMs: number;
  private readonly write: (event: DaemonStartupProgress) => void;
  private readonly createInterval: typeof setInterval;
  private readonly removeInterval: typeof clearInterval;
  private timer: ReturnType<typeof setInterval> | undefined;
  private phase: StartupPhase = "starting";
  private message = "Preparing Nerve services";

  constructor(options: StartupProgressReporterOptions = {}) {
    this.intervalMs = options.intervalMs ?? 5_000;
    this.write = options.write ?? writeStartupProgress;
    this.createInterval = options.setInterval ?? setInterval;
    this.removeInterval = options.clearInterval ?? clearInterval;
  }

  start(): void {
    if (this.timer) return;
    this.emit("progress");
    // Deliberately referenced: startup itself owns process liveness until the
    // daemon has crossed the HTTP discovery boundary.
    this.timer = this.createInterval(
      () => this.emit("heartbeat"),
      this.intervalMs,
    );
  }

  update(phase: StartupPhase, message: string): void {
    this.phase = phase;
    this.message = message;
    this.emit("progress");
  }

  stop(): void {
    if (!this.timer) return;
    this.removeInterval(this.timer);
    this.timer = undefined;
  }

  private emit(kind: DaemonStartupProgress["kind"]): void {
    this.write({
      type: "nerve.startup.progress",
      kind,
      phase: this.phase,
      message: this.message,
    });
  }
}

function writeStartupProgress(event: DaemonStartupProgress): void {
  process.stderr.write(
    `${DAEMON_STARTUP_PROGRESS_PREFIX}${JSON.stringify(event)}\n`,
  );
}
