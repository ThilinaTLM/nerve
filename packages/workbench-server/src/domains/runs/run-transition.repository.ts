import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RunEventDeliveryRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  runEventDeliveryRecordSchema,
  runTransitionRecordSchema,
} from "@nervekit/contracts";
import {
  reduceRunTransitions,
  RunRevisionConflictError,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "@nervekit/host-runtime";
import {
  appendJsonLine,
  atomicWriteJson,
  listChildDirs,
} from "../../infrastructure/storage/index.js";

const ACTIVE_STATUSES = new Set([
  "starting",
  "running",
  "retrying",
  "waiting",
  "suspended",
  "cancellation_requested",
  "cancellation_failed",
  "interrupted",
]);

export class WorkbenchRunUnitOfWork implements RunUnitOfWorkPort {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly home: string) {}

  async load(runId: string): Promise<RunHydratedState | undefined> {
    const transitions = await strictJsonLines(
      this.transitionsPath(runId),
      runTransitionRecordSchema,
    );
    if (transitions.length === 0) return undefined;
    const deliveries = await strictJsonLines(
      this.deliveriesPath(runId),
      runEventDeliveryRecordSchema,
    );
    return reduceRunTransitions(transitions, deliveries);
  }

  async findActive(scopeId: string): Promise<RunHydratedState | undefined> {
    return (await this.list()).find(
      (state) =>
        state.run.scopeId === scopeId && ACTIVE_STATUSES.has(state.run.status),
    );
  }

  async list(): Promise<readonly RunHydratedState[]> {
    const states: RunHydratedState[] = [];
    for (const runId of await listChildDirs(this.root())) {
      const state = await this.load(runId);
      if (state) states.push(state);
    }
    return states.sort((left, right) =>
      left.run.updatedAt.localeCompare(right.run.updatedAt),
    );
  }

  async commit(
    expectedRevision: number,
    transition: RunTransitionRecord,
  ): Promise<void> {
    await this.exclusive(transition.runId, async () => {
      const parsed = runTransitionRecordSchema.parse(transition);
      const current = await this.load(parsed.runId);
      const actualRevision = current?.run.revision ?? 0;
      if (
        actualRevision !== expectedRevision ||
        parsed.previousRevision !== expectedRevision ||
        parsed.revision !== expectedRevision + 1
      ) {
        throw new RunRevisionConflictError(
          `Run ${parsed.runId} expected revision ${expectedRevision}, found ${actualRevision}`,
        );
      }
      await appendJsonLine(this.transitionsPath(parsed.runId), parsed, 0o600);
    });
  }

  async pendingEventIntents() {
    const pending: Array<{
      runId: string;
      revision: number;
      intent: RunTransitionRecord["events"][number];
    }> = [];
    for (const state of await this.list()) {
      const delivered = new Set(state.deliveries.map((item) => item.intentId));
      for (const transition of state.transitions) {
        for (const intent of transition.events) {
          if (!delivered.has(intent.id)) {
            pending.push({
              runId: transition.runId,
              revision: transition.revision,
              intent,
            });
          }
        }
      }
    }
    return pending.sort(
      (left, right) =>
        left.intent.occurredAt.localeCompare(right.intent.occurredAt) ||
        left.intent.id.localeCompare(right.intent.id),
    );
  }

  async markEventDelivered(delivery: RunEventDeliveryRecord): Promise<void> {
    const parsed = runEventDeliveryRecordSchema.parse(delivery);
    const state = await this.load(parsed.runId);
    if (!state) throw new Error(`Unknown run: ${parsed.runId}`);
    const existing = state.deliveries.find(
      (item) => item.intentId === parsed.intentId,
    );
    if (existing) {
      if (
        existing.eventId !== parsed.eventId ||
        existing.sequence !== parsed.sequence
      ) {
        throw new Error(`Conflicting event delivery: ${parsed.intentId}`);
      }
      return;
    }
    await appendJsonLine(this.deliveriesPath(parsed.runId), parsed, 0o600);
  }

  async materialize(runId: string): Promise<void> {
    const state = await this.load(runId);
    if (!state) return;
    const root = this.runRoot(runId);
    await Promise.all([
      atomicWriteJson(join(root, "state.json"), state.run, 0o600),
      atomicWriteJson(join(root, "prompts.json"), state.prompts, 0o600),
      atomicWriteJson(
        join(root, "interactions.json"),
        state.interactions,
        0o600,
      ),
      atomicWriteJson(join(root, "checkpoints.json"), state.checkpoints, 0o600),
    ]);
  }

  private root(): string {
    return join(this.home, "run-runtime", "runs");
  }

  private runRoot(runId: string): string {
    return join(this.root(), safe(runId));
  }

  private transitionsPath(runId: string): string {
    return join(this.runRoot(runId), "transitions.jsonl");
  }

  private deliveriesPath(runId: string): string {
    return join(this.runRoot(runId), "event-deliveries.jsonl");
  }

  private async exclusive<T>(
    runId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    this.locks.set(
      runId,
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await task;
    } finally {
      if (this.locks.get(runId) === task) this.locks.delete(runId);
    }
  }
}

async function strictJsonLines<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return schema.parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(`Corrupt run journal ${path}:${index + 1}`, {
          cause: error,
        });
      }
    });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
