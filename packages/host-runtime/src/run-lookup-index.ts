import { ACTIVE_STATUSES } from "./run-transitions.js";
import type { RunHydratedState } from "./run-unit-of-work.js";

interface IndexedRunKeys {
  readonly scopeId: string;
  readonly interactionIds: readonly string[];
  readonly interactionToolCallIds: readonly string[];
  readonly promptIds: readonly string[];
}

/**
 * In-memory lookup over active runs only. File journals stay authoritative;
 * this index merely resolves hot-path keys (scope, interaction, tool call,
 * prompt) to run IDs so services can `load(runId)` directly instead of
 * enumerating and hydrating every historical run.
 *
 * Observations are revision-aware: re-observing an older state never
 * overwrites a newer commit, and observing a terminal run evicts all of its
 * lookup keys while remembering the revision floor for staleness protection.
 */
export class RunLookupIndex {
  /** Highest observed revision per run, retained across terminal eviction. */
  private readonly revisions = new Map<string, number>();
  /** Lookup keys for currently-active runs only. */
  private readonly activeKeys = new Map<string, IndexedRunKeys>();
  private readonly runIdByScope = new Map<string, string>();
  private readonly runIdByInteraction = new Map<string, string>();
  private readonly runIdByInteractionToolCall = new Map<string, string>();
  private readonly runIdByPrompt = new Map<string, string>();

  /** Records an authoritative state observation (hydration or commit). */
  observe(state: RunHydratedState): void {
    const runId = state.run.runId;
    const revision = state.run.revision;
    const known = this.revisions.get(runId);
    if (known !== undefined && known > revision) return;
    this.revisions.set(runId, revision);
    this.evictKeys(runId);
    if (!ACTIVE_STATUSES.has(state.run.status)) return;
    const keys: IndexedRunKeys = {
      scopeId: state.run.scopeId,
      interactionIds: state.interactions.map((item) => item.id),
      interactionToolCallIds: state.interactions.map((item) => item.toolCallId),
      promptIds: state.prompts.map((item) => item.id),
    };
    this.activeKeys.set(runId, keys);
    this.runIdByScope.set(keys.scopeId, runId);
    for (const id of keys.interactionIds) {
      this.runIdByInteraction.set(id, runId);
    }
    for (const id of keys.interactionToolCallIds) {
      this.runIdByInteractionToolCall.set(id, runId);
    }
    for (const id of keys.promptIds) this.runIdByPrompt.set(id, runId);
  }

  /** Drops a run whose indexed entry proved stale against authority. */
  forget(runId: string): void {
    this.evictKeys(runId);
  }

  activeRunIds(): readonly string[] {
    return [...this.activeKeys.keys()];
  }

  activeRunIdForScope(scopeId: string): string | undefined {
    return this.runIdByScope.get(scopeId);
  }

  runIdForInteraction(interactionId: string): string | undefined {
    return this.runIdByInteraction.get(interactionId);
  }

  runIdForInteractionToolCall(toolCallId: string): string | undefined {
    return this.runIdByInteractionToolCall.get(toolCallId);
  }

  runIdForPrompt(promptId: string): string | undefined {
    return this.runIdByPrompt.get(promptId);
  }

  private evictKeys(runId: string): void {
    const keys = this.activeKeys.get(runId);
    if (!keys) return;
    this.activeKeys.delete(runId);
    if (this.runIdByScope.get(keys.scopeId) === runId) {
      this.runIdByScope.delete(keys.scopeId);
    }
    for (const id of keys.interactionIds) {
      if (this.runIdByInteraction.get(id) === runId) {
        this.runIdByInteraction.delete(id);
      }
    }
    for (const id of keys.interactionToolCallIds) {
      if (this.runIdByInteractionToolCall.get(id) === runId) {
        this.runIdByInteractionToolCall.delete(id);
      }
    }
    for (const id of keys.promptIds) {
      if (this.runIdByPrompt.get(id) === runId) {
        this.runIdByPrompt.delete(id);
      }
    }
  }
}

export interface ActiveRunLookupSource {
  /** Loads one run's authoritative hydrated state. */
  load(runId: string): Promise<RunHydratedState | undefined>;
  /**
   * Performs one authoritative full hydration that observes every run into
   * the lookup (typically the unit of work's own `list()`).
   */
  hydrateAll(): Promise<unknown>;
}

/**
 * Targeted active-run reads over a {@link RunLookupIndex}. Every hit is
 * verified against an authoritative `load()`; stale entries self-heal by
 * re-observing the loaded state (or forgetting vanished runs).
 */
export class ActiveRunLookup {
  readonly index = new RunLookupIndex();
  private initialized = false;
  private initializing: Promise<void> | undefined;

  constructor(private readonly source: ActiveRunLookupSource) {}

  observe(state: RunHydratedState): void {
    this.index.observe(state);
  }

  /** Marks the index authoritative after a completed full hydration. */
  markInitialized(): void {
    this.initialized = true;
  }

  async listActive(): Promise<readonly RunHydratedState[]> {
    await this.ensureInitialized();
    const states: RunHydratedState[] = [];
    for (const runId of this.index.activeRunIds()) {
      const state = await this.verifiedLoad(runId);
      if (state && ACTIVE_STATUSES.has(state.run.status)) states.push(state);
    }
    return states.sort((left, right) =>
      left.run.updatedAt.localeCompare(right.run.updatedAt),
    );
  }

  async findActive(scopeId: string): Promise<RunHydratedState | undefined> {
    const state = await this.resolve(() =>
      this.index.activeRunIdForScope(scopeId),
    );
    if (!state || state.run.scopeId !== scopeId) return undefined;
    return ACTIVE_STATUSES.has(state.run.status) ? state : undefined;
  }

  async findByInteractionId(
    interactionId: string,
  ): Promise<RunHydratedState | undefined> {
    const state = await this.resolve(() =>
      this.index.runIdForInteraction(interactionId),
    );
    return state?.interactions.some((item) => item.id === interactionId)
      ? state
      : undefined;
  }

  async findByInteractionToolCallId(
    toolCallId: string,
  ): Promise<RunHydratedState | undefined> {
    const state = await this.resolve(() =>
      this.index.runIdForInteractionToolCall(toolCallId),
    );
    return state?.interactions.some((item) => item.toolCallId === toolCallId)
      ? state
      : undefined;
  }

  async findByPromptId(
    promptId: string,
  ): Promise<RunHydratedState | undefined> {
    const state = await this.resolve(() => this.index.runIdForPrompt(promptId));
    return state?.prompts.some((item) => item.id === promptId)
      ? state
      : undefined;
  }

  private async resolve(
    runIdFor: () => string | undefined,
  ): Promise<RunHydratedState | undefined> {
    await this.ensureInitialized();
    const runId = runIdFor();
    if (!runId) return undefined;
    return this.verifiedLoad(runId);
  }

  private async verifiedLoad(
    runId: string,
  ): Promise<RunHydratedState | undefined> {
    const state = await this.source.load(runId);
    if (!state) {
      this.index.forget(runId);
      return undefined;
    }
    // Authoritative load self-heals stale keys and evicts terminal runs.
    this.index.observe(state);
    return state;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    // Serialize the one authoritative initialization; allow retry on failure.
    this.initializing ??= Promise.resolve(this.source.hydrateAll()).then(
      () => {
        this.initialized = true;
      },
      (error: unknown) => {
        this.initializing = undefined;
        throw error;
      },
    );
    await this.initializing;
  }
}
