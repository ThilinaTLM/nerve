export type StoreHydrationDurations = {
  auth: number;
  providers: number;
  tasks: number;
  tools: number;
  plans: number;
  projects: number;
  conversations: number;
};

export type RegistryHydrationCounts = {
  projects: number;
  conversations: number;
  agents: number;
  tasks: number;
  toolCalls: number;
  runMetadata: number;
  activeRuns: number;
};

export interface RegistryHydrationTimings {
  stateDurationMs: number;
  indexDurationMs: number;
  toolCallHydrationSource: "journal";
  storesHydrationDurationMs: number;
  storeDurationsMs: StoreHydrationDurations;
  counts: RegistryHydrationCounts;
  agentsHydrationDurationMs: number;
  runRecoveryDurationMs: number;
  humanInputRecoveryDurationMs: number;
  projectorDurationMs: number;
  taskNotificationsDurationMs: number;
}

export type StoreHydrationOperation = {
  name: keyof StoreHydrationDurations;
  run: () => Promise<unknown>;
};

export interface RuntimeRegistryHydrationOptions {
  readonly withUpdatesDeferred: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly hydrateStores: readonly StoreHydrationOperation[];
  readonly loadAgents: () => Promise<void>;
  readonly flushRunDelivery: () => Promise<void>;
  readonly recoverRuns: () => Promise<void>;
  readonly recoverHumanInput: () => Promise<void>;
  readonly rebuildProjector: () => Promise<{
    runMetadata: number;
    activeRuns: number;
  }>;
  readonly counts: () => Omit<
    RegistryHydrationCounts,
    "runMetadata" | "activeRuns"
  >;
  readonly recoverTaskNotifications: () => Promise<void>;
  readonly rebuildIndex: () => Promise<void>;
  readonly hydratePromptSuggestions: () => Promise<void>;
  readonly toolCallHydrationSource: "journal";
}

/** Coordinates startup hydration while keeping RuntimeRegistry as the façade. */
export class RuntimeRegistryHydrator {
  constructor(private readonly options: RuntimeRegistryHydrationOptions) {}

  async hydrate(): Promise<RegistryHydrationTimings> {
    const stateStartedAt = performance.now();
    let storesHydrationDurationMs = 0;
    let storeDurationsMs = emptyStoreHydrationDurations();
    let counts: RegistryHydrationCounts = {
      projects: 0,
      conversations: 0,
      agents: 0,
      tasks: 0,
      toolCalls: 0,
      runMetadata: 0,
      activeRuns: 0,
    };
    let agentsHydrationDurationMs = 0;
    let runRecoveryDurationMs = 0;
    let humanInputRecoveryDurationMs = 0;
    let projectorDurationMs = 0;
    let taskNotificationsDurationMs = 0;

    await this.options.withUpdatesDeferred(async () => {
      const storesStartedAt = performance.now();
      storeDurationsMs = await settleMeasuredHydrationOperations(
        this.options.hydrateStores,
      );
      storesHydrationDurationMs = Math.round(
        performance.now() - storesStartedAt,
      );

      const agentsStartedAt = performance.now();
      await this.options.loadAgents();
      agentsHydrationDurationMs = Math.round(
        performance.now() - agentsStartedAt,
      );

      const runRecoveryStartedAt = performance.now();
      await this.options.flushRunDelivery();
      await this.options.recoverRuns();
      runRecoveryDurationMs = Math.round(
        performance.now() - runRecoveryStartedAt,
      );

      const humanInputStartedAt = performance.now();
      await this.options.recoverHumanInput();
      humanInputRecoveryDurationMs = Math.round(
        performance.now() - humanInputStartedAt,
      );

      const projectorStartedAt = performance.now();
      const runCounts = await this.options.rebuildProjector();
      projectorDurationMs = Math.round(performance.now() - projectorStartedAt);
      counts = {
        ...this.options.counts(),
        ...runCounts,
      };

      await this.options.flushRunDelivery();
      const taskNotificationsStartedAt = performance.now();
      await this.options.recoverTaskNotifications();
      taskNotificationsDurationMs = Math.round(
        performance.now() - taskNotificationsStartedAt,
      );
    });

    const stateDurationMs = Math.round(performance.now() - stateStartedAt);
    const indexStartedAt = performance.now();
    await this.options.rebuildIndex();
    await this.options.hydratePromptSuggestions();
    return {
      stateDurationMs,
      indexDurationMs: Math.round(performance.now() - indexStartedAt),
      toolCallHydrationSource: this.options.toolCallHydrationSource,
      storesHydrationDurationMs,
      storeDurationsMs,
      counts,
      agentsHydrationDurationMs,
      runRecoveryDurationMs,
      humanInputRecoveryDurationMs,
      projectorDurationMs,
      taskNotificationsDurationMs,
    };
  }
}

function emptyStoreHydrationDurations(): StoreHydrationDurations {
  return {
    auth: 0,
    providers: 0,
    tasks: 0,
    tools: 0,
    plans: 0,
    projects: 0,
    conversations: 0,
  };
}

export async function settleMeasuredHydrationOperations(
  operations: readonly StoreHydrationOperation[],
  now: () => number = () => performance.now(),
): Promise<StoreHydrationDurations> {
  const durations = emptyStoreHydrationDurations();
  const pending = operations.map(async ({ name, run }) => {
    const startedAt = now();
    try {
      await run();
    } finally {
      durations[name] = Math.round(now() - startedAt);
    }
  });
  const results = await Promise.allSettled(pending);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return durations;
}
