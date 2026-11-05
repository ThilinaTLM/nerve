import { projectProcessOutput } from "@nervekit/tools/result-projection";
import type {
  Asset,
  AsyncBash,
  AsyncBashStatus,
  ConversationSummary,
} from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import type { BackgroundProcess, ProcessPort } from "../ports.js";
import { publishSummary } from "../runtime/publish-summary.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type {
  TaskHandle,
  TaskOutcome,
  TaskRef,
  TaskRunner,
  TaskTerminal,
} from "./background-task.js";

export type AsyncBashChange = {
  kind: "async_bash_changed";
  conversationId: string;
  asyncBash: AsyncBash[];
};
export type BashRunnerChange =
  | AsyncBashChange
  | { kind: "conversation_changed"; summary: ConversationSummary };

type Terminal = Exclude<AsyncBashStatus, "running">;

// The table keeps its historical `lost`; the shared vocabulary calls it `interrupted`.
const outcomeOf = (status: Terminal): TaskOutcome =>
  status === "lost" ? "interrupted" : status;
const statusOf = (outcome: TaskOutcome): Terminal =>
  outcome === "interrupted" ? "lost" : outcome;

/** Background shell commands persisted in `async_bash` and run by a host process. */
export class BashRunner implements TaskRunner {
  readonly kind = "bash" as const;

  constructor(
    private readonly options: {
      storage: CoreStorage;
      assets: AssetStore;
      processes: ProcessPort;
      emit(change: BashRunnerChange): void;
    },
  ) {}

  ref(row: AsyncBash): TaskRef {
    return {
      kind: "bash",
      id: row.id,
      parentConversationId: row.conversationId,
    };
  }

  handle(row: AsyncBash, process: BackgroundProcess): TaskHandle {
    return {
      wait: async () => {
        const result = await process.wait();
        return this.terminal(row, result.status, result.exitCode);
      },
      cancel: () => process.cancel(),
    };
  }

  running(parentConversationId?: string): TaskRef[] {
    const { asyncBash } = this.options.storage;
    return (
      parentConversationId === undefined
        ? asyncBash.listByStatus("running")
        : asyncBash
            .list(parentConversationId)
            .filter((row) => row.status === "running")
    ).map((row) => this.ref(row));
  }

  isRunning(ref: TaskRef): boolean {
    return this.options.storage.asyncBash.get(ref.id)?.status === "running";
  }

  async recover(ref: TaskRef): Promise<TaskHandle | undefined> {
    const row = this.options.storage.asyncBash.get(ref.id);
    if (!row || row.status !== "running" || !row.processRef) return undefined;
    const process = await this.options.processes.reattach(row.processRef);
    return process ? this.handle(row, process) : undefined;
  }

  async describe(ref: TaskRef, outcome: TaskOutcome): Promise<TaskTerminal> {
    const row = this.options.storage.asyncBash.get(ref.id);
    if (!row) throw new Error("Async bash not found");
    return this.terminal(row, statusOf(outcome), null);
  }

  persist(ref: TaskRef, terminal: TaskTerminal): boolean {
    const { asyncBash } = this.options.storage;
    if (asyncBash.get(ref.id)?.status !== "running") return false;
    asyncBash.update(ref.id, {
      status: statusOf(terminal.outcome),
      exitCode:
        terminal.detail.kind === "bash" ? terminal.detail.exitCode : null,
      finishedAt: new Date().toISOString(),
    });
    return true;
  }

  changed(ref: TaskRef): void {
    if (this.options.storage.asyncBash.get(ref.id))
      this.emitChanged(ref.parentConversationId);
  }

  emitChanged(conversationId: string): void {
    this.options.emit({
      kind: "async_bash_changed",
      conversationId,
      asyncBash: this.options.storage.asyncBash.list(conversationId),
    });
    publishSummary(this.options.storage, this.options.emit, conversationId);
  }

  outputFiles(assets: Asset[]): { combined?: string } {
    const asset = assets.find((asset) =>
      asset.logicalPath.endsWith("/output.txt"),
    );
    return {
      combined: asset ? this.options.assets.path(asset.logicalPath) : undefined,
    };
  }

  private async terminal(
    row: AsyncBash,
    status: Terminal,
    exitCode: number | null,
  ): Promise<TaskTerminal> {
    const assets = this.options.storage.assets
      .list(row.conversationId)
      .filter((asset) => asset.asyncBashId === row.id);
    const output = await projectProcessOutput({
      outputFiles: this.outputFiles(assets),
      status,
      exitCode,
    });
    return {
      outcome: outcomeOf(status),
      text: `${row.command}\n${output}`,
      assetIds: assets.map((asset) => asset.id),
      detail: { kind: "bash", exitCode },
    };
  }
}
