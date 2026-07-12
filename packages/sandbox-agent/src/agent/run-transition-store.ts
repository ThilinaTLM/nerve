import path from "node:path";
import {
  type RunEventDeliveryRecord,
  runEventDeliveryRecordSchema,
  type RunTransitionRecord,
  runTransitionRecordSchema,
} from "@nervekit/contracts";
import {
  reduceRunTransitions,
  RunRevisionConflictError,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "@nervekit/host-runtime";
import { JsonStore } from "../state/json-store.js";
import { JsonlStore } from "../state/jsonl-store.js";

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

export class SandboxRunUnitOfWork implements RunUnitOfWorkPort {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly stateDir: string) {}

  async load(runId: string): Promise<RunHydratedState | undefined> {
    const transitions = await this.transitions(runId).readAll();
    if (transitions.length === 0) return undefined;
    const deliveries = await this.deliveries(runId).readAll();
    return reduceRunTransitions(transitions, deliveries);
  }

  async findActive(scopeId: string): Promise<RunHydratedState | undefined> {
    return (await this.list()).find(
      (state) =>
        state.run.scopeId === scopeId && ACTIVE_STATUSES.has(state.run.status),
    );
  }

  async list(): Promise<readonly RunHydratedState[]> {
    const runsDir = this.root();
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(runsDir, { withFileTypes: true }).catch(() => []),
    );
    const states: RunHydratedState[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = await this.load(entry.name);
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
      await this.transitions(parsed.runId).append(parsed);
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
    await this.deliveries(parsed.runId).append(parsed);
  }

  async materialize(runId: string): Promise<void> {
    const state = await this.load(runId);
    if (!state) return;
    const root = this.runRoot(runId);
    await Promise.all([
      new JsonStore(path.join(root, "state.json")).write(state.run),
      new JsonStore(path.join(root, "prompts.json")).write(state.prompts),
      new JsonStore(path.join(root, "interactions.json")).write(
        state.interactions,
      ),
      new JsonStore(path.join(root, "checkpoints.json")).write(
        state.checkpoints,
      ),
    ]);
  }

  private root(): string {
    return path.join(this.stateDir, "run-runtime", "runs");
  }

  private runRoot(runId: string): string {
    return path.join(this.root(), safe(runId));
  }

  private transitions(runId: string): JsonlStore<RunTransitionRecord> {
    return new JsonlStore(
      path.join(this.runRoot(runId), "transitions.jsonl"),
      runTransitionRecordSchema,
    );
  }

  private deliveries(runId: string): JsonlStore<RunEventDeliveryRecord> {
    return new JsonlStore(
      path.join(this.runRoot(runId), "event-deliveries.jsonl"),
      runEventDeliveryRecordSchema,
    );
  }

  private async exclusive<T>(
    runId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(runId, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(runId) === tail) this.locks.delete(runId);
    }
  }
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
