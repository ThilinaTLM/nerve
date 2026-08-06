import { join } from "node:path";
import type {
  RunEventDeliveryRecord,
  RunRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  runEventDeliveryRecordSchema,
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
} from "./runtime/index.js";
import {
  appendJsonLine,
  atomicWriteJson,
  listChildDirs,
  readJsonLinesTail,
  readTextFileConsistent,
} from "../../infrastructure/storage/index.js";

/**
 * Reserved intent id prefix for per-run delivery-settlement checkpoints. The
 * checkpoint records the run revision whose public-event intents are all
 * durably delivered, letting startup sweeps skip full hydration of settled
 * runs (the run journal is the only authoritative source for pending intents).
 */
export const DELIVERY_SETTLED_PREFIX = "__nerve_settled__";

export function deliverySettledIntentId(
  runId: string,
  revision: number,
): string {
  return `${DELIVERY_SETTLED_PREFIX}:${runId}:${revision}`;
}

export function isDeliverySettledRecord(
  delivery: RunEventDeliveryRecord | undefined,
): delivery is RunEventDeliveryRecord {
  return delivery?.intentId.startsWith(DELIVERY_SETTLED_PREFIX) === true;
}

export class WorkbenchRunUnitOfWork implements RunUnitOfWorkPort {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cache: BoundedRunStateCache;
  /** Lightweight run-record listing cached by the one-time active hydration. */
  private metadata: RunRecord[] | undefined;
  private readonly lookup = new ActiveRunLookup({
    load: (runId) => this.load(runId),
    hydrateActive: () => this.hydrateAllActive(),
  });

  constructor(
    private readonly home: string,
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

  async loadFresh(runId: string): Promise<RunHydratedState | undefined> {
    return this.exclusive(runId, async () => {
      const state = await this.hydrate(runId);
      if (state) {
        this.cache.set(state);
        this.lookup.observe(state);
      }
      return state;
    });
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
    const states: RunHydratedState[] = [];
    for (const runId of await listChildDirs(this.root())) {
      const cached = this.cache.get(runId);
      const state = cached ?? (await this.hydrate(runId));
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

  /**
   * Lightweight listing of every run record (id/status/scope/agent/timestamps)
   * without hydrating transition history. Reads the last committed transition
   * of each journal backwards in bounded chunks, so cost scales with the number
   * of runs, not with the size of their journals.
   */
  async listMetadata(): Promise<readonly RunRecord[]> {
    return (this.metadata ??= await this.scanMetadata());
  }

  /**
   * One-time authoritative initialization: discovers active runs from a
   * metadata scan and fully hydrates only those, so startup never reads
   * terminal transition history. Terminal runs are loaded lazily on demand.
   */
  async hydrateAllActive(): Promise<void> {
    const records = await this.scanMetadata();
    this.metadata = records;
    for (const record of records) {
      if (!ACTIVE_STATUSES.has(record.status)) continue;
      const state = await this.hydrate(record.runId);
      if (state) {
        this.cache.set(state);
        this.lookup.observe(state);
      }
    }
  }

  private async scanMetadata(): Promise<RunRecord[]> {
    const records: RunRecord[] = [];
    for (const runId of await listChildDirs(this.root())) {
      // The last valid transition carries the authoritative latest run record.
      // A torn final line falls back to the previous committed transition, so
      // a partially-written append never hides an active run from recovery.
      const [latest] = await readJsonLinesTail<RunTransitionRecord>(
        this.transitionsPath(runId),
        1,
      );
      if (latest?.run) records.push(latest.run);
    }
    return records;
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
      await appendJsonLine(this.transitionsPath(parsed.runId), parsed, 0o600);
      this.cache.set(next);
      this.lookup.observe(next);
      return next;
    });
  }

  /**
   * Enumerates undelivered public-event intents. Settled runs (whose last
   * delivery-settlement checkpoint covers their last committed transition)
   * are skipped from a bounded tail scan; only unsettled runs are hydrated
   * in full. Runs that hydrate clean with no pending intents are checkpointed
   * as settled so later sweeps skip them too.
   */
  async pendingEventIntents() {
    const pending: Array<{
      runId: string;
      revision: number;
      intent: RunTransitionRecord["events"][number];
    }> = [];
    for (const runId of await listChildDirs(this.root())) {
      const [latestTransition] = await readJsonLinesTail<RunTransitionRecord>(
        this.transitionsPath(runId),
        1,
      );
      if (!latestTransition) continue;
      const [latestDelivery] = await readJsonLinesTail<RunEventDeliveryRecord>(
        this.deliveriesPath(runId),
        1,
      );
      if (
        isDeliverySettledRecord(latestDelivery) &&
        latestDelivery.revision >= latestTransition.run.revision
      ) {
        continue;
      }
      const state = await this.hydrate(runId);
      if (!state) continue;
      const delivered = new Set(state.deliveries.map((item) => item.intentId));
      const runPending: typeof pending = [];
      for (const transition of state.transitions) {
        for (const intent of transition.events) {
          if (!delivered.has(intent.id)) {
            runPending.push({
              runId: transition.runId,
              revision: transition.revision,
              intent,
            });
          }
        }
      }
      if (runPending.length === 0) {
        // Nothing to re-deliver: record settlement so the next startup sweep
        // can skip this run entirely.
        await this.markDeliverySettled(runId, state.run.revision);
        continue;
      }
      pending.push(...runPending);
    }
    return pending.sort(
      (left, right) =>
        left.intent.occurredAt.localeCompare(right.intent.occurredAt) ||
        left.intent.id.localeCompare(right.intent.id),
    );
  }

  /**
   * Append a delivery-settlement checkpoint for `runId` through `revision`:
   * all public-event intents up to that revision are durably delivered.
   * Settlement is only consulted from the journal on the next sweep, so no
   * in-memory state is updated.
   */
  async markDeliverySettled(runId: string, revision: number): Promise<void> {
    await this.exclusive(runId, async () => {
      const intentId = deliverySettledIntentId(runId, revision);
      await appendJsonLine(
        this.deliveriesPath(runId),
        {
          intentId,
          runId,
          revision,
          eventId: intentId.slice(0, 256),
          sequence: revision,
          deliveredAt: new Date().toISOString(),
        } satisfies RunEventDeliveryRecord,
        0o600,
      );
    });
  }

  async markEventDelivered(delivery: RunEventDeliveryRecord): Promise<void> {
    const parsed = runEventDeliveryRecordSchema.parse(delivery);
    await this.exclusive(parsed.runId, async () => {
      const state = await this.load(parsed.runId);
      if (!state) throw new Error(`Unknown run: ${parsed.runId}`);
      const next = applyRunEventDelivery(state, parsed);
      if (next === state) return;
      await appendJsonLine(this.deliveriesPath(parsed.runId), parsed, 0o600);
      this.cache.set(next);
    });
  }

  async materialize(state: RunHydratedState): Promise<void> {
    const root = this.runRoot(state.run.runId);
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

  private async hydrate(runId: string): Promise<RunHydratedState | undefined> {
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
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(runId, tail);
    try {
      return await task;
    } finally {
      if (this.locks.get(runId) === tail) this.locks.delete(runId);
    }
  }
}

async function strictJsonLines<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T[]> {
  let raw: string;
  try {
    raw = await readTextFileConsistent(path);
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
