import type {
  RedactedError,
  SandboxStartupStage,
  StructuredLogger,
} from "@nervekit/contracts";

export type StartupEventSink = (input: {
  type: string;
  data: Record<string, unknown>;
}) => Promise<unknown>;

type BufferedStartupEvent = {
  type: "sandbox.startup.stage.started" | "sandbox.startup.stage.completed";
  data: Record<string, unknown>;
};

export class StartupReporter {
  private sink?: StartupEventSink;
  private buffered: BufferedStartupEvent[] = [];
  private attemptByStage = new Map<SandboxStartupStage, number>();
  private configDigest?: string;

  constructor(
    private logger: StructuredLogger,
    private readonly identity: { sandboxId: string; instanceId: string },
  ) {}

  setLogger(logger: StructuredLogger): void {
    this.logger = logger;
  }

  setConfigDigest(configDigest: string): void {
    this.configDigest = configDigest;
  }

  async attachSink(sink: StartupEventSink): Promise<void> {
    this.sink = sink;
    const pending = this.buffered.splice(0);
    for (const event of pending) await this.append(event);
  }

  async run<T>(
    stage: SandboxStartupStage,
    operation: () => Promise<T> | T,
    options: {
      detail?: string;
      resultStatus?: (result: T) => "completed" | "degraded" | "skipped";
      resultContext?: (result: T) => Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const attempt = (this.attemptByStage.get(stage) ?? 0) + 1;
    this.attemptByStage.set(stage, attempt);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    this.logger.info("sandbox startup stage started", {
      stage,
      attempt,
      detail: options.detail,
    });
    await this.emit("sandbox.startup.stage.started", {
      stage,
      attempt,
      startedAt,
    });
    try {
      const result = await operation();
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      const status = options.resultStatus?.(result) ?? "completed";
      const context = options.resultContext?.(result) ?? {};
      const logContext = {
        stage,
        attempt,
        status,
        durationMs,
        detail: options.detail,
        ...context,
      };
      if (status === "degraded")
        this.logger.warn("sandbox startup stage degraded", logContext);
      else this.logger.info("sandbox startup stage completed", logContext);
      await this.emit("sandbox.startup.stage.completed", {
        stage,
        attempt,
        status,
        startedAt,
        completedAt,
        durationMs,
        detail: options.detail,
      });
      return result;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      const redacted = redactedError(error);
      this.logger.error("sandbox startup stage failed", {
        stage,
        attempt,
        durationMs,
        detail: options.detail,
        failure: redacted,
      });
      await this.emit("sandbox.startup.stage.completed", {
        stage,
        attempt,
        status: "failed",
        startedAt,
        completedAt,
        durationMs,
        detail: options.detail,
        error: redacted,
      }).catch(() => undefined);
      throw error;
    }
  }

  private async emit(
    type: BufferedStartupEvent["type"],
    data: Record<string, unknown>,
  ): Promise<void> {
    const event = { type, data } satisfies BufferedStartupEvent;
    if (!this.sink) {
      this.buffered.push(event);
      return;
    }
    await this.append(event);
  }

  private async append(event: BufferedStartupEvent): Promise<void> {
    if (!this.sink) return;
    await this.sink({
      type: event.type,
      data: {
        ...this.identity,
        configDigest: this.configDigest,
        ...event.data,
      },
    });
  }
}

function redactedError(error: unknown): RedactedError {
  return {
    code: error instanceof Error ? error.name || "ERROR" : "ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}
