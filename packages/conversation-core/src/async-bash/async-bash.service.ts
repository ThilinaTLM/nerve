import { projectProcessOutputPage } from "@nervekit/tools/result-projection";
import { relative } from "node:path";
import { createId } from "@nervekit/contracts";
import { asyncBashLogsRequestSchema } from "@nervekit/contracts/core";
import type {
  AsyncBash,
  AsyncBashLogsRequest,
  AsyncBashLogsResponse,
} from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import {
  BashRunner,
  type BashRunnerChange,
} from "../background-tasks/bash-runner.js";
import type { BackgroundTaskService } from "../background-tasks/background-task.service.js";
import type {
  BackgroundProcess,
  ProcessPort,
  ProcessReadiness,
} from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";

export type { AsyncBashChange } from "../background-tasks/bash-runner.js";

/** Async bash commands: starting, adoption and log reads; the task lifecycle is shared. */
export class AsyncBashService {
  private readonly runner: BashRunner;

  constructor(
    private readonly options: {
      storage: CoreStorage;
      assets: AssetStore;
      processes: ProcessPort;
      tasks: BackgroundTaskService;
      emit(change: BashRunnerChange): void;
    },
  ) {
    this.runner = new BashRunner(options);
    options.tasks.register(this.runner);
  }

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
    const process = await this.options.processes.start({
      conversationId: input.conversationId,
      command: input.command,
      cwd: input.cwd,
      signal: input.signal,
      artifactDir,
      env: input.env,
      timeoutMs: input.timeoutMs,
    });
    try {
      input.signal.throwIfAborted();
      const readiness = input.ready
        ? await this.options.processes.awaitReadiness(
            process,
            input.ready,
            input.signal,
          )
        : undefined;
      input.signal.throwIfAborted();
      const asyncBash = await this.adopt({ ...input, process });
      input.signal.throwIfAborted();
      return { asyncBash, readiness };
    } catch (error) {
      await process.cancel();
      throw error;
    }
  }

  async logs(
    conversationId: string,
    bashId: string,
    page: { offset?: number; limit?: number } = {},
  ): Promise<string> {
    const row = this.options.storage.asyncBash.get(bashId);
    if (!row || row.conversationId !== conversationId)
      throw new Error("Async bash not found");
    const assets = this.options.storage.assets
      .list(conversationId)
      .filter((asset) => asset.asyncBashId === bashId);
    return projectProcessOutputPage({
      outputFiles: this.runner.outputFiles(assets),
      status: row.status,
      exitCode: row.exitCode,
      ...page,
    });
  }

  async readLogPage(
    input: AsyncBashLogsRequest,
  ): Promise<AsyncBashLogsResponse> {
    const {
      conversationId,
      bashId,
      offset,
      limit = 65536,
    } = asyncBashLogsRequestSchema.parse(input);
    const bash = this.options.storage.asyncBash.get(bashId);
    if (!bash || bash.conversationId !== conversationId)
      throw new Error("Async bash not found");
    const assets = this.options.storage.assets
      .list(conversationId)
      .filter(
        (asset) =>
          asset.asyncBashId === bashId && asset.category === "bash_output",
      );
    // Every run has one capture file; storage migration 0003 created it for older runs.
    const combined = assets.find((asset) =>
      asset.logicalPath.endsWith("/output.txt"),
    );
    const page = combined
      ? await this.options.assets.readTextPage(combined.id, offset, limit)
      : { text: "", offset: 0, nextOffset: 0, totalBytes: 0 };
    return { bash, page };
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
      this.runner.emitChanged(row.conversationId);
      this.options.tasks.adopt(
        this.runner.ref(row),
        this.runner.handle(row, input.process),
      );
    }
    return row;
  }

  list(conversationId: string): AsyncBash[] {
    return this.options.storage.asyncBash.list(conversationId);
  }

  async cancel(bashId: string): Promise<void> {
    const row = this.options.storage.asyncBash.get(bashId);
    if (row) await this.options.tasks.cancel(this.runner.ref(row));
  }

  async discard(ids: readonly string[]): Promise<void> {
    const refs = ids.flatMap((id) => {
      const row = this.options.storage.asyncBash.get(id);
      return row ? [this.runner.ref(row)] : [];
    });
    await this.options.tasks.discard(refs);
  }

  cancelForConversations(ids: string[]): Promise<void> {
    return this.options.tasks.cancelForConversations(ids);
  }

  /** Reattach to running commands (or mark them interrupted) after a restart. */
  recover(conversationId?: string): Promise<void> {
    return this.options.tasks.recover(conversationId);
  }
}
