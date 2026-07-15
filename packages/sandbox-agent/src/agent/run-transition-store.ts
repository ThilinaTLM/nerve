import path from "node:path";
import {
  type RunEventDeliveryRecord,
  runEventDeliveryRecordSchema,
  type RunTransitionRecord,
  runTransitionRecordSchema,
} from "@nervekit/contracts";
import {
  ACTIVE_STATUSES,
  ActiveRunLookup,
  applyRunEventDelivery,
  applyRunTransition,
  BoundedRunStateCache,
  reduceRunTransitions,
  RunRevisionConflictError,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "@nervekit/host-runtime";
import { JsonStore } from "../state/json-store.js";
import { JsonlStore } from "../state/jsonl-store.js";

export class SandboxRunUnitOfWork implements RunUnitOfWorkPort {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cache: BoundedRunStateCache;
  private readonly lookup = new ActiveRunLookup({
    load: (runId) => this.load(runId),
    hydrateAll: () => this.list(),
  });

  constructor(
    private readonly stateDir: string,
    cacheMaximum = 32,
  ) {
    this.cache = new BoundedRunStateCache(cacheMaximum);
  }

  async load(runId: string): Promise<RunHydratedState | undefined> {
    const cached = this.cache.get(runId);
    if (cached) return cached;
    const state = await this.hydrate(runId);
    if (state) {
      this.cache.set(state);
      this.lookup.observe(state);
    }
    return state;
  }

  async findActive(scopeId: string): Promise<RunHydratedState | undefined> {
    return this.lookup.findActive(scopeId);
  }

  async listActive(): Promise<readonly RunHydratedState[]> {
    return this.lookup.listActive();
  }

  async findByInteractionId(
    interactionId: string,
  ): Promise<RunHydratedState | undefined> {
    return this.lookup.findByInteractionId(interactionId);
  }

  async findByInteractionToolCallId(
    toolCallId: string,
  ): Promise<RunHydratedState | undefined> {
    return this.lookup.findByInteractionToolCallId(toolCallId);
  }

  async findByPromptId(
    promptId: string,
  ): Promise<RunHydratedState | undefined> {
    return this.lookup.findByPromptId(promptId);
  }

  async list(): Promise<readonly RunHydratedState[]> {
    const runsDir = this.root();
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(runsDir, { withFileTypes: true }).catch(() => []),
    );
    const states: RunHydratedState[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cached = this.cache.get(entry.name);
      const state = cached ?? (await this.hydrate(entry.name));
      if (!state) continue;
      if (!cached && ACTIVE_STATUSES.has(state.run.status)) {
        this.cache.set(state);
      }
      this.lookup.observe(state);
      states.push(state);
    }
    this.lookup.markInitialized();
    return states.sort((left, right) =>
      left.run.updatedAt.localeCompare(right.run.updatedAt),
    );
  }

  async commit(
    expectedRevision: number,
    transition: RunTransitionRecord,
  ): Promise<RunHydratedState> {
    const parsed = runTransitionRecordSchema.parse(
      JSON.parse(JSON.stringify(transition)) as unknown,
    );
    return this.exclusive(parsed.runId, async () => {
      const current = await this.load(parsed.runId);
      const actualRevision = current?.run.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new RunRevisionConflictError(
          `Run ${parsed.runId} expected revision ${expectedRevision}, found ${actualRevision}`,
        );
      }
      const next = applyRunTransition(current, parsed);
      await this.transitions(parsed.runId).append(parsed);
      this.cache.set(next);
      this.lookup.observe(next);
      return next;
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
    await this.exclusive(parsed.runId, async () => {
      const state = await this.load(parsed.runId);
      if (!state) throw new Error(`Unknown run: ${parsed.runId}`);
      const next = applyRunEventDelivery(state, parsed);
      if (next === state) return;
      await this.deliveries(parsed.runId).append(parsed);
      this.cache.set(next);
    });
  }

  async materialize(state: RunHydratedState): Promise<void> {
    const root = this.runRoot(state.run.runId);
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

  private async hydrate(runId: string): Promise<RunHydratedState | undefined> {
    const transitions = await this.transitions(runId).readAll();
    if (transitions.length === 0) return undefined;
    const deliveries = await this.deliveries(runId).readAll();
    return reduceRunTransitions(transitions, deliveries);
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
