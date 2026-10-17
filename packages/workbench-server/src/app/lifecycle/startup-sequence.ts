import {
  MIGRATION_ROLLED_BACK,
  type ServerLifecycle,
  type ServerLifecycleFailure,
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
  /**
   * Re-runs the storage phase after a retryable failure. `prepare` runs first,
   * inside the storage phase, e.g. to record discarded conversations.
   */
  retry(prepare?: () => Promise<void>): ServerLifecycle | undefined;
  /**
   * Restores the previous version's data after a failure that offers it. The
   * server then stays in a terminal failed state until the process is quit.
   */
  rollback(restore: () => Promise<void>): ServerLifecycle | undefined;
}

export function createStartupSequence<T>(
  options: StartupSequenceOptions<T>,
): StartupSequence {
  const { holder } = options;
  let running = false;

  const run = async (prepare?: () => Promise<void>): Promise<void> => {
    running = true;
    try {
      holder.starting();
      let storage: T;
      try {
        await prepare?.();
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
    start: () => run(),
    retry(prepare) {
      const current = holder.get();
      if (running || current.state !== "failed" || !current.failure?.retryable)
        return undefined;
      // `run` flips to `starting` synchronously, before its first await.
      void run(prepare).catch(() => undefined);
      return holder.get();
    },
    rollback(restore) {
      const failure = holder.get().failure;
      if (running || !failure?.rollbackAvailable) return undefined;
      running = true;
      holder.upgrading({
        step: failure.step ?? "rollback",
        label: "Restoring your previous data",
      });
      void restore()
        .then(
          () =>
            holder.failed({
              code: MIGRATION_ROLLED_BACK,
              message:
                "Your data was restored for the previous Nerve version. Quit Nerve and reinstall the previous version to keep using it.",
              step: failure.step,
              retryable: false,
            }),
          (error: unknown) =>
            holder.failed({
              ...failure,
              message: `Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
            }),
        )
        .finally(() => {
          running = false;
        });
      return holder.get();
    },
  };
}
