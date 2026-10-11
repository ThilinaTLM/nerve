import type {
  ServerLifecycle,
  ServerLifecycleFailure,
} from "@nervekit/contracts/status";
import type { MigrationProgress } from "../../infrastructure/migrations/framework/step.js";
import type { ServerLifecycleHolder } from "./server-lifecycle.js";

export interface StartupSequenceOptions<T> {
  holder: ServerLifecycleHolder;
  /** Storage phase (migrations, config, secrets). Failures are recoverable. */
  storage(onProgress: (progress: MigrationProgress) => void): Promise<T>;
  /** Turns a storage-phase error into the failure the lifecycle reports. */
  classify(
    error: unknown,
  ): ServerLifecycleFailure | Promise<ServerLifecycleFailure>;
  /** Builds the runtime and mounts the full app. Failures are fatal. */
  mount(storage: T): Promise<void>;
  /** Observes a recoverable storage failure (logging, crash reports). */
  onStorageFailure?(error: unknown, failure: ServerLifecycleFailure): void;
  /** Handles a fatal mount error; without it `start()` rejects. */
  onFatal?(error: unknown): void;
}

export interface StartupSequence {
  /** Runs once; resolves when `ready` or `failed`. Rejects on fatal mount errors. */
  start(): Promise<void>;
  /** Re-runs the storage phase after a retryable failure. */
  retry(): ServerLifecycle | undefined;
}

export function createStartupSequence<T>(
  options: StartupSequenceOptions<T>,
): StartupSequence {
  const { holder } = options;
  let running = false;

  const run = async (): Promise<void> => {
    running = true;
    try {
      holder.starting();
      let storage: T;
      try {
        storage = await options.storage((progress) =>
          holder.upgrading({
            step: progress.step,
            label: progress.label ?? progress.description,
            done: progress.done,
            total: progress.total,
          }),
        );
      } catch (error) {
        const failure = await options.classify(error);
        holder.failed(failure);
        options.onStorageFailure?.(error, failure);
        return;
      }
      try {
        await options.mount(storage);
      } catch (error) {
        holder.failed({
          code: "STARTUP_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        });
        if (!options.onFatal) throw error;
        options.onFatal(error);
        return;
      }
      holder.ready();
    } finally {
      running = false;
    }
  };

  return {
    start: run,
    retry() {
      const current = holder.get();
      if (running || current.state !== "failed" || !current.failure?.retryable)
        return undefined;
      // `run` flips to `starting` synchronously, before its first await.
      void run().catch(() => undefined);
      return holder.get();
    },
  };
}
