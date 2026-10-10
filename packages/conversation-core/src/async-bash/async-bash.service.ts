import { open } from "node:fs/promises";
import { relative } from "node:path";
import { createId } from "@nervekit/contracts";
import type {
  AsyncBash,
  AsyncBashStatus,
  Asset,
} from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type {
  BackgroundProcess,
  ProcessPort,
  ProcessReadiness,
} from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";

export type AsyncBashChange = {
  kind: "async_bash_changed";
  conversationId: string;
  asyncBash: AsyncBash[];
};

export class AsyncBashService {
  private readonly processes = new Map<string, BackgroundProcess>();
  private readonly watchers = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      storage: CoreStorage;
      assets: AssetStore;
      processes: ProcessPort;
      inputs: InputQueueService;
      emit(change: AsyncBashChange): void;
    },
  ) {}

  async start(input: {
    conversationId: string;
    toolCallId: string;
    command: string;
    cwd: string;
    signal: AbortSignal;
    env?: Record<string, string>;
    ready?: ProcessReadiness;
    timeoutMs?: number;
  }): Promise<{
    asyncBash: AsyncBash;
    readiness?: { status: "ready" | "timed_out" | "exited"; url?: string };
  }> {
    input.signal.throwIfAborted();
    const artifactDir = await this.options.assets.directory(
      `conversations/${input.conversationId}/tool-calls/${input.toolCallId}/output`,
    );
    const started = await this.options.processes.start({
      command: input.command,
      cwd: input.cwd,
      signal: input.signal,
      artifactDir,
      env: input.env,
      ready: input.ready,
      timeoutMs: input.timeoutMs,
    });
    try {
      input.signal.throwIfAborted();
      const asyncBash = await this.adopt({
        ...input,
        process: started.process,
      });
      input.signal.throwIfAborted();
      return { asyncBash, readiness: started.readiness };
    } catch (error) {
      await started.process.cancel();
      throw error;
    }
  }

  async logs(conversationId: string, bashId: string): Promise<string> {
    const row = this.options.storage.asyncBash.get(bashId);
    if (!row || row.conversationId !== conversationId)
      throw new Error("Async bash not found");
    const assets = this.options.storage.assets
      .list(conversationId)
      .filter((asset) => asset.asyncBashId === bashId);
    return (
      await Promise.all(
        assets.map(
          async (asset) => `${asset.logicalPath}\n${await this.tail(asset)}`,
        ),
      )
    ).join("\n");
  }

  async adopt(input: {
    conversationId: string;
    toolCallId: string;
    command: string;
    cwd: string;
    process: BackgroundProcess;
  }): Promise<AsyncBash> {
    const existing = this.list(input.conversationId).find(
      (row) => row.toolCallId === input.toolCallId,
    );
    if (existing) {
      if (
        existing.command !== input.command ||
        existing.workingDirectory !== input.cwd ||
        existing.processRef !== input.process.ref
      )
        throw new Error(
          "Tool call already promoted with different process details",
        );
      return existing;
    }
    const row = this.options.storage.asyncBash.insert({
      id: createId("bash"),
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
      command: input.command,
      workingDirectory: input.cwd,
      processRef: input.process.ref,
      status: "running",
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    this.processes.set(row.id, input.process);
    try {
      for (const path of Object.values(input.process.outputFiles)) {
        const logicalPath = relative(this.options.assets.dataDir, path)
          .split("\\")
          .join("/");
        const existingAsset = this.options.storage.assets
          .list(row.conversationId)
          .find((asset) => asset.logicalPath === logicalPath);
        // Keep the process's open output files in place; promotion does not copy a stale snapshot.
        const asset =
          existingAsset ??
          (await this.options.assets.register({
            conversationId: row.conversationId,
            toolCallId: row.toolCallId,
            category: "bash_output",
            logicalPath,
            mediaType: "text/plain",
          }));
        this.options.storage.assets.update(asset.id, { asyncBashId: row.id });
      }
    } finally {
      this.changed(row.conversationId);
      this.watch(row, input.process);
    }
    return row;
  }

  list(conversationId: string): AsyncBash[] {
    return this.options.storage.asyncBash.list(conversationId);
  }

  async cancel(bashId: string): Promise<void> {
    const row = this.options.storage.asyncBash.get(bashId);
    if (!row || row.status !== "running") return;
    let process = this.processes.get(bashId);
    if (!process && row.processRef) {
      try {
        process =
          (await this.options.processes.reattach(row.processRef)) ?? undefined;
      } catch {
        /* Unverifiable processes are lost. */
      }
    }
    if (!process) {
      await this.finish(row, "lost", null);
      return;
    }
    await process.cancel();
    await this.finish(row, "cancelled", null);
    this.processes.delete(bashId);
  }

  async cancelForConversations(ids: string[]): Promise<void> {
    for (const id of ids)
      for (const row of this.list(id))
        if (row.status === "running") await this.cancel(row.id);
  }

  async recover(): Promise<void> {
    for (const row of this.options.storage.asyncBash.listByStatus("running")) {
      if (this.watchers.has(row.id)) continue;
      let process: BackgroundProcess | null = null;
      if (row.processRef) {
        try {
          process = await this.options.processes.reattach(row.processRef);
        } catch {
          /* Unverifiable processes are lost. */
        }
      }
      if (process) this.watch(row, process);
      else await this.finish(row, "lost", null);
    }
  }

  private watch(row: AsyncBash, process: BackgroundProcess): void {
    if (this.watchers.has(row.id)) return;
    this.processes.set(row.id, process);
    const watcher = (async () => {
      let outcome: Awaited<ReturnType<BackgroundProcess["wait"]>>;
      try {
        outcome = await process.wait();
      } catch {
        await this.finish(row, "lost", null);
        return;
      }
      await this.finish(row, outcome.status, outcome.exitCode);
    })().finally(() => {
      this.processes.delete(row.id);
      this.watchers.delete(row.id);
    });
    this.watchers.set(row.id, watcher);
  }

  private async finish(
    row: AsyncBash,
    status: Exclude<AsyncBashStatus, "running">,
    exitCode: number | null,
  ): Promise<void> {
    const assets = this.options.storage.assets
      .list(row.conversationId)
      .filter((asset) => asset.asyncBashId === row.id);
    const output = (await Promise.all(assets.map((asset) => this.tail(asset))))
      .filter(Boolean)
      .join("\n");
    const storage = this.options.storage;
    storage.transaction(() => {
      if (storage.asyncBash.get(row.id)?.status !== "running") return;
      storage.asyncBash.update(row.id, {
        status,
        exitCode,
        finishedAt: new Date().toISOString(),
      });
      // Terminal state and its notice commit together, including during recovery.
      this.options.inputs.enqueueNotice({
        conversationId: row.conversationId,
        inputId: createId("input"),
        subtype: "async_bash_event",
        producer: row.id,
        text: `${row.command}\nStatus: ${status}; exit code: ${exitCode ?? "unknown"}${output ? `\n${output}` : ""}`,
        details: {
          bashId: row.id,
          status,
          exitCode,
          assetIds: assets.map((asset) => asset.id),
        },
        wakeWhenIdle: true,
      });
    });
    if (storage.asyncBash.get(row.id)) this.changed(row.conversationId);
  }

  private async tail(asset: Asset): Promise<string> {
    try {
      const file = await open(this.options.assets.path(asset.logicalPath), "r");
      try {
        const size = (await file.stat()).size;
        const buffer = Buffer.alloc(Math.min(size, 4096));
        const { bytesRead } = await file.read(
          buffer,
          0,
          buffer.length,
          Math.max(0, size - buffer.length),
        );
        return buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await file.close();
      }
    } catch {
      return "";
    }
  }

  private changed(conversationId: string): void {
    this.options.emit({
      kind: "async_bash_changed",
      conversationId,
      asyncBash: this.list(conversationId),
    });
  }
}
