import type {
  ApplicationLogLevel,
  ApplicationLogPruneRequest,
  ApplicationLogQuery,
  ApplicationLogQueryResponse,
  ApplicationLogRecord,
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

const LOG_PAGE_SIZE = 200;

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

export function serializeApplicationLogs(logs: ApplicationLogRecord[]): string {
  return logs
    .map(
      (log) =>
        `${log.ts} ${log.level.toUpperCase()} ${log.source}/${log.component} ${log.message}`,
    )
    .join("\n");
}

export class LogsPaneController {
  rows: ApplicationLogRecord[] = [];
  level: LogLevelFilter = "all";
  source: LogSourceFilter = "all";
  component = "";
  contains = "";
  hasMoreBefore = false;
  loading = false;
  loadingEarlier = false;
  pruning = false;
  error: string | undefined;
  historyError: string | undefined;
  notice: string | undefined;

  #generation = 0;
  readonly #dependencies: LogsPaneDependencies;
  readonly #onChange: () => void;

  constructor(
    dependencies: LogsPaneDependencies,
    onChange: () => void = () => undefined,
  ) {
    this.#dependencies = dependencies;
    this.#onChange = onChange;
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
      ? "This removes every stored Nerve application log matching the current filters, including entries that are not loaded. New request logs may appear immediately after pruning."
      : "This removes every stored Nerve application log, including entries that are not loaded. New request logs may appear immediately after pruning.";
  }

  setLevel(value: LogLevelFilter): void {
    this.level = value;
    this.invalidateHistory();
    this.#onChange();
  }

  setSource(value: LogSourceFilter): void {
    this.source = value;
    this.invalidateHistory();
    this.#onChange();
  }

  setComponent(value: string): void {
    this.component = value;
    this.invalidateHistory();
    this.#onChange();
  }

  setContains(value: string): void {
    this.contains = value;
    this.invalidateHistory();
    this.#onChange();
  }

  currentFilterRequest(): ApplicationLogPruneRequest {
    return logsFilterRequest(this);
  }

  async refresh(): Promise<void> {
    const generation = ++this.#generation;
    this.loading = true;
    this.loadingEarlier = false;
    this.error = undefined;
    this.historyError = undefined;
    this.#onChange();
    try {
      const response = await this.#dependencies.getLogs({
        ...this.currentFilterRequest(),
        limit: LOG_PAGE_SIZE,
      });
      if (generation !== this.#generation) return;
      this.rows = response.logs.toReversed();
      this.hasMoreBefore = response.hasMoreBefore;
    } catch (caught) {
      if (generation === this.#generation) {
        this.error = caught instanceof Error ? caught.message : String(caught);
      }
    } finally {
      if (generation === this.#generation) {
        this.loading = false;
        this.#onChange();
      }
    }
  }

  async loadEarlier(): Promise<void> {
    const beforeSeq = this.rows.at(-1)?.seq;
    if (
      beforeSeq === undefined ||
      !this.hasMoreBefore ||
      this.loading ||
      this.loadingEarlier
    ) {
      return;
    }

    const generation = this.#generation;
    this.loadingEarlier = true;
    this.historyError = undefined;
    this.#onChange();
    try {
      const response = await this.#dependencies.getLogs({
        ...this.currentFilterRequest(),
        beforeSeq,
        limit: LOG_PAGE_SIZE,
      });
      if (generation !== this.#generation) return;
      const loadedIds = new Set(this.rows.map((log) => log.id));
      const older = response.logs
        .toReversed()
        .filter((log) => !loadedIds.has(log.id));
      this.rows = [...this.rows, ...older];
      this.hasMoreBefore = response.hasMoreBefore;
    } catch (caught) {
      if (generation === this.#generation) {
        this.historyError =
          caught instanceof Error ? caught.message : String(caught);
      }
    } finally {
      if (generation === this.#generation) {
        this.loadingEarlier = false;
        this.#onChange();
      }
    }
  }

  clearFilters(): void {
    this.level = "all";
    this.source = "all";
    this.component = "";
    this.contains = "";
    this.invalidateHistory();
    this.#onChange();
  }

  private invalidateHistory(): void {
    this.#generation += 1;
    this.hasMoreBefore = false;
    this.loadingEarlier = false;
    this.historyError = undefined;
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
