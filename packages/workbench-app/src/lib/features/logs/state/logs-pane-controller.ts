import type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogQuery,
  ApplicationLogQueryResponse,
  ApplicationLogSource,
} from "@nervekit/contracts";

export type LogLevelFilter = ApplicationLogLevel | "all";
export type LogSourceFilter = ApplicationLogSource | "all";

export type LogsPaneDependencies = {
  getLogs: (query: ApplicationLogQuery) => Promise<ApplicationLogQueryResponse>;
  pruneLogs: (
    request: ApplicationLogPruneRequest,
  ) => Promise<{ pruned: number }>;
  writeText: (text: string) => Promise<void>;
};

export function logsFilterRequest(input: {
  level: LogLevelFilter;
  source: LogSourceFilter;
  component: string;
  contains: string;
}): ApplicationLogPruneRequest {
  return {
    level: input.level === "all" ? undefined : input.level,
    source: input.source === "all" ? undefined : input.source,
    component: input.component.trim() || undefined,
    contains: input.contains.trim() || undefined,
  };
}

export function serializeApplicationLogs(
  logs: ApplicationLogQueryResponse["logs"],
): string {
  return logs
    .map(
      (log) =>
        `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}`,
    )
    .join("\n");
}

export class LogsPaneController {
  logs: ApplicationLogQueryResponse | undefined;
  level: LogLevelFilter = "all";
  source: LogSourceFilter = "all";
  component = "";
  contains = "";
  loading = false;
  pruning = false;
  error: string | undefined;
  notice: string | undefined;

  #refreshGeneration = 0;
  readonly #dependencies: LogsPaneDependencies;
  readonly #onChange: () => void;

  constructor(
    dependencies: LogsPaneDependencies,
    onChange: () => void = () => undefined,
  ) {
    this.#dependencies = dependencies;
    this.#onChange = onChange;
  }

  get rows(): ApplicationLogQueryResponse["logs"] {
    return [...(this.logs?.logs ?? [])].reverse();
  }

  get filtersActive(): boolean {
    return (
      this.level !== "all" ||
      this.source !== "all" ||
      this.component.trim() !== "" ||
      this.contains.trim() !== ""
    );
  }

  get pruneDescription(): string {
    return this.filtersActive
      ? "This removes stored Nerve application logs matching the current filters. New request logs may appear immediately after pruning."
      : "This removes stored Nerve application logs. New request logs may appear immediately after pruning.";
  }

  setLevel(value: LogLevelFilter): void {
    this.level = value;
    this.#onChange();
  }

  setSource(value: LogSourceFilter): void {
    this.source = value;
    this.#onChange();
  }

  setComponent(value: string): void {
    this.component = value;
    this.#onChange();
  }

  setContains(value: string): void {
    this.contains = value;
    this.#onChange();
  }

  currentFilterRequest(): ApplicationLogPruneRequest {
    return logsFilterRequest(this);
  }

  async refresh(): Promise<void> {
    const generation = ++this.#refreshGeneration;
    this.loading = true;
    this.error = undefined;
    this.#onChange();
    try {
      const logs = await this.#dependencies.getLogs({
        ...this.currentFilterRequest(),
        limit: 160,
      });
      if (generation === this.#refreshGeneration) this.logs = logs;
    } catch (caught) {
      if (generation === this.#refreshGeneration) {
        this.error = caught instanceof Error ? caught.message : String(caught);
      }
    } finally {
      if (generation === this.#refreshGeneration) {
        this.loading = false;
        this.#onChange();
      }
    }
  }

  clearFilters(): void {
    this.level = "all";
    this.source = "all";
    this.component = "";
    this.contains = "";
    this.#onChange();
  }

  async prune(): Promise<boolean> {
    this.pruning = true;
    this.error = undefined;
    this.notice = undefined;
    this.#onChange();
    try {
      const response = await this.#dependencies.pruneLogs(
        this.currentFilterRequest(),
      );
      this.notice = `Pruned ${response.pruned} ${response.pruned === 1 ? "log entry" : "log entries"}.`;
      await this.refresh();
      return true;
    } catch (caught) {
      this.error = caught instanceof Error ? caught.message : String(caught);
      return false;
    } finally {
      this.pruning = false;
      this.#onChange();
    }
  }

  async copy(): Promise<void> {
    try {
      await this.#dependencies.writeText(serializeApplicationLogs(this.rows));
    } catch {
      // Clipboard failures are non-critical and preserve the previous behavior.
    }
  }
}
